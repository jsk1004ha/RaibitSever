package main

import (
    "context"
    "fmt"
    "os"

    "github.com/raibitserver/orchestrator/internal/reconciler"
)

func main() {
    ctx := context.Background()
    r := reconciler.NewServiceReconciler(reconciler.Config{
        DryRun: os.Getenv("RAIBITSERVER_DRY_RUN") != "0",
    })
    if err := r.RunOnce(ctx); err != nil {
        fmt.Fprintf(os.Stderr, "orchestrator failed: %v\n", err)
        os.Exit(1)
    }
}
