package build

import (
	"context"
	"errors"
	"strings"
)

type Plan struct {
	Mode         string
	Source       string
	Image        string
	ProjectID    string
	ServiceID    string
	DeploymentID string
}

func (p Plan) Validate(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	mode := normalizeMode(p.Mode)
	if mode == "prebuilt-image" && p.Image == "" {
		return errors.New("prebuilt-image mode requires image")
	}
	if mode != "prebuilt-image" && p.Source == "" {
		return errors.New("source is required for build modes")
	}
	if p.Image == "" {
		return errors.New("image is required for build output")
	}
	return nil
}

func normalizeMode(mode string) string {
	normalized := strings.ToLower(strings.ReplaceAll(mode, "_", "-"))
	if normalized == "image" || normalized == "prebuilt" {
		return "prebuilt-image"
	}
	if normalized == "" {
		return "auto"
	}
	return normalized
}
