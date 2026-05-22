# Live E2E

Live E2E is the side-effecting local-cluster proof. It is intentionally separate from deterministic dry E2E and fails fast when required tools are missing.

## Command

```sh
pnpm dev:up
pnpm e2e:live
pnpm dev:down
```

Alias: `pnpm dev:e2e:live`.

## Required local tools

- Docker with BuildKit/buildx support.
- `kubectl`.
- `kind` or `k3d`.
- A local registry address via `REGISTRY_URL` when the default `localhost:5000` is not correct.

If any required Docker/Kubernetes tool is missing, `pnpm e2e:live` exits non-zero before running build, registry push, or `kubectl apply`. This keeps CI and developer laptops deterministic unless live mode is explicitly prepared.

## Evidence

Live mode writes `.raibitserver-work/e2e-report.json` with:

- detected tool readiness,
- build workflow mode (`dryRun: false`),
- Kubernetes apply mode (`dryRun: false`),
- provisioning mode (`dryRun: false`),
- local app URL and HTTP status evidence,
- deployment, preview deployment, log, and SQLite console checks.

Dry mode remains the default acceptance proof; live mode is for operator smoke tests against a disposable local cluster.
