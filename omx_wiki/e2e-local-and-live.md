# E2E local/live contract

- `pnpm e2e:dry` is the deterministic acceptance proof and never requires Docker, registry, Kubernetes, cloud DBs, or GitHub credentials.
- `pnpm e2e:live` requires explicit `--execute`, Docker, kubectl, and kind or k3d. It plans local registry, cluster, ingress, build/push, Kubernetes apply, PostgreSQL provider/env checks, DB console query, preview create, and preview cleanup.
- Evidence lives in `.raibitserver-work/e2e-report.json`.
