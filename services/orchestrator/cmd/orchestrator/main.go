package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	orchestratorconfig "github.com/raibitserver/orchestrator/internal/config"
	"github.com/raibitserver/orchestrator/internal/reconciler"
	"github.com/raibitserver/orchestrator/internal/store"
)

func main() {
	ctx := context.Background()
	cfg := orchestratorconfig.FromEnv()
	reconcilerConfig := reconciler.Config{DryRun: cfg.DryRun, Kubeconfig: cfg.Kubeconfig, KubeContext: cfg.KubeContext, OutputDir: cfg.OutputDir, BaseDomain: cfg.BaseDomain, Timeout: cfg.Timeout}
	var r *reconciler.ServiceReconciler
	if cfg.StateFile != "" {
		r = reconciler.NewServiceReconcilerWithStore(reconcilerConfig, store.NewFileStore(cfg.StateFile), nil)
	} else {
		r = reconciler.NewServiceReconciler(reconcilerConfig)
	}
	result, err := r.RunOnceResult(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "orchestrator failed: %v\n", err)
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}
