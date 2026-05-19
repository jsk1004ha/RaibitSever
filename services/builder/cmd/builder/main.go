package main

import (
    "context"
    "fmt"
    "os"

    buildplan "github.com/raibitserver/builder/internal/build"
)

func main() {
    mode := os.Getenv("RAIBITSERVER_BUILD_MODE")
    if mode == "" {
        mode = "auto"
    }
    plan := buildplan.Plan{Mode: mode, Source: os.Getenv("RAIBITSERVER_SOURCE"), Image: os.Getenv("RAIBITSERVER_IMAGE")}
    if err := plan.Validate(context.Background()); err != nil {
        fmt.Fprintf(os.Stderr, "builder plan invalid: %v\n", err)
        os.Exit(1)
    }
    fmt.Printf("raibitserver builder mode=%s action=build-or-verify-image\n", plan.Mode)
}
