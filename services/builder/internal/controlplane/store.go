package controlplane

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	WorkflowQueued    = "queued"
	WorkflowRunning   = "running"
	WorkflowSucceeded = "succeeded"
	WorkflowFailed    = "failed"
)

type Store interface {
	ClaimNextWorkflowJob(ctx context.Context, options ClaimOptions) (*WorkflowJob, error)
	CompleteWorkflowJob(ctx context.Context, jobID string, result map[string]any) error
	FailWorkflowJob(ctx context.Context, jobID string, failure error) error
	GetProject(ctx context.Context, projectID string) (*Project, error)
	GetService(ctx context.Context, serviceID string) (*Service, error)
	GetDeployment(ctx context.Context, deploymentID string) (*Deployment, error)
	UpdateDeployment(ctx context.Context, deploymentID string, updates map[string]any) (*Deployment, error)
	UpdateService(ctx context.Context, serviceID string, updates map[string]any) (*Service, error)
	AppendBuildLog(ctx context.Context, input BuildLogInput) error
	AppendDeploymentEvent(ctx context.Context, input DeploymentEventInput) error
}

type ClaimOptions struct {
	WorkerID     string
	LeaseSeconds int
	Now          time.Time
}

type WorkflowJob struct {
	ID          string
	Type        string
	Status      string
	TargetType  string
	TargetID    string
	Payload     map[string]any
	Attempts    int
	MaxAttempts int
}

type Project struct {
	ID             string
	OrganizationID string
	Name           string
	Slug           string
}

type Service struct {
	ID             string
	ProjectID      string
	Name           string
	Slug           string
	Type           string
	RuntimeType    string
	SourceType     string
	BuildMode      string
	RepoURL        string
	Branch         string
	RootDirectory  string
	BuildContext   string
	DockerfilePath string
	InstallCommand string
	BuildCommand   string
	StartCommand   string
	OutputDirectory string
	Image          string
	ImageURL       string
	Registry       string
	LocalPath      string
	Port           int
	DesiredSpec    map[string]any
	DesiredState   map[string]any
}

type Deployment struct {
	ID                string
	ServiceID         string
	ProjectID         string
	Status            string
	DeploymentType    string
	TriggerType       string
	Branch            string
	CommitSHA         string
	CommitHash        string
	PullRequestNumber int
	PreviewURL        string
	ImageURL          string
	ImageDigest       string
}

type BuildLogInput struct {
	DeploymentID string
	Step         string
	Line         string
	Level        string
}

type DeploymentEventInput struct {
	DeploymentID string
	Type         string
	Message      string
	Metadata     map[string]any
}

type FileStore struct {
	path string
	mu   sync.Mutex
}

func NewFileStore(path string) *FileStore {
	return &FileStore{path: path}
}

func (s *FileStore) ClaimNextWorkflowJob(ctx context.Context, options ClaimOptions) (*WorkflowJob, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.load()
	if err != nil {
		return nil, err
	}
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

	jobs := recordSlice(state, "workflowJobs")
	sort.SliceStable(jobs, func(i, j int) bool {
		return parseTime(stringField(jobs[i], "runAfter"), time.Time{}).Before(parseTime(stringField(jobs[j], "runAfter"), time.Time{}))
	})
	claimedIndex := -1
	for _, candidate := range jobs {
		if !workflowReady(candidate, now, time.Duration(leaseSeconds)*time.Second) {
			continue
		}
		claimedIndex = findRecordIndex(recordSlice(state, "workflowJobs"), stringField(candidate, "id"))
		if claimedIndex >= 0 {
			break
		}
	}
	if claimedIndex < 0 {
		return nil, nil
	}

	allJobs := recordSlice(state, "workflowJobs")
	job := allJobs[claimedIndex]
	job["status"] = WorkflowRunning
	job["attempts"] = intField(job, "attempts") + 1
	job["lockedBy"] = workerID
	job["lockedAt"] = now.Format(time.RFC3339Nano)
	job["updatedAt"] = now.Format(time.RFC3339Nano)
	setRecordSlice(state, "workflowJobs", allJobs)
	if err := s.save(state); err != nil {
		return nil, err
	}
	return workflowJobFromRecord(job), nil
}

func (s *FileStore) CompleteWorkflowJob(ctx context.Context, jobID string, result map[string]any) error {
	return s.updateWorkflowJob(ctx, jobID, func(job record, now time.Time) {
		payload := mapField(job, "payload")
		payload["lastResult"] = MaskSecrets(result)
		payload["completedAt"] = now.Format(time.RFC3339Nano)
		job["payload"] = payload
		job["status"] = WorkflowSucceeded
		job["lockedBy"] = nil
		job["lockedAt"] = nil
		job["updatedAt"] = now.Format(time.RFC3339Nano)
	})
}

func (s *FileStore) FailWorkflowJob(ctx context.Context, jobID string, failure error) error {
	return s.updateWorkflowJob(ctx, jobID, func(job record, now time.Time) {
		attempts := intField(job, "attempts")
		maxAttempts := intField(job, "maxAttempts")
		if maxAttempts <= 0 {
			maxAttempts = 3
		}
		payload := mapField(job, "payload")
		payload["lastError"] = Redact(failureMessage(failure))
		payload["failedAt"] = now.Format(time.RFC3339Nano)
		job["payload"] = payload
		if attempts < maxAttempts {
			job["status"] = WorkflowQueued
			job["runAfter"] = now.Add(retryDelay(attempts)).Format(time.RFC3339Nano)
		} else {
			job["status"] = WorkflowFailed
		}
		job["lockedBy"] = nil
		job["lockedAt"] = nil
		job["updatedAt"] = now.Format(time.RFC3339Nano)
	})
}

func (s *FileStore) GetProject(ctx context.Context, projectID string) (*Project, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	rec := findRecord(recordSlice(state, "projects"), projectID)
	if rec == nil {
		return nil, notFound("project", projectID)
	}
	return projectFromRecord(rec), nil
}

func (s *FileStore) GetService(ctx context.Context, serviceID string) (*Service, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	rec := findRecord(recordSlice(state, "services"), serviceID)
	if rec == nil {
		return nil, notFound("service", serviceID)
	}
	return serviceFromRecord(rec), nil
}

func (s *FileStore) GetDeployment(ctx context.Context, deploymentID string) (*Deployment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	rec := findRecord(recordSlice(state, "deployments"), deploymentID)
	if rec == nil {
		return nil, notFound("deployment", deploymentID)
	}
	return deploymentFromRecord(rec), nil
}

func (s *FileStore) UpdateDeployment(ctx context.Context, deploymentID string, updates map[string]any) (*Deployment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return nil, err
	}
	rows := recordSlice(state, "deployments")
	idx := findRecordIndex(rows, deploymentID)
	if idx < 0 {
		return nil, notFound("deployment", deploymentID)
	}
	for key, value := range updates {
		rows[idx][key] = MaskSecrets(value)
	}
	rows[idx]["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	setRecordSlice(state, "deployments", rows)
	if err := s.save(state); err != nil {
		return nil, err
	}
	return deploymentFromRecord(rows[idx]), nil
}

func (s *FileStore) UpdateService(ctx context.Context, serviceID string, updates map[string]any) (*Service, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return nil, err
	}
	rows := recordSlice(state, "services")
	idx := findRecordIndex(rows, serviceID)
	if idx < 0 {
		return nil, notFound("service", serviceID)
	}
	for key, value := range updates {
		rows[idx][key] = MaskSecrets(value)
	}
	rows[idx]["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	setRecordSlice(state, "services", rows)
	if err := s.save(state); err != nil {
		return nil, err
	}
	return serviceFromRecord(rows[idx]), nil
}

func (s *FileStore) AppendBuildLog(ctx context.Context, input BuildLogInput) error {
	if strings.TrimSpace(input.Line) == "" {
		return nil
	}
	return s.appendRecord(ctx, "buildLogs", record{
		"id":           stableID("blog", input.DeploymentID, input.Step, input.Line, time.Now().UTC().Format(time.RFC3339Nano)),
		"deploymentId": input.DeploymentID,
		"step":         defaultString(input.Step, "build"),
		"line":         Redact(input.Line),
		"level":        defaultString(input.Level, "info"),
		"timestamp":    time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (s *FileStore) AppendDeploymentEvent(ctx context.Context, input DeploymentEventInput) error {
	return s.appendRecord(ctx, "deploymentEvents", record{
		"id":           stableID("devevt", input.DeploymentID, input.Type, input.Message, time.Now().UTC().Format(time.RFC3339Nano)),
		"deploymentId": input.DeploymentID,
		"type":         defaultString(input.Type, "deployment.event"),
		"message":      Redact(input.Message),
		"metadata":     MaskSecrets(input.Metadata),
		"timestamp":    time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func (s *FileStore) updateWorkflowJob(ctx context.Context, jobID string, update func(job record, now time.Time)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return err
	}
	rows := recordSlice(state, "workflowJobs")
	idx := findRecordIndex(rows, jobID)
	if idx < 0 {
		return notFound("workflow job", jobID)
	}
	update(rows[idx], time.Now().UTC())
	setRecordSlice(state, "workflowJobs", rows)
	return s.save(state)
}

func (s *FileStore) appendRecord(ctx context.Context, key string, row record) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return err
	}
	rows := recordSlice(state, key)
	rows = append(rows, row)
	setRecordSlice(state, key, rows)
	return s.save(state)
}

func (s *FileStore) loadReadOnly() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *FileStore) load() (map[string]any, error) {
	if s.path == "" {
		return nil, errors.New("control-plane state file is required")
	}
	bytes, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	if len(strings.TrimSpace(string(bytes))) == 0 {
		return map[string]any{}, nil
	}
	var state map[string]any
	if err := json.Unmarshal(bytes, &state); err != nil {
		return nil, fmt.Errorf("read control-plane state %s: %w", s.path, err)
	}
	return state, nil
}

func (s *FileStore) save(state map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	bytes = append(bytes, '\n')
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, bytes, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

type record map[string]any

func workflowReady(job record, now time.Time, lease time.Duration) bool {
	if strings.ToLower(stringField(job, "status")) != WorkflowQueued {
		return false
	}
	if runAfter := parseTime(stringField(job, "runAfter"), time.Time{}); !runAfter.IsZero() && runAfter.After(now) {
		return false
	}
	lockedAt := parseTime(stringField(job, "lockedAt"), time.Time{})
	return lockedAt.IsZero() || lockedAt.Add(lease).Before(now) || lockedAt.Add(lease).Equal(now)
}

func workflowJobFromRecord(row record) *WorkflowJob {
	if row == nil {
		return nil
	}
	return &WorkflowJob{
		ID:          stringField(row, "id"),
		Type:        stringField(row, "type"),
		Status:      stringField(row, "status"),
		TargetType:  stringField(row, "targetType"),
		TargetID:    stringField(row, "targetId"),
		Payload:     mapField(row, "payload"),
		Attempts:    intField(row, "attempts"),
		MaxAttempts: intField(row, "maxAttempts"),
	}
}

func projectFromRecord(row record) *Project {
	return &Project{ID: stringField(row, "id"), OrganizationID: stringField(row, "organizationId"), Name: stringField(row, "name"), Slug: stringField(row, "slug")}
}

func serviceFromRecord(row record) *Service {
	desiredSpec := mapField(row, "desiredSpec")
	desiredState := mapField(row, "desiredState")
	service := &Service{
		ID:              stringField(row, "id"),
		ProjectID:       stringField(row, "projectId"),
		Name:            stringField(row, "name"),
		Slug:            stringField(row, "slug"),
		Type:            stringField(row, "type"),
		RuntimeType:     stringField(row, "runtimeType"),
		SourceType:      coalesceString(stringField(row, "sourceType"), stringField(desiredState, "sourceType")),
		BuildMode:       coalesceString(stringField(row, "buildMode"), stringField(desiredState, "buildMode")),
		RepoURL:         coalesceString(stringField(row, "repoUrl"), stringField(desiredState, "repoUrl"), stringField(desiredState, "repositoryUrl")),
		Branch:          coalesceString(stringField(row, "branch"), stringField(desiredState, "branch")),
		RootDirectory:   coalesceString(stringField(row, "rootDirectory"), stringField(desiredState, "rootDirectory")),
		BuildContext:    coalesceString(stringField(row, "buildContext"), stringField(desiredState, "buildContext")),
		DockerfilePath:  coalesceString(stringField(row, "dockerfilePath"), stringField(desiredState, "dockerfilePath")),
		InstallCommand:  coalesceString(stringField(row, "installCommand"), stringField(desiredState, "installCommand")),
		BuildCommand:    coalesceString(stringField(row, "buildCommand"), stringField(desiredState, "buildCommand"), stringField(desiredState, "customBuildCommand")),
		StartCommand:    coalesceString(stringField(row, "startCommand"), stringField(desiredState, "startCommand")),
		OutputDirectory: coalesceString(stringField(row, "outputDirectory"), stringField(desiredState, "outputDirectory")),
		Image:           coalesceString(stringField(row, "image"), stringField(desiredState, "image")),
		ImageURL:        coalesceString(stringField(row, "imageUrl"), stringField(desiredState, "imageUrl")),
		Registry:        coalesceString(stringField(row, "registry"), stringField(desiredState, "registry"), stringField(desiredSpec, "registry")),
		LocalPath:       coalesceString(stringField(row, "localPath"), stringField(desiredState, "localPath"), stringField(desiredSpec, "localPath")),
		Port:            intField(row, "port"),
		DesiredSpec:     desiredSpec,
		DesiredState:    desiredState,
	}
	if service.Port == 0 {
		service.Port = intField(desiredState, "port")
	}
	return service
}

func deploymentFromRecord(row record) *Deployment {
	return &Deployment{
		ID:                stringField(row, "id"),
		ServiceID:         stringField(row, "serviceId"),
		ProjectID:         stringField(row, "projectId"),
		Status:            stringField(row, "status"),
		DeploymentType:    stringField(row, "deploymentType"),
		TriggerType:       stringField(row, "triggerType"),
		Branch:            stringField(row, "branch"),
		CommitSHA:         stringField(row, "commitSha"),
		CommitHash:        stringField(row, "commitHash"),
		PullRequestNumber: intField(row, "pullRequestNumber"),
		PreviewURL:        stringField(row, "previewUrl"),
		ImageURL:          stringField(row, "imageUrl"),
		ImageDigest:       stringField(row, "imageDigest"),
	}
}

func recordSlice(state map[string]any, key string) []record {
	value, ok := state[key]
	if !ok || value == nil {
		return []record{}
	}
	items, ok := value.([]any)
	if !ok {
		return []record{}
	}
	rows := make([]record, 0, len(items))
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			rows = append(rows, row)
		}
	}
	return rows
}

func setRecordSlice(state map[string]any, key string, rows []record) {
	items := make([]any, len(rows))
	for i, row := range rows {
		items[i] = row
	}
	state[key] = items
}

func findRecord(rows []record, id string) record {
	idx := findRecordIndex(rows, id)
	if idx < 0 {
		return nil
	}
	return rows[idx]
}

func findRecordIndex(rows []record, id string) int {
	for i, row := range rows {
		if stringField(row, "id") == id {
			return i
		}
	}
	return -1
}

func stringField(row map[string]any, key string) string {
	if row == nil {
		return ""
	}
	value, ok := row[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func intField(row map[string]any, key string) int {
	if row == nil {
		return 0
	}
	value := row[key]
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, _ := strconv.Atoi(typed)
		return parsed
	default:
		return 0
	}
}

func mapField(row map[string]any, key string) map[string]any {
	if row == nil {
		return map[string]any{}
	}
	value, ok := row[key]
	if !ok || value == nil {
		return map[string]any{}
	}
	if typed, ok := value.(map[string]any); ok {
		return cloneMap(typed)
	}
	return map[string]any{}
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		if nested, ok := value.(map[string]any); ok {
			output[key] = cloneMap(nested)
			continue
		}
		if items, ok := value.([]any); ok {
			output[key] = cloneSlice(items)
			continue
		}
		output[key] = value
	}
	return output
}

func cloneSlice(input []any) []any {
	output := make([]any, len(input))
	for i, value := range input {
		if nested, ok := value.(map[string]any); ok {
			output[i] = cloneMap(nested)
			continue
		}
		if items, ok := value.([]any); ok {
			output[i] = cloneSlice(items)
			continue
		}
		output[i] = value
	}
	return output
}

func parseTime(value string, fallback time.Time) time.Time {
	if value == "" || value == "<nil>" {
		return fallback
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.000Z"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed
		}
	}
	return fallback
}

func retryDelay(attempts int) time.Duration {
	if attempts <= 0 {
		return time.Second
	}
	if attempts > 6 {
		attempts = 6
	}
	return time.Duration(1<<uint(attempts-1)) * time.Second
}

func notFound(kind, id string) error {
	return fmt.Errorf("%s not found: %s", kind, id)
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func coalesceString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func stableID(parts ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return parts[0] + "_" + hex.EncodeToString(hash[:])[:16]
}

func failureMessage(err error) string {
	if err == nil {
		return "workflow failed"
	}
	return err.Error()
}

var (
	secretAssignmentPattern = regexp.MustCompile(`(?i)([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|MONGODB_URI|REDIS_URL)[A-Z0-9_]*=)([^\s]+)`)
	knownTokenPattern       = regexp.MustCompile(`(?i)(ghp_|github_pat_|glpat-|sk-[A-Za-z0-9_-]*|xox[baprs]-)[A-Za-z0-9_\-]+`)
	credentialedURLPattern  = regexp.MustCompile(`https://[^\s/@]+(:[^\s/@]+)?@`)
)

func Redact(value string) string {
	redacted := secretAssignmentPattern.ReplaceAllString(value, `$1****`)
	redacted = knownTokenPattern.ReplaceAllString(redacted, `$1****`)
	redacted = credentialedURLPattern.ReplaceAllString(redacted, `https://****@`)
	return redacted
}

func MaskSecrets(input any) any {
	switch typed := input.(type) {
	case nil:
		return nil
	case string:
		return Redact(typed)
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, value := range typed {
			if IsSecretKey(key) {
				out[key] = MaskSecretValue(fmt.Sprintf("%v", value))
			} else {
				out[key] = MaskSecrets(value)
			}
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, value := range typed {
			out[i] = MaskSecrets(value)
		}
		return out
	default:
		return typed
	}
}

func IsSecretKey(key string) bool {
	upper := strings.ToUpper(key)
	return strings.Contains(upper, "SECRET") || strings.Contains(upper, "PASSWORD") || strings.Contains(upper, "TOKEN") || strings.Contains(upper, "KEY") || strings.Contains(upper, "DATABASE_URL") || strings.Contains(upper, "MONGODB_URI") || strings.Contains(upper, "REDIS_URL")
}

func MaskSecretValue(value string) string {
	if value == "" {
		return ""
	}
	if len(value) <= 4 {
		return "****"
	}
	if len(value) <= 8 {
		return value[:2] + "****"
	}
	return value[:2] + "****" + value[len(value)-2:]
}
