package reconciler

import (
    "context"
    "fmt"
)

// Config keeps the first orchestrator implementation safe: it prints intended
// Kubernetes actions unless RAIBITSERVER_DRY_RUN=0 is set in a real controller.
type Config struct {
    DryRun bool
}

type ServiceReconciler struct {
    config Config
}

func NewServiceReconciler(config Config) *ServiceReconciler {
    return &ServiceReconciler{config: config}
}

// RunOnce is the future control loop entrypoint. Production will read desired
// state from the Control Plane DB, render Kubernetes objects, apply them with
// client-go/controller-runtime, then write actual state back to PostgreSQL.
func (r *ServiceReconciler) RunOnce(ctx context.Context) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    fmt.Printf("raibitserver orchestrator dryRun=%t action=reconcile-desired-state\n", r.config.DryRun)
    return nil
}
