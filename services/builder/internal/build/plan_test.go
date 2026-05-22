package build

import (
	"context"
	"testing"
)

func TestPlanValidateRequiresImageForPrebuilt(t *testing.T) {
	if err := (Plan{Mode: "prebuilt-image"}).Validate(context.Background()); err == nil {
		t.Fatal("expected prebuilt-image mode without image to fail")
	}

	if err := (Plan{Mode: "prebuilt-image", Image: "registry.local/app/web:latest"}).Validate(context.Background()); err != nil {
		t.Fatalf("expected prebuilt-image with image to pass: %v", err)
	}
}

func TestPlanValidateRequiresSourceForBuildModes(t *testing.T) {
	if err := (Plan{Mode: "auto"}).Validate(context.Background()); err == nil {
		t.Fatal("expected build mode without source to fail")
	}

	if err := (Plan{Mode: "auto", Source: "https://github.com/org/repo"}).Validate(context.Background()); err != nil {
		t.Fatalf("expected build mode with source to pass: %v", err)
	}
}

func TestPlanValidateHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := (Plan{Mode: "auto", Source: "https://github.com/org/repo"}).Validate(ctx); err != context.Canceled {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}
