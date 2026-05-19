package build

import (
    "context"
    "errors"
)

type Plan struct {
    Mode   string
    Source string
    Image  string
}

func (p Plan) Validate(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    if p.Mode == "prebuilt-image" && p.Image == "" {
        return errors.New("prebuilt-image mode requires image")
    }
    if p.Mode != "prebuilt-image" && p.Source == "" {
        return errors.New("source is required for build modes")
    }
    return nil
}
