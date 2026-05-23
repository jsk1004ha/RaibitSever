package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	buildplan "github.com/raibitserver/builder/internal/build"
	"github.com/raibitserver/builder/internal/controlplane"
	"github.com/raibitserver/builder/internal/worker"
)

func main() {
	ctx := context.Background()
	stateFile := worker.StateFileFromEnv()
	if stateFile != "" {
		builder := worker.New(controlplane.NewFileStore(stateFile), worker.OSRunner{}, worker.ConfigFromEnv())
		result, err := builder.RunOnce(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "builder workflow failed: %v\n", err)
			os.Exit(1)
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return
	}
	if dsn := controlplane.PostgresDSNFromEnv(environment()); dsn != "" {
		store, closeStore, err := controlplane.OpenPostgresStore(ctx, dsn)
		if err != nil {
			fmt.Fprintf(os.Stderr, "builder PostgreSQL control-plane store failed: %v\n", err)
			os.Exit(1)
		}
		defer closeStore()
		builder := worker.New(store, worker.OSRunner{}, worker.ConfigFromEnv())
		result, err := builder.RunOnce(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "builder workflow failed: %v\n", err)
			os.Exit(1)
		}
		_ = json.NewEncoder(os.Stdout).Encode(result)
		return
	}

	mode := os.Getenv("RAIBITSERVER_BUILD_MODE")
	if mode == "" {
		mode = "auto"
	}
	plan := buildplan.Plan{Mode: mode, Source: os.Getenv("RAIBITSERVER_SOURCE"), Image: os.Getenv("RAIBITSERVER_IMAGE")}
	if err := plan.Validate(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "builder plan invalid: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("raibitserver builder mode=%s action=build-or-verify-image state=env-only\n", plan.Mode)
}

func environment() map[string]string {
	values := map[string]string{}
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			values[key] = value
		}
	}
	return values
}
