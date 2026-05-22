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

If any required Docker/Kubernetes tool is missing, `pnpm e2e:live` exits non-zero before running build, registry push, or `kubectl apply`. Auto/dry mode records a deterministic fallback plan instead of mutating the machine.

## Live setup plan

When live mode is requested with `--execute` and tools are available, the E2E planner prepares:

1. local registry `raibitserver-registry` on port `5000`,
2. disposable `kind` or `k3d` cluster `raibitserver-e2e`,
3. ingress-nginx install/check for local HTTP routing,
4. build/push, Kubernetes apply, rollout/log evidence, and provider provisioning checks.

The setup commands are written into `.raibitserver-work/e2e-report.json` under `liveSetup`. Dry mode writes the same shape with `clusterEngine: dry-run` so CI can assert the contract without side effects.

## Evidence

Live mode writes `.raibitserver-work/e2e-report.json` with:

- detected tool readiness,
- local registry/cluster/ingress setup commands and results,
- example app HTTP 200 evidence,
- PostgreSQL provider dry-run/env-injection evidence,
- SQLite DB console query evidence,
- deployment, preview deployment, preview cleanup workflow, build log, runtime log, and event checks,
- build workflow mode (`dryRun: false`),
- Kubernetes apply mode (`dryRun: false`),
- provisioning mode (`dryRun: false`).

Dry mode remains the default acceptance proof; live mode is for operator smoke tests against a disposable local cluster.
