package worker

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
	"strings"
	"time"

	buildplan "github.com/raibitserver/builder/internal/build"
	"github.com/raibitserver/builder/internal/controlplane"
)

const (
	DeploymentStatusBuilding    = "BUILDING"
	DeploymentStatusImageReady  = "IMAGE_READY"
	DeploymentStatusBuildFailed = controlplane.ErrorCodeBuildFailed
)

type Config struct {
	WorkerID     string
	WorkspaceDir string
	Registry     string
	DryRun       bool
	Push         bool
	Builder      string
	Timeout      time.Duration
	LeaseSeconds int
	MetadataDir  string
}

type Builder struct {
	Store  controlplane.Store
	Runner CommandRunner
	Config Config
}

type Result struct {
	Processed    bool           `json:"processed"`
	JobID        string         `json:"jobId,omitempty"`
	DeploymentID string         `json:"deploymentId,omitempty"`
	ServiceID    string         `json:"serviceId,omitempty"`
	ProjectID    string         `json:"projectId,omitempty"`
	Image        string         `json:"image,omitempty"`
	ImageDigest  string         `json:"imageDigest,omitempty"`
	DryRun       bool           `json:"dryRun"`
	Steps        []StepResult   `json:"steps,omitempty"`
	Reason       string         `json:"reason,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

type StepResult struct {
	Type    string `json:"type"`
	Command string `json:"command,omitempty"`
	DryRun  bool   `json:"dryRun"`
	Detail  string `json:"detail,omitempty"`
}

type buildContext struct {
	Job          *controlplane.WorkflowJob
	Deployment   *controlplane.Deployment
	Service      *controlplane.Service
	Project      *controlplane.Project
	Plan         buildplan.Plan
	SourceDir    string
	Dockerfile   string
	ContextDir   string
	Image        string
	Push         bool
	MetadataFile string
	Steps        []StepResult
}

func New(store controlplane.Store, runner CommandRunner, config Config) *Builder {
	if runner == nil {
		runner = OSRunner{}
	}
	if config.WorkerID == "" {
		config.WorkerID = "raibitserver-builder"
	}
	if config.WorkspaceDir == "" {
		config.WorkspaceDir = filepath.Join(os.TempDir(), "raibitserver-builder")
	}
	if config.Registry == "" {
		config.Registry = "localhost:5000"
	}
	if config.Builder == "" {
		config.Builder = "docker-buildx"
	}
	if config.Timeout <= 0 {
		config.Timeout = 30 * time.Minute
	}
	return &Builder{Store: store, Runner: runner, Config: config}
}

func (b *Builder) RunOnce(ctx context.Context) (*Result, error) {
	if b.Store == nil {
		return nil, errors.New("builder store is required")
	}
	job, err := b.Store.ClaimNextWorkflowJob(ctx, controlplane.ClaimOptions{WorkerID: b.Config.WorkerID, LeaseSeconds: b.Config.LeaseSeconds})
	if err != nil {
		return nil, err
	}
	if job == nil {
		return &Result{Processed: false, DryRun: b.Config.DryRun, Reason: "no_ready_workflow_jobs"}, nil
	}
	result, err := b.processClaimedJob(ctx, job)
	if err != nil {
		_ = b.Store.FailWorkflowJob(ctx, job.ID, err)
		return result, err
	}
	return result, nil
}

func (b *Builder) processClaimedJob(ctx context.Context, job *controlplane.WorkflowJob) (*Result, error) {
	state, err := b.resolveState(ctx, job)
	if err != nil {
		return &Result{Processed: true, JobID: job.ID, DryRun: b.Config.DryRun}, err
	}
	result := &Result{Processed: true, JobID: job.ID, DeploymentID: state.Deployment.ID, ServiceID: state.Service.ID, ProjectID: state.Project.ID, DryRun: b.Config.DryRun}
	if err := b.markBuilding(ctx, state); err != nil {
		return result, err
	}
	if err := b.writeLog(ctx, state, "claim", fmt.Sprintf("claimed workflow job %s for deployment %s", job.ID, state.Deployment.ID), "info"); err != nil {
		return result, err
	}
	if err := b.prepareSource(ctx, state); err != nil {
		_ = b.markFailed(ctx, state, err)
		return result, err
	}
	if err := b.prepareBuildPlan(ctx, state); err != nil {
		_ = b.markFailed(ctx, state, err)
		return result, err
	}
	if err := b.executeBuild(ctx, state); err != nil {
		_ = b.markFailed(ctx, state, err)
		return result, err
	}
	digest := b.resolveDigest(state)
	updates := map[string]any{
		"status":          DeploymentStatusImageReady,
		"imageUrl":        state.Image,
		"imageDigest":     digest,
		"buildFinishedAt": time.Now().UTC().Format(time.RFC3339Nano),
		"errorCode":       nil,
		"errorMessage":    nil,
	}
	if _, err := b.Store.UpdateDeployment(ctx, state.Deployment.ID, updates); err != nil {
		return result, err
	}
	_, _ = b.Store.UpdateService(ctx, state.Service.ID, map[string]any{"imageUrl": state.Image, "image": state.Image, "status": "image-ready"})
	if err := b.Store.AppendDeploymentEvent(ctx, controlplane.DeploymentEventInput{DeploymentID: state.Deployment.ID, Type: "build.image_ready", Message: "image built and ready for orchestration", Metadata: map[string]any{"image": state.Image, "imageDigest": digest, "dryRun": b.Config.DryRun}}); err != nil {
		return result, err
	}
	if err := b.Store.CompleteWorkflowJob(ctx, job.ID, map[string]any{"deploymentId": state.Deployment.ID, "serviceId": state.Service.ID, "image": state.Image, "imageDigest": digest, "dryRun": b.Config.DryRun}); err != nil {
		return result, err
	}
	result.Image = state.Image
	result.ImageDigest = digest
	result.Steps = state.Steps
	result.Metadata = map[string]any{"mode": state.Plan.Mode, "sourceDir": state.SourceDir, "dockerfile": state.Dockerfile, "builder": b.Config.Builder}
	return result, nil
}

func (b *Builder) resolveState(ctx context.Context, job *controlplane.WorkflowJob) (*buildContext, error) {
	deploymentID := stringValue(job.Payload["deploymentId"])
	if deploymentID == "" && job.TargetType == "deployment" {
		deploymentID = job.TargetID
	}
	if deploymentID == "" {
		return nil, errors.New("workflow job payload.deploymentId or deployment targetId is required")
	}
	deployment, err := b.Store.GetDeployment(ctx, deploymentID)
	if err != nil {
		return nil, err
	}
	serviceID := firstNonEmpty(deployment.ServiceID, stringValue(job.Payload["serviceId"]))
	service, err := b.Store.GetService(ctx, serviceID)
	if err != nil {
		return nil, err
	}
	projectID := firstNonEmpty(deployment.ProjectID, service.ProjectID, stringValue(job.Payload["projectId"]))
	project, err := b.Store.GetProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &buildContext{Job: job, Deployment: deployment, Service: service, Project: project}, nil
}

func (b *Builder) markBuilding(ctx context.Context, state *buildContext) error {
	_, err := b.Store.UpdateDeployment(ctx, state.Deployment.ID, map[string]any{"status": DeploymentStatusBuilding, "buildStartedAt": time.Now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return err
	}
	return b.Store.AppendDeploymentEvent(ctx, controlplane.DeploymentEventInput{DeploymentID: state.Deployment.ID, Type: "build.started", Message: "builder claimed deployment and started image workflow", Metadata: map[string]any{"jobId": state.Job.ID, "workerId": b.Config.WorkerID, "dryRun": b.Config.DryRun}})
}

func (b *Builder) markFailed(ctx context.Context, state *buildContext, failure error) error {
	_ = b.writeLog(ctx, state, "error", failure.Error(), "error")
	errorSpec := controlplane.ErrorSpecForFailure(failure, controlplane.ErrorCodeBuildFailed)
	_, err := b.Store.UpdateDeployment(ctx, state.Deployment.ID, map[string]any{"status": DeploymentStatusBuildFailed, "buildFinishedAt": time.Now().UTC().Format(time.RFC3339Nano), "errorCode": errorSpec.Code, "errorMessage": errorSpec.Message})
	if err != nil {
		return err
	}
	return b.Store.AppendDeploymentEvent(ctx, controlplane.DeploymentEventInput{DeploymentID: state.Deployment.ID, Type: "build.failed", Message: errorSpec.Message, Metadata: map[string]any{"jobId": state.Job.ID, "errorSpec": errorSpec}})
}

func (b *Builder) prepareSource(ctx context.Context, state *buildContext) error {
	workspace := filepath.Join(b.Config.WorkspaceDir, state.Job.ID)
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		return err
	}
	localPath := firstNonEmpty(stringValue(state.Job.Payload["localPath"]), state.Service.LocalPath)
	if localPath != "" {
		sourceDir, err := b.resolveLocalSourceDir(localPath)
		if err != nil {
			return err
		}
		state.SourceDir = sourceDir
		state.Steps = append(state.Steps, StepResult{Type: "source-local", DryRun: b.Config.DryRun, Detail: localPath})
		return b.writeLog(ctx, state, "source", "using local source path "+localPath, "info")
	}
	repoURL := firstNonEmpty(stringValue(state.Job.Payload["repoUrl"]), state.Service.RepoURL)
	if isPrebuilt(state.Service, state.Deployment) {
		state.SourceDir = workspace
		return nil
	}
	if repoURL == "" {
		return errors.New("source repository URL is required for non-prebuilt build")
	}
	if isCredentialedURL(repoURL) {
		_, _ = b.Store.UpdateService(ctx, state.Service.ID, map[string]any{"repoUrl": controlplane.Redact(repoURL)})
		return errors.New("credentialed git URLs are not allowed; use secret-backed askpass/token environment")
	}
	branch := firstNonEmpty(stringValue(state.Job.Payload["branch"]), state.Deployment.Branch, state.Service.Branch, "main")
	destination := filepath.Join(workspace, "source")
	args := []string{"clone", "--depth", "1", "--branch", branch, repoURL, destination}
	command := Command{Name: "git", Args: args, Redacted: "git " + strings.Join(redactArgs(args), " ")}
	result, err := b.Runner.Run(ctx, command, CommandOptions{DryRun: b.Config.DryRun, Timeout: b.Config.Timeout})
	state.Steps = append(state.Steps, StepResult{Type: "git-clone", Command: result.Command, DryRun: result.DryRun})
	_ = b.writeCommandLogs(ctx, state, "clone", result)
	if err != nil {
		return err
	}
	commit := firstNonEmpty(stringValue(state.Job.Payload["commitSha"]), state.Deployment.CommitSHA, state.Deployment.CommitHash)
	if commit != "" {
		checkout := Command{Name: "git", Args: []string{"checkout", commit}, Dir: destination}
		checkoutResult, err := b.Runner.Run(ctx, checkout, CommandOptions{DryRun: b.Config.DryRun, Timeout: b.Config.Timeout})
		state.Steps = append(state.Steps, StepResult{Type: "git-checkout", Command: checkoutResult.Command, DryRun: checkoutResult.DryRun})
		_ = b.writeCommandLogs(ctx, state, "clone", checkoutResult)
		if err != nil {
			return err
		}
	}
	state.SourceDir = destination
	return nil
}

func (b *Builder) prepareBuildPlan(ctx context.Context, state *buildContext) error {
	mode := normalizeMode(firstNonEmpty(stringValue(state.Job.Payload["buildMode"]), state.Service.BuildMode, envOr("RAIBITSERVER_BUILD_MODE", "auto")))
	if isPrebuilt(state.Service, state.Deployment) {
		mode = "prebuilt-image"
	}
	source := firstNonEmpty(state.Service.RepoURL, state.Service.LocalPath, state.SourceDir)
	image := b.resolveImage(state)
	plan := buildplan.Plan{Mode: mode, Source: source, Image: image, ProjectID: state.Project.ID, ServiceID: state.Service.ID, DeploymentID: state.Deployment.ID}
	if err := plan.Validate(ctx); err != nil {
		return err
	}
	state.Plan = plan
	state.Image = image
	state.Push = b.Config.Push || b.Config.DryRun
	contextDir, err := resolvePathWithinSourceDir(state.SourceDir, firstNonEmpty(stringValue(state.Job.Payload["buildContext"]), state.Service.BuildContext, state.Service.RootDirectory, "."), "buildContext")
	if err != nil {
		return err
	}
	state.ContextDir = contextDir
	if isPrebuilt(state.Service, state.Deployment) || mode == "prebuilt-image" {
		return nil
	}
	dockerfilePath := firstNonEmpty(stringValue(state.Job.Payload["dockerfilePath"]), state.Service.DockerfilePath, "Dockerfile")
	resolvedDockerfile, err := resolvePathWithinSourceDir(state.SourceDir, dockerfilePath, "dockerfilePath")
	if err != nil {
		return err
	}
	state.Dockerfile = resolvedDockerfile
	if mode == "dockerfile" || fileExists(state.Dockerfile) {
		state.Plan.Mode = "dockerfile"
		return b.writeLog(ctx, state, "plan", "Dockerfile selected before generated build strategy", "info")
	}
	state.Plan.Mode = "generated"
	return b.writeGeneratedDockerfile(ctx, state)
}

func resolvePathWithinSourceDir(sourceDir, candidate, field string) (string, error) {
	if filepath.IsAbs(candidate) {
		return "", fmt.Errorf("%s must be relative to source directory", field)
	}
	sourceRoot, err := filepath.Abs(filepath.Clean(sourceDir))
	if err != nil {
		return "", err
	}
	resolvedPath, err := filepath.Abs(filepath.Join(sourceRoot, candidate))
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(sourceRoot, resolvedPath)
	if err != nil {
		return "", err
	}
	if relative == "." || relative == "" {
		return resolvedPath, nil
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) || filepath.IsAbs(relative) {
		return "", fmt.Errorf("%s escapes source directory", field)
	}
	return resolvedPath, nil
}

func (b *Builder) executeBuild(ctx context.Context, state *buildContext) error {
	if isPrebuilt(state.Service, state.Deployment) || state.Plan.Mode == "prebuilt-image" {
		if err := b.writeLog(ctx, state, "image", "using prebuilt image "+state.Image, "info"); err != nil {
			return err
		}
		if state.Push && stringValue(state.Job.Payload["retagImage"]) == "true" {
			return b.runDockerPush(ctx, state)
		}
		return nil
	}
	if err := os.MkdirAll(b.metadataDir(), 0o755); err != nil {
		return err
	}
	state.MetadataFile = filepath.Join(b.metadataDir(), state.Job.ID+"-buildx.json")
	var command Command
	if b.Config.Builder == "buildctl" {
		command = Command{Name: "buildctl", Args: []string{"build", "--frontend", "dockerfile.v0", "--local", "context=" + state.ContextDir, "--local", "dockerfile=" + filepath.Dir(state.Dockerfile), "--output", fmt.Sprintf("type=image,name=%s,push=%t", state.Image, state.Push)}}
	} else {
		args := []string{"buildx", "build", "--file", state.Dockerfile, "--tag", state.Image, "--metadata-file", state.MetadataFile}
		if state.Push {
			args = append(args, "--push")
		} else {
			args = append(args, "--load")
		}
		args = append(args, buildCacheArgs(state)...)
		for key, value := range buildArgsFromPayload(state.Job.Payload) {
			args = append(args, "--build-arg", key+"="+value)
		}
		args = append(args, state.ContextDir)
		command = Command{Name: "docker", Args: args, Redacted: "docker " + strings.Join(redactArgs(args), " ")}
	}
	result, err := b.Runner.Run(ctx, command, CommandOptions{DryRun: b.Config.DryRun, Timeout: b.Config.Timeout})
	state.Steps = append(state.Steps, StepResult{Type: "buildkit-build", Command: result.Command, DryRun: result.DryRun})
	_ = b.writeCommandLogs(ctx, state, "build", result)
	if err != nil {
		return err
	}
	if state.Push && b.Config.Builder != "buildctl" && !strings.Contains(result.Command, "--push") {
		return b.runDockerPush(ctx, state)
	}
	return nil
}

func (b *Builder) runDockerPush(ctx context.Context, state *buildContext) error {
	command := Command{Name: "docker", Args: []string{"push", state.Image}}
	result, err := b.Runner.Run(ctx, command, CommandOptions{DryRun: b.Config.DryRun, Timeout: b.Config.Timeout})
	state.Steps = append(state.Steps, StepResult{Type: "registry-push", Command: result.Command, DryRun: result.DryRun})
	_ = b.writeCommandLogs(ctx, state, "push", result)
	return err
}

func (b *Builder) writeGeneratedDockerfile(ctx context.Context, state *buildContext) error {
	if state.Dockerfile == "" {
		state.Dockerfile = filepath.Join(state.SourceDir, "Dockerfile.raibitserver")
	}
	if err := os.MkdirAll(filepath.Dir(state.Dockerfile), 0o755); err != nil {
		return err
	}
	start := firstNonEmpty(state.Service.StartCommand, "npm start")
	build := firstNonEmpty(state.Service.BuildCommand, "npm run build --if-present")
	install := firstNonEmpty(state.Service.InstallCommand, "if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; elif [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; elif [ -f package-lock.json ]; then npm ci; elif [ -f requirements.txt ]; then pip install --cache-dir=/root/.cache/pip -r requirements.txt; elif [ -f package.json ]; then npm install; fi")
	content := fmt.Sprintf("# syntax=docker/dockerfile:1.7\nFROM node:24-alpine\nWORKDIR /app\nCOPY . .\nRUN --mount=type=cache,target=/root/.npm --mount=type=cache,target=/root/.pnpm-store --mount=type=cache,target=/root/.cache/yarn --mount=type=cache,target=/root/.cache/pip %s\nRUN %s\nENV NODE_ENV=production\nCMD [\"sh\", \"-lc\", %q]\n", install, build, start)
	if err := os.WriteFile(state.Dockerfile, []byte(content), 0o644); err != nil {
		return err
	}
	state.Steps = append(state.Steps, StepResult{Type: "generated-dockerfile", DryRun: b.Config.DryRun, Detail: state.Dockerfile})
	return b.writeLog(ctx, state, "plan", "generated Dockerfile for framework/buildpack fallback", "info")
}

func (b *Builder) resolveDigest(state *buildContext) string {
	if state.Deployment.ImageDigest != "" {
		return state.Deployment.ImageDigest
	}
	if digest := digestFromImage(state.Image); digest != "" {
		return digest
	}
	if state.MetadataFile != "" {
		if bytes, err := os.ReadFile(state.MetadataFile); err == nil {
			var metadata map[string]any
			if json.Unmarshal(bytes, &metadata) == nil {
				for _, key := range []string{"containerimage.digest", "buildx.build.ref"} {
					if digest := stringValue(metadata[key]); strings.HasPrefix(digest, "sha256:") {
						return digest
					}
				}
			}
		}
	}
	return deterministicDigest(state.Job.ID, state.Deployment.ID, state.Image, state.Deployment.CommitSHA, state.Deployment.CommitHash)
}

func (b *Builder) resolveImage(state *buildContext) string {
	if image := firstNonEmpty(stringValue(state.Job.Payload["image"]), stringValue(state.Job.Payload["imageUrl"]), state.Deployment.ImageURL, state.Service.ImageURL, state.Service.Image); image != "" {
		return image
	}
	registry := firstNonEmpty(stringValue(state.Job.Payload["registry"]), state.Service.Registry, b.Config.Registry)
	projectSlug := slug(firstNonEmpty(state.Project.Slug, state.Project.Name, state.Project.ID, "project"))
	serviceSlug := slug(firstNonEmpty(state.Service.Slug, state.Service.Name, state.Service.ID, "service"))
	tag := slug(firstNonEmpty(state.Deployment.CommitSHA, state.Deployment.CommitHash, stringValue(state.Job.Payload["commitSha"]), state.Job.ID))
	return strings.TrimRight(registry, "/") + "/" + projectSlug + "/" + serviceSlug + ":" + tag
}

func (b *Builder) metadataDir() string {
	if b.Config.MetadataDir != "" {
		return b.Config.MetadataDir
	}
	return filepath.Join(b.Config.WorkspaceDir, "metadata")
}

func (b *Builder) resolveLocalSourceDir(localPath string) (string, error) {
	sourceDir := filepath.Clean(localPath)
	if !filepath.IsAbs(sourceDir) {
		sourceDir = filepath.Join(b.Config.WorkspaceDir, sourceDir)
	}
	return resolvePathWithin(b.Config.WorkspaceDir, sourceDir)
}

func resolvePathWithin(baseDir, value string) (string, error) {
	base := filepath.Clean(baseDir)
	if !filepath.IsAbs(base) {
		absBase, err := filepath.Abs(base)
		if err != nil {
			return "", err
		}
		base = absBase
	}
	candidate := value
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(base, candidate)
	}
	candidate = filepath.Clean(candidate)
	rel, err := filepath.Rel(base, candidate)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path %q escapes allowed base directory", value)
	}
	return candidate, nil
}

func buildCacheArgs(state *buildContext) []string {
	if stringValue(state.Job.Payload["cache"]) == "false" || stringValue(state.Job.Payload["buildCache"]) == "false" {
		return nil
	}
	cacheRef := firstNonEmpty(stringValue(state.Job.Payload["cacheRef"]), stringValue(state.Job.Payload["buildCacheRef"]), os.Getenv("RAIBITSERVER_BUILDKIT_CACHE_REF"))
	cacheMode := firstNonEmpty(stringValue(state.Job.Payload["buildCache"]), os.Getenv("RAIBITSERVER_BUILDKIT_CACHE"))
	if cacheRef == "" && (cacheMode == "registry" || cacheMode == "true") {
		cacheRef = state.Image + "-buildcache"
	}
	if cacheRef != "" {
		return []string{"--cache-from", "type=registry,ref=" + cacheRef, "--cache-to", "type=registry,ref=" + cacheRef + ",mode=max"}
	}
	return []string{"--cache-to", "type=inline"}
}

func (b *Builder) writeLog(ctx context.Context, state *buildContext, step, line, level string) error {
	return b.Store.AppendBuildLog(ctx, controlplane.BuildLogInput{DeploymentID: state.Deployment.ID, Step: step, Line: line, Level: level})
}

func (b *Builder) writeCommandLogs(ctx context.Context, state *buildContext, step string, result CommandResult) error {
	if err := b.writeLog(ctx, state, step, "$ "+result.Command, "info"); err != nil {
		return err
	}
	for _, line := range splitLines(result.Stdout) {
		if err := b.writeLog(ctx, state, step, line, "info"); err != nil {
			return err
		}
	}
	for _, line := range splitLines(result.Stderr) {
		if err := b.writeLog(ctx, state, step, line, "warn"); err != nil {
			return err
		}
	}
	return nil
}

func ConfigFromEnv() Config {
	dryRun := os.Getenv("RAIBITSERVER_EXECUTE") != "1"
	timeout := 30 * time.Minute
	if value := os.Getenv("RAIBITSERVER_BUILD_TIMEOUT_SECONDS"); value != "" {
		if parsed, err := time.ParseDuration(value + "s"); err == nil {
			timeout = parsed
		}
	}
	return Config{
		WorkerID:     envOr("RAIBITSERVER_WORKER_ID", "raibitserver-builder"),
		WorkspaceDir: envOr("RAIBITSERVER_WORKSPACE", filepath.Join(os.TempDir(), "raibitserver-builder")),
		Registry:     envOr("RAIBITSERVER_REGISTRY", "localhost:5000"),
		DryRun:       dryRun,
		Push:         os.Getenv("RAIBITSERVER_PUSH") == "1",
		Builder:      envOr("RAIBITSERVER_BUILDER", "docker-buildx"),
		Timeout:      timeout,
		LeaseSeconds: intFromEnv("RAIBITSERVER_WORKFLOW_LEASE_SECONDS", 300),
		MetadataDir:  os.Getenv("RAIBITSERVER_BUILD_METADATA_DIR"),
	}
}

func StateFileFromEnv() string {
	return firstNonEmpty(os.Getenv("RAIBITSERVER_CONTROL_PLANE_FILE"), os.Getenv("RAIBITSERVER_STATE_FILE"), os.Getenv("RAIBITSERVER_WORKFLOW_STATE"))
}

func isPrebuilt(service *controlplane.Service, deployment *controlplane.Deployment) bool {
	source := strings.ToLower(service.SourceType)
	mode := normalizeMode(service.BuildMode)
	return source == "image" || mode == "prebuilt-image" || (service.RepoURL == "" && service.LocalPath == "" && firstNonEmpty(deployment.ImageURL, service.ImageURL, service.Image) != "")
}

func normalizeMode(value string) string {
	normalized := strings.ToLower(strings.ReplaceAll(value, "_", "-"))
	switch normalized {
	case "", "auto":
		return "auto"
	case "docker", "dockerfile":
		return "dockerfile"
	case "image", "prebuilt", "prebuilt-image":
		return "prebuilt-image"
	case "generated", "framework", "buildpack", "buildpacks", "custom":
		return normalized
	default:
		return "auto"
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func intFromEnv(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		var parsed int
		if _, err := fmt.Sscanf(value, "%d", &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func buildArgsFromPayload(payload map[string]any) map[string]string {
	value, ok := payload["buildArgs"].(map[string]any)
	if !ok {
		return map[string]string{}
	}
	out := map[string]string{}
	for key, item := range value {
		out[key] = stringValue(item)
	}
	return out
}

func splitLines(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
}

func digestFromImage(image string) string {
	parts := strings.SplitN(image, "@", 2)
	if len(parts) == 2 && strings.HasPrefix(parts[1], "sha256:") {
		return parts[1]
	}
	return ""
}

func deterministicDigest(parts ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return "sha256:" + hex.EncodeToString(hash[:])
}

var slugPattern = regexp.MustCompile(`[^a-z0-9._-]+`)

func slug(value string) string {
	out := strings.ToLower(strings.TrimSpace(value))
	out = slugPattern.ReplaceAllString(out, "-")
	out = strings.Trim(out, "-._")
	if out == "" {
		return "item"
	}
	return out
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func isCredentialedURL(value string) bool {
	return strings.HasPrefix(value, "https://") && strings.Contains(strings.TrimPrefix(value, "https://"), "@")
}

func redactArgs(args []string) []string {
	out := make([]string, len(args))
	for i, arg := range args {
		out[i] = controlplane.Redact(arg)
		if isCredentialedURL(arg) {
			parts := strings.SplitN(arg, "@", 2)
			out[i] = "https://****@" + parts[1]
		}
	}
	return out
}
