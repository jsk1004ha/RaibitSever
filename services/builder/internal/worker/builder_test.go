package worker_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/raibitserver/builder/internal/controlplane"
	"github.com/raibitserver/builder/internal/worker"
)

func TestBuilderClaimsJobBuildsAndPersistsImageReadyState(t *testing.T) {
	stateFile := writeState(t, map[string]any{
		"projects": []any{map[string]any{"id": "prj_1", "name": "Demo", "slug": "demo"}},
		"services": []any{map[string]any{"id": "svc_1", "projectId": "prj_1", "name": "web", "slug": "web", "sourceType": "github", "buildMode": "dockerfile", "repoUrl": "https://github.com/acme/web.git", "branch": "main", "dockerfilePath": "Dockerfile", "registry": "registry.local"}},
		"deployments": []any{map[string]any{"id": "dep_1", "serviceId": "svc_1", "projectId": "prj_1", "status": "queued", "branch": "main", "commitSha": "abc123"}},
		"workflowJobs": []any{map[string]any{"id": "job_1", "type": "build-and-deploy", "status": "queued", "targetType": "deployment", "targetId": "dep_1", "payload": map[string]any{"deploymentId": "dep_1", "serviceId": "svc_1", "projectId": "prj_1", "buildArgs": map[string]any{"SECRET_TOKEN": "super-secret-value"}}, "attempts": 0, "maxAttempts": 2, "runAfter": "2026-01-01T00:00:00Z"}},
	})

	builder := worker.New(controlplane.NewFileStore(stateFile), worker.OSRunner{}, worker.Config{WorkerID: "builder-test", WorkspaceDir: t.TempDir(), Registry: "registry.local", DryRun: true, Push: true})
	result, err := builder.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}
	if !result.Processed || result.JobID != "job_1" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ImageDigest == "" || !strings.HasPrefix(result.ImageDigest, "sha256:") {
		t.Fatalf("expected deterministic image digest, got %q", result.ImageDigest)
	}

	state := readState(t, stateFile)
	deployment := firstByID(t, state, "deployments", "dep_1")
	if deployment["status"] != "IMAGE_READY" {
		t.Fatalf("deployment not image-ready: %#v", deployment)
	}
	if deployment["imageDigest"] != result.ImageDigest {
		t.Fatalf("image digest not persisted: %#v", deployment)
	}
	job := firstByID(t, state, "workflowJobs", "job_1")
	if job["status"] != "succeeded" || job["lockedBy"] != nil {
		t.Fatalf("job not completed and unlocked: %#v", job)
	}
	logs := mustArray(state["buildLogs"])
	joined := marshalString(t, logs)
	if !strings.Contains(joined, "git clone") || !strings.Contains(joined, "docker buildx build") || !strings.Contains(joined, "--push") {
		t.Fatalf("expected clone/build/push log lines, got %s", joined)
	}
	if strings.Contains(joined, "super-secret-value") {
		t.Fatalf("build logs leaked secret build arg: %s", joined)
	}
	events := marshalString(t, state["deploymentEvents"])
	if !strings.Contains(events, "build.image_ready") {
		t.Fatalf("expected image-ready event, got %s", events)
	}
}

func TestBuilderGeneratesDockerfileForLocalSourceFallback(t *testing.T) {
	sourceDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(sourceDir, "package.json"), []byte(`{"scripts":{"start":"node server.js"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	stateFile := writeState(t, map[string]any{
		"projects": []any{map[string]any{"id": "prj_1", "name": "Demo", "slug": "demo"}},
		"services": []any{map[string]any{"id": "svc_1", "projectId": "prj_1", "name": "api", "slug": "api", "sourceType": "local", "buildMode": "auto", "localPath": sourceDir, "buildCommand": "npm run build", "startCommand": "node server.js"}},
		"deployments": []any{map[string]any{"id": "dep_1", "serviceId": "svc_1", "projectId": "prj_1", "status": "queued", "commitSha": "local"}},
		"workflowJobs": []any{map[string]any{"id": "job_1", "type": "build-and-deploy", "status": "queued", "targetType": "deployment", "targetId": "dep_1", "payload": map[string]any{"deploymentId": "dep_1", "serviceId": "svc_1", "projectId": "prj_1"}, "attempts": 0, "maxAttempts": 1, "runAfter": "2026-01-01T00:00:00Z"}},
	})

	builder := worker.New(controlplane.NewFileStore(stateFile), worker.OSRunner{}, worker.Config{WorkspaceDir: t.TempDir(), Registry: "registry.local", DryRun: true})
	result, err := builder.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}
	if result.Image == "" {
		t.Fatal("expected generated image reference")
	}
	generated, err := os.ReadFile(filepath.Join(sourceDir, "Dockerfile"))
	if err != nil {
		t.Fatalf("expected generated Dockerfile: %v", err)
	}
	if !strings.Contains(string(generated), "npm run build") || !strings.Contains(string(generated), "node server.js") {
		t.Fatalf("generated Dockerfile does not include service commands: %s", string(generated))
	}
	logs := marshalString(t, readState(t, stateFile)["buildLogs"])
	if !strings.Contains(logs, "generated Dockerfile") {
		t.Fatalf("expected generated Dockerfile log, got %s", logs)
	}
}

func TestBuilderFailureMarksDeploymentAndWorkflowWithoutLeakingCredentials(t *testing.T) {
	stateFile := writeState(t, map[string]any{
		"projects": []any{map[string]any{"id": "prj_1", "name": "Demo", "slug": "demo"}},
		"services": []any{map[string]any{"id": "svc_1", "projectId": "prj_1", "name": "web", "slug": "web", "sourceType": "github", "buildMode": "dockerfile", "repoUrl": "https://ghp_secret-token@github.com/acme/web.git"}},
		"deployments": []any{map[string]any{"id": "dep_1", "serviceId": "svc_1", "projectId": "prj_1", "status": "queued"}},
		"workflowJobs": []any{map[string]any{"id": "job_1", "type": "build-and-deploy", "status": "queued", "targetType": "deployment", "targetId": "dep_1", "payload": map[string]any{"deploymentId": "dep_1", "serviceId": "svc_1", "projectId": "prj_1"}, "attempts": 0, "maxAttempts": 1, "runAfter": "2026-01-01T00:00:00Z"}},
	})
	builder := worker.New(controlplane.NewFileStore(stateFile), worker.OSRunner{}, worker.Config{WorkspaceDir: t.TempDir(), Registry: "registry.local", DryRun: true})
	if _, err := builder.RunOnce(context.Background()); err == nil {
		t.Fatal("expected credentialed URL failure")
	}
	state := readState(t, stateFile)
	deployment := firstByID(t, state, "deployments", "dep_1")
	if deployment["status"] != "BUILD_FAILED" {
		t.Fatalf("deployment not failed: %#v", deployment)
	}
	job := firstByID(t, state, "workflowJobs", "job_1")
	if job["status"] != "failed" {
		t.Fatalf("job not failed: %#v", job)
	}
	serialized := marshalString(t, state)
	if strings.Contains(serialized, "ghp_secret-token") {
		t.Fatalf("state leaked credential token: %s", serialized)
	}
}

func writeState(t *testing.T, state map[string]any) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "state.json")
	bytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, bytes, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func readState(t *testing.T, path string) map[string]any {
	t.Helper()
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	if err := json.Unmarshal(bytes, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func firstByID(t *testing.T, state map[string]any, key, id string) map[string]any {
	t.Helper()
	for _, item := range mustArray(state[key]) {
		row, ok := item.(map[string]any)
		if ok && row["id"] == id {
			return row
		}
	}
	t.Fatalf("%s %s not found in %#v", key, id, state[key])
	return nil
}

func mustArray(value any) []any {
	rows, _ := value.([]any)
	return rows
}

func marshalString(t *testing.T, value any) string {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(bytes)
}
