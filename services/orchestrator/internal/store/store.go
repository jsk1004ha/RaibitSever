package store

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
	DeploymentStatusImageReady       = "IMAGE_READY"
	DeploymentStatusDeploying        = "DEPLOYING"
	DeploymentStatusReady            = "READY"
	DeploymentStatusFailed           = "FAILED"
	DeploymentStatusRollbackRequested = "ROLLBACK_REQUESTED"
	DeploymentStatusCleanupRequested = "PREVIEW_CLEANUP_REQUESTED"
	DeploymentStatusCleanedUp        = "CLEANED_UP"
)

type DesiredStateStore interface {
	ListPendingServices() ([]ServiceDesiredState, error)
	MarkServiceReady(serviceID string, status string) error
}

type ReconcileStore interface {
	ListDeploymentsForReconcile(ctx context.Context) ([]Deployment, error)
	GetProject(ctx context.Context, projectID string) (*Project, error)
	GetService(ctx context.Context, serviceID string) (*Service, error)
	UpdateDeployment(ctx context.Context, deploymentID string, updates map[string]any) (*Deployment, error)
	AppendDeploymentEvent(ctx context.Context, input DeploymentEventInput) error
	AppendRuntimeLog(ctx context.Context, input RuntimeLogInput) error
}

type ServiceDesiredState struct {
	ID        string
	ProjectID string
	Image     string
	Port      int
}

type Project struct {
	ID             string
	OrganizationID string
	Name           string
	Slug           string
}

type Service struct {
	ID           string
	ProjectID    string
	Name         string
	Slug         string
	Type         string
	ImageURL     string
	Port         int
	Replicas     int
	BaseDomain   string
	DesiredSpec  map[string]any
	DesiredState map[string]any
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
	ImageURL          string
	ImageDigest       string
	PreviewURL        string
	PreviousImageURL  string
	PullRequestNumber int
}

type DeploymentEventInput struct {
	DeploymentID string
	Type         string
	Message      string
	Metadata     map[string]any
}

type RuntimeLogInput struct {
	ServiceID     string
	DeploymentID  string
	PodName       string
	ContainerName string
	Line          string
	Level         string
}

type FileStore struct {
	path string
	mu   sync.Mutex
}

func NewFileStore(path string) *FileStore { return &FileStore{path: path} }

func (s *FileStore) ListPendingServices() ([]ServiceDesiredState, error) {
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	services := []ServiceDesiredState{}
	for _, service := range recordSlice(state, "services") {
		if strings.EqualFold(stringField(service, "status"), "image-ready") || stringField(service, "imageUrl") != "" {
			services = append(services, ServiceDesiredState{ID: stringField(service, "id"), ProjectID: stringField(service, "projectId"), Image: stringField(service, "imageUrl"), Port: intField(service, "port")})
		}
	}
	return services, nil
}

func (s *FileStore) MarkServiceReady(serviceID string, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return err
	}
	rows := recordSlice(state, "services")
	idx := findRecordIndex(rows, serviceID)
	if idx < 0 {
		return notFound("service", serviceID)
	}
	rows[idx]["status"] = status
	rows[idx]["updatedAt"] = now()
	setRecordSlice(state, "services", rows)
	return s.save(state)
}

func (s *FileStore) ListDeploymentsForReconcile(ctx context.Context) ([]Deployment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	rows := recordSlice(state, "deployments")
	out := []Deployment{}
	for _, row := range rows {
		status := strings.ToUpper(stringField(row, "status"))
		switch status {
		case DeploymentStatusImageReady, DeploymentStatusRollbackRequested, DeploymentStatusCleanupRequested, "CLEANUP_REQUESTED":
			out = append(out, *deploymentFromRecord(row))
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (s *FileStore) GetProject(ctx context.Context, projectID string) (*Project, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	row := findRecord(recordSlice(state, "projects"), projectID)
	if row == nil {
		return nil, notFound("project", projectID)
	}
	return projectFromRecord(row), nil
}

func (s *FileStore) GetService(ctx context.Context, serviceID string) (*Service, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	state, err := s.loadReadOnly()
	if err != nil {
		return nil, err
	}
	row := findRecord(recordSlice(state, "services"), serviceID)
	if row == nil {
		return nil, notFound("service", serviceID)
	}
	return serviceFromRecord(row), nil
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
	rows[idx]["updatedAt"] = now()
	setRecordSlice(state, "deployments", rows)
	if err := s.save(state); err != nil {
		return nil, err
	}
	return deploymentFromRecord(rows[idx]), nil
}

func (s *FileStore) AppendDeploymentEvent(ctx context.Context, input DeploymentEventInput) error {
	return s.appendRecord(ctx, "deploymentEvents", record{"id": stableID("devevt", input.DeploymentID, input.Type, input.Message, now()), "deploymentId": input.DeploymentID, "type": defaultString(input.Type, "deployment.event"), "message": Redact(input.Message), "metadata": MaskSecrets(input.Metadata), "timestamp": now()})
}

func (s *FileStore) AppendRuntimeLog(ctx context.Context, input RuntimeLogInput) error {
	if strings.TrimSpace(input.Line) == "" {
		return nil
	}
	return s.appendRecord(ctx, "runtimeLogs", record{"id": stableID("rlog", input.ServiceID, input.DeploymentID, input.Line, now()), "serviceId": input.ServiceID, "deploymentId": nullable(input.DeploymentID), "podName": defaultString(input.PodName, "orchestrator"), "containerName": defaultString(input.ContainerName, "app"), "line": Redact(input.Line), "level": defaultString(input.Level, "info"), "timestamp": now()})
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

func projectFromRecord(row record) *Project {
	return &Project{ID: stringField(row, "id"), OrganizationID: stringField(row, "organizationId"), Name: stringField(row, "name"), Slug: stringField(row, "slug")}
}

func serviceFromRecord(row record) *Service {
	desiredSpec := mapField(row, "desiredSpec")
	desiredState := mapField(row, "desiredState")
	service := &Service{ID: stringField(row, "id"), ProjectID: stringField(row, "projectId"), Name: stringField(row, "name"), Slug: stringField(row, "slug"), Type: defaultString(stringField(row, "type"), "web"), ImageURL: coalesceString(stringField(row, "imageUrl"), stringField(row, "image"), stringField(desiredState, "imageUrl"), stringField(desiredState, "image")), Port: intField(row, "port"), Replicas: intField(desiredState, "replicas"), BaseDomain: coalesceString(stringField(row, "baseDomain"), stringField(desiredState, "baseDomain")), DesiredSpec: desiredSpec, DesiredState: desiredState}
	if service.Port == 0 {
		service.Port = intField(desiredState, "port")
	}
	if service.Port == 0 {
		service.Port = 3000
	}
	if service.Replicas == 0 {
		service.Replicas = 1
	}
	return service
}

func deploymentFromRecord(row record) *Deployment {
	return &Deployment{ID: stringField(row, "id"), ServiceID: stringField(row, "serviceId"), ProjectID: stringField(row, "projectId"), Status: stringField(row, "status"), DeploymentType: stringField(row, "deploymentType"), TriggerType: stringField(row, "triggerType"), Branch: stringField(row, "branch"), CommitSHA: coalesceString(stringField(row, "commitSha"), stringField(row, "commitHash")), ImageURL: stringField(row, "imageUrl"), ImageDigest: stringField(row, "imageDigest"), PreviewURL: stringField(row, "previewUrl"), PreviousImageURL: coalesceString(stringField(row, "previousImageUrl"), stringField(mapField(row, "desiredState"), "previousImageUrl")), PullRequestNumber: intField(row, "pullRequestNumber")}
}

func recordSlice(state map[string]any, key string) []record {
	items, ok := state[key].([]any)
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
	if row == nil || row[key] == nil {
		return ""
	}
	switch typed := row[key].(type) {
	case string:
		return typed
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
	if row == nil || row[key] == nil {
		return 0
	}
	switch typed := row[key].(type) {
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
	if row == nil || row[key] == nil {
		return map[string]any{}
	}
	if typed, ok := row[key].(map[string]any); ok {
		return cloneMap(typed)
	}
	return map[string]any{}
}

func cloneMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		if nested, ok := value.(map[string]any); ok {
			out[key] = cloneMap(nested)
		} else {
			out[key] = value
		}
	}
	return out
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
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

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func stableID(parts ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return parts[0] + "_" + hex.EncodeToString(hash[:])[:16]
}

func notFound(kind, id string) error { return fmt.Errorf("%s not found: %s", kind, id) }

var (
	secretAssignmentPattern = regexp.MustCompile(`(?i)([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|MONGODB_URI|REDIS_URL)[A-Z0-9_]*=)([^\s]+)`)
	knownTokenPattern       = regexp.MustCompile(`(?i)(ghp_|github_pat_|glpat-|sk-[A-Za-z0-9_-]*|xox[baprs]-)[A-Za-z0-9_\-]+`)
)

func Redact(value string) string {
	redacted := secretAssignmentPattern.ReplaceAllString(value, `$1****`)
	return knownTokenPattern.ReplaceAllString(redacted, `$1****`)
}

func MaskSecrets(input any) any {
	switch typed := input.(type) {
	case string:
		return Redact(typed)
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, value := range typed {
			if isSecretKey(key) {
				out[key] = "****"
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

func isSecretKey(key string) bool {
	upper := strings.ToUpper(key)
	return strings.Contains(upper, "SECRET") || strings.Contains(upper, "PASSWORD") || strings.Contains(upper, "TOKEN") || strings.Contains(upper, "KEY") || strings.Contains(upper, "DATABASE_URL") || strings.Contains(upper, "MONGODB_URI") || strings.Contains(upper, "REDIS_URL")
}
