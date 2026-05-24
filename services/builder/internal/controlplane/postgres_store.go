package controlplane

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const postgresDriverName = "pgx"

const claimWorkflowJobSQL = `
SELECT id, type, status, "targetType", "targetId", payload, attempts, "maxAttempts"
FROM "WorkflowJob"
WHERE (
    status = $1
    AND "runAfter" <= $2
    AND ("lockedAt" IS NULL OR "lockedAt" <= $3)
  )
  OR (
    status = $4
    AND "lockedAt" <= $3
    AND attempts < "maxAttempts"
  )
ORDER BY "runAfter" ASC, "createdAt" ASC, id ASC
FOR UPDATE SKIP LOCKED
LIMIT 1`

type PostgresStore struct {
	db *sql.DB
}

func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

func OpenPostgresStore(ctx context.Context, dsn string) (*PostgresStore, func() error, error) {
	if strings.TrimSpace(dsn) == "" {
		return nil, nil, errors.New("PostgreSQL control-plane DSN is required")
	}
	db, err := sql.Open(postgresDriverName, dsn)
	if err != nil {
		return nil, nil, err
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("connect PostgreSQL control-plane store: %w", err)
	}
	return NewPostgresStore(db), db.Close, nil
}

func PostgresDSNFromEnv(env map[string]string) string {
	if value := env["RAIBITSERVER_CONTROL_PLANE_DATABASE_URL"]; strings.TrimSpace(value) != "" {
		return value
	}
	storeMode := strings.ToLower(strings.TrimSpace(env["RAIBITSERVER_CONTROL_PLANE_STORE"]))
	if storeMode == "postgres" || storeMode == "postgresql" || storeMode == "prisma-postgres" {
		return env["DATABASE_URL"]
	}
	return ""
}

func RedactDSN(dsn string) string {
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.User == nil {
		return Redact(dsn)
	}
	username := parsed.User.Username()
	if _, ok := parsed.User.Password(); ok {
		parsed.User = url.UserPassword(username, "redacted")
	} else {
		parsed.User = url.User(username)
	}
	return parsed.String()
}

func (s *PostgresStore) ClaimNextWorkflowJob(ctx context.Context, options ClaimOptions) (*WorkflowJob, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer rollbackUnlessCommitted(tx)

	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	leaseSeconds := options.LeaseSeconds
	if leaseSeconds <= 0 {
		leaseSeconds = 300
	}
	workerID := options.WorkerID
	if workerID == "" {
		workerID = "raibitserver-builder"
	}
	lockCutoff := now.Add(-time.Duration(leaseSeconds) * time.Second)

	job, err := scanWorkflowJob(tx.QueryRowContext(ctx, claimWorkflowJobSQL, WorkflowQueued, now, lockCutoff, WorkflowRunning))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return nil, nil
		}
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
UPDATE "WorkflowJob"
SET status = $1, attempts = attempts + 1, "lockedBy" = $2, "lockedAt" = $3, "updatedAt" = $3
WHERE id = $4`, WorkflowRunning, workerID, now, job.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	job.Status = WorkflowRunning
	job.Attempts++
	return job, nil
}

func (s *PostgresStore) CompleteWorkflowJob(ctx context.Context, jobID string, result map[string]any) error {
	return s.updateWorkflowJob(ctx, jobID, func(job *workflowJobUpdate, now time.Time) {
		job.Payload["lastResult"] = MaskSecrets(result)
		job.Payload["completedAt"] = now.Format(time.RFC3339Nano)
		job.Status = WorkflowSucceeded
		job.RunAfter = nil
	})
}

func (s *PostgresStore) FailWorkflowJob(ctx context.Context, jobID string, failure error) error {
	return s.updateWorkflowJob(ctx, jobID, func(job *workflowJobUpdate, now time.Time) {
		job.Payload["lastError"] = Redact(failureMessage(failure))
		job.Payload["lastErrorSpec"] = ErrorSpecForFailure(failure, ErrorCodeUnknownInfra)
		job.Payload["failedAt"] = now.Format(time.RFC3339Nano)
		maxAttempts := job.MaxAttempts
		if maxAttempts <= 0 {
			maxAttempts = 3
		}
		if job.Attempts < maxAttempts {
			job.Status = WorkflowQueued
			next := now.Add(retryDelay(job.Attempts))
			job.RunAfter = &next
		} else {
			job.Status = WorkflowFailed
			job.RunAfter = nil
		}
	})
}

func (s *PostgresStore) GetProject(ctx context.Context, projectID string) (*Project, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var project Project
	err := s.db.QueryRowContext(ctx, `SELECT id, "organizationId", name, slug FROM "Project" WHERE id = $1`, projectID).
		Scan(&project.ID, &project.OrganizationID, &project.Name, &project.Slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("project", projectID)
	}
	if err != nil {
		return nil, err
	}
	return &project, nil
}

func (s *PostgresStore) GetService(ctx context.Context, serviceID string) (*Service, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	service, err := scanService(s.db.QueryRowContext(ctx, `
SELECT id, "projectId", name, slug, type, "runtimeType", "sourceType", "buildMode", "repoUrl", branch,
       "rootDirectory", "buildContext", "dockerfilePath", "installCommand", "buildCommand", "startCommand",
       "outputDirectory", image, "imageUrl", port, "desiredSpec", "desiredState"
FROM "Service"
WHERE id = $1`, serviceID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("service", serviceID)
	}
	if err != nil {
		return nil, err
	}
	return service, nil
}

func (s *PostgresStore) GetDeployment(ctx context.Context, deploymentID string) (*Deployment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	deployment, err := scanDeployment(s.db.QueryRowContext(ctx, deploymentSelectSQL()+` WHERE id = $1`, deploymentID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("deployment", deploymentID)
	}
	if err != nil {
		return nil, err
	}
	return deployment, nil
}

func (s *PostgresStore) UpdateDeployment(ctx context.Context, deploymentID string, updates map[string]any) (*Deployment, error) {
	assignments, args, err := updateAssignments(updates, deploymentUpdateColumns)
	if err != nil {
		return nil, err
	}
	args = append(args, time.Now().UTC(), deploymentID)
	sqlText := `
UPDATE "Deployment"
SET ` + strings.Join(append(assignments, `"updatedAt" = $`+strconv.Itoa(len(args)-1)), ", ") + `
WHERE id = $` + strconv.Itoa(len(args)) + `
RETURNING id, "serviceId", "projectId", status, "deploymentType", "triggerType", branch, "commitSha", "commitHash",
          "pullRequestNumber", "previewUrl", "imageUrl", "imageDigest"`
	deployment, err := scanDeployment(s.db.QueryRowContext(ctx, sqlText, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("deployment", deploymentID)
	}
	if err != nil {
		return nil, err
	}
	return deployment, nil
}

func (s *PostgresStore) UpdateService(ctx context.Context, serviceID string, updates map[string]any) (*Service, error) {
	assignments, args, err := updateAssignments(updates, serviceUpdateColumns)
	if err != nil {
		return nil, err
	}
	args = append(args, time.Now().UTC(), serviceID)
	sqlText := `
UPDATE "Service"
SET ` + strings.Join(append(assignments, `"updatedAt" = $`+strconv.Itoa(len(args)-1)), ", ") + `
WHERE id = $` + strconv.Itoa(len(args)) + `
RETURNING id, "projectId", name, slug, type, "runtimeType", "sourceType", "buildMode", "repoUrl", branch,
          "rootDirectory", "buildContext", "dockerfilePath", "installCommand", "buildCommand", "startCommand",
          "outputDirectory", image, "imageUrl", port, "desiredSpec", "desiredState"`
	service, err := scanService(s.db.QueryRowContext(ctx, sqlText, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("service", serviceID)
	}
	if err != nil {
		return nil, err
	}
	return service, nil
}

func (s *PostgresStore) AppendBuildLog(ctx context.Context, input BuildLogInput) error {
	if strings.TrimSpace(input.Line) == "" {
		return nil
	}
	now := time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
INSERT INTO "BuildLog" (id, "deploymentId", step, line, level, timestamp)
VALUES ($1, $2, $3, $4, $5, $6)`,
		stableID("blog", input.DeploymentID, input.Step, input.Line, now.Format(time.RFC3339Nano)),
		input.DeploymentID,
		defaultString(input.Step, "build"),
		Redact(input.Line),
		defaultString(input.Level, "info"),
		now)
	return err
}

func (s *PostgresStore) AppendDeploymentEvent(ctx context.Context, input DeploymentEventInput) error {
	now := time.Now().UTC()
	metadata, err := json.Marshal(MaskSecrets(input.Metadata))
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO "DeploymentEvent" (id, "deploymentId", type, message, metadata, timestamp)
VALUES ($1, $2, $3, $4, $5, $6)`,
		stableID("devevt", input.DeploymentID, input.Type, input.Message, now.Format(time.RFC3339Nano)),
		input.DeploymentID,
		defaultString(input.Type, "deployment.event"),
		Redact(input.Message),
		metadata,
		now)
	return err
}

func (s *PostgresStore) updateWorkflowJob(ctx context.Context, jobID string, mutate func(job *workflowJobUpdate, now time.Time)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer rollbackUnlessCommitted(tx)

	job, err := scanWorkflowJobUpdate(tx.QueryRowContext(ctx, `
SELECT id, status, payload, attempts, "maxAttempts"
FROM "WorkflowJob"
WHERE id = $1
FOR UPDATE`, jobID))
	if errors.Is(err, sql.ErrNoRows) {
		return notFound("workflow job", jobID)
	}
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	mutate(job, now)
	payload, err := json.Marshal(MaskSecrets(job.Payload))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE "WorkflowJob"
SET status = $1, payload = $2, "runAfter" = COALESCE($3, "runAfter"), "lockedBy" = NULL, "lockedAt" = NULL, "updatedAt" = $4
WHERE id = $5`, job.Status, payload, job.RunAfter, now, jobID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

type workflowJobUpdate struct {
	ID          string
	Status      string
	Payload     map[string]any
	Attempts    int
	MaxAttempts int
	RunAfter    *time.Time
}

type scanner interface {
	Scan(dest ...any) error
}

func scanWorkflowJob(row scanner) (*WorkflowJob, error) {
	var job WorkflowJob
	var payload []byte
	if err := row.Scan(&job.ID, &job.Type, &job.Status, &job.TargetType, &job.TargetID, &payload, &job.Attempts, &job.MaxAttempts); err != nil {
		return nil, err
	}
	job.Payload = jsonMap(payload)
	return &job, nil
}

func scanWorkflowJobUpdate(row scanner) (*workflowJobUpdate, error) {
	var job workflowJobUpdate
	var payload []byte
	if err := row.Scan(&job.ID, &job.Status, &payload, &job.Attempts, &job.MaxAttempts); err != nil {
		return nil, err
	}
	job.Payload = jsonMap(payload)
	return &job, nil
}

func scanService(row scanner) (*Service, error) {
	var service Service
	var repoURL, branch, rootDirectory, buildContext, dockerfilePath sql.NullString
	var installCommand, buildCommand, startCommand, outputDirectory sql.NullString
	var image, imageURL sql.NullString
	var port sql.NullInt64
	var desiredSpec, desiredState []byte
	err := row.Scan(
		&service.ID, &service.ProjectID, &service.Name, &service.Slug, &service.Type, &service.RuntimeType, &service.SourceType, &service.BuildMode,
		&repoURL, &branch, &rootDirectory, &buildContext, &dockerfilePath, &installCommand, &buildCommand, &startCommand,
		&outputDirectory, &image, &imageURL, &port, &desiredSpec, &desiredState,
	)
	if err != nil {
		return nil, err
	}
	service.RepoURL = nullString(repoURL)
	service.Branch = nullString(branch)
	service.RootDirectory = nullString(rootDirectory)
	service.BuildContext = nullString(buildContext)
	service.DockerfilePath = nullString(dockerfilePath)
	service.InstallCommand = nullString(installCommand)
	service.BuildCommand = nullString(buildCommand)
	service.StartCommand = nullString(startCommand)
	service.OutputDirectory = nullString(outputDirectory)
	service.Image = nullString(image)
	service.ImageURL = nullString(imageURL)
	if port.Valid {
		service.Port = int(port.Int64)
	}
	service.DesiredSpec = jsonMap(desiredSpec)
	service.DesiredState = jsonMap(desiredState)
	service.Registry = coalesceString(stringField(service.DesiredState, "registry"), stringField(service.DesiredSpec, "registry"))
	service.LocalPath = coalesceString(stringField(service.DesiredState, "localPath"), stringField(service.DesiredSpec, "localPath"))
	if service.Port == 0 {
		service.Port = intField(service.DesiredState, "port")
	}
	return &service, nil
}

func scanDeployment(row scanner) (*Deployment, error) {
	var deployment Deployment
	var commitSha, commitHash, previewURL, imageURL, imageDigest sql.NullString
	var pr sql.NullInt64
	err := row.Scan(
		&deployment.ID, &deployment.ServiceID, &deployment.ProjectID, &deployment.Status, &deployment.DeploymentType, &deployment.TriggerType,
		&deployment.Branch, &commitSha, &commitHash, &pr, &previewURL, &imageURL, &imageDigest,
	)
	if err != nil {
		return nil, err
	}
	deployment.CommitSHA = nullString(commitSha)
	deployment.CommitHash = nullString(commitHash)
	if pr.Valid {
		deployment.PullRequestNumber = int(pr.Int64)
	}
	deployment.PreviewURL = nullString(previewURL)
	deployment.ImageURL = nullString(imageURL)
	deployment.ImageDigest = nullString(imageDigest)
	return &deployment, nil
}

func deploymentSelectSQL() string {
	return `SELECT id, "serviceId", "projectId", status, "deploymentType", "triggerType", branch, "commitSha", "commitHash",
       "pullRequestNumber", "previewUrl", "imageUrl", "imageDigest"
FROM "Deployment"`
}

var deploymentUpdateColumns = map[string]updateColumn{
	"status":          {Name: "status"},
	"imageUrl":        {Name: `"imageUrl"`},
	"imageDigest":     {Name: `"imageDigest"`},
	"buildStartedAt":  {Name: `"buildStartedAt"`, Timestamp: true},
	"buildFinishedAt": {Name: `"buildFinishedAt"`, Timestamp: true},
	"errorCode":       {Name: `"errorCode"`},
	"errorMessage":    {Name: `"errorMessage"`},
}

var serviceUpdateColumns = map[string]updateColumn{
	"status":   {Name: "status"},
	"image":    {Name: "image"},
	"imageUrl": {Name: `"imageUrl"`},
}

type updateColumn struct {
	Name      string
	Timestamp bool
}

func updateAssignments(updates map[string]any, allowed map[string]updateColumn) ([]string, []any, error) {
	if len(updates) == 0 {
		return nil, nil, errors.New("update requires at least one field")
	}
	assignments := make([]string, 0, len(updates))
	args := make([]any, 0, len(updates))
	keys := make([]string, 0, len(updates))
	for key := range updates {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := updates[key]
		column, ok := allowed[key]
		if !ok {
			return nil, nil, fmt.Errorf("unsupported PostgreSQL store update field: %s", key)
		}
		args = append(args, postgresValue(MaskSecrets(value), column))
		assignments = append(assignments, column.Name+" = $"+strconv.Itoa(len(args)))
	}
	return assignments, args, nil
}

func postgresValue(value any, column updateColumn) any {
	if value == nil {
		return nil
	}
	if column.Timestamp {
		if typed, ok := value.(time.Time); ok {
			return typed
		}
		parsed := parseTime(fmt.Sprintf("%v", value), time.Time{})
		if !parsed.IsZero() {
			return parsed
		}
	}
	return value
}

func jsonMap(input []byte) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(input, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func nullString(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}

func rollbackUnlessCommitted(tx *sql.Tx) {
	_ = tx.Rollback()
}
