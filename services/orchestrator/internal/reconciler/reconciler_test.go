package reconciler

import (
	"context"
	"testing"
)

func TestRunOnceHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	r := NewServiceReconciler(Config{DryRun: true})
	if err := r.RunOnce(ctx); err != context.Canceled {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}

func TestRunOnceDryRunCompletesWithoutExternalSideEffects(t *testing.T) {
	r := NewServiceReconciler(Config{DryRun: true})
	if err := r.RunOnce(context.Background()); err != nil {
		t.Fatalf("expected dry-run reconcile to complete: %v", err)
	}
}
