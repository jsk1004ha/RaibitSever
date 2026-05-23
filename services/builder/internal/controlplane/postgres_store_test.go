package controlplane

import (
	"strings"
	"testing"
)

func TestPostgresDSNFromEnvRequiresExplicitControlPlaneSelection(t *testing.T) {
	if got := PostgresDSNFromEnv(map[string]string{"DATABASE_URL": "postgresql://app:secret@localhost/db"}); got != "" {
		t.Fatalf("DATABASE_URL alone should not opt the local builder into PostgreSQL store, got %q", got)
	}
	if got := PostgresDSNFromEnv(map[string]string{"RAIBITSERVER_CONTROL_PLANE_STORE": "postgresql", "DATABASE_URL": "postgresql://app:secret@localhost/db"}); got != "postgresql://app:secret@localhost/db" {
		t.Fatalf("expected DATABASE_URL when PostgreSQL store mode is explicit, got %q", got)
	}
	if got := PostgresDSNFromEnv(map[string]string{"RAIBITSERVER_CONTROL_PLANE_DATABASE_URL": "postgresql://cp:secret@localhost/control", "DATABASE_URL": "postgresql://app:secret@localhost/db"}); got != "postgresql://cp:secret@localhost/control" {
		t.Fatalf("expected dedicated control-plane DSN to win, got %q", got)
	}
}

func TestRedactDSNMasksPassword(t *testing.T) {
	redacted := RedactDSN("postgresql://builder:super-secret@localhost:5432/raibitserver?sslmode=disable")
	if strings.Contains(redacted, "super-secret") {
		t.Fatalf("redacted DSN leaked password: %s", redacted)
	}
	if !strings.Contains(redacted, "builder") || !strings.Contains(redacted, "redacted") {
		t.Fatalf("redacted DSN should preserve username and mask password, got %s", redacted)
	}
}

func TestPostgresUpdateAssignmentsAreWhitelistedDeterministicAndMasked(t *testing.T) {
	assignments, args, err := updateAssignments(map[string]any{
		"imageUrl":     "localhost:5000/demo/web:latest",
		"errorMessage": "DATABASE_URL=postgresql://user:secret@localhost/db failed",
	}, deploymentUpdateColumns)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(assignments, ",") != `"errorMessage" = $1,"imageUrl" = $2` {
		t.Fatalf("assignments should be sorted for deterministic SQL, got %#v", assignments)
	}
	if strings.Contains(args[0].(string), "secret") || !strings.Contains(args[0].(string), "DATABASE_URL=****") {
		t.Fatalf("secret-looking update value was not masked: %#v", args[0])
	}
	if _, _, err := updateAssignments(map[string]any{"desiredState": map[string]any{}}, deploymentUpdateColumns); err == nil {
		t.Fatal("expected unsupported update fields to fail closed")
	}
}

func TestPostgresClaimSQLCoversQueuedAndStaleRunningJobs(t *testing.T) {
	normalized := strings.Join(strings.Fields(claimWorkflowJobSQL), " ")
	for _, fragment := range []string{
		`status = $1`,
		`status = $4`,
		`"lockedAt" <= $3`,
		`attempts < "maxAttempts"`,
		`FOR UPDATE SKIP LOCKED`,
	} {
		if !strings.Contains(normalized, fragment) {
			t.Fatalf("claim SQL missing %q in %s", fragment, normalized)
		}
	}
}
