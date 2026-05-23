# RAIBITSERVER

RAIBITSERVER is a container-first **PaaS + DBaaS + project operations platform** for clubs, schools, and small teams. It manages GitHub repos, Dockerfiles, prebuilt images, ZIP/local examples, managed DB/resources, logs, quotas, and preview deployments inside one project model.

## Architecture

```txt
Dashboard / API / CLI     TypeScript, Next.js, NestJS, shared schemas/client
Deterministic core        packages/core build plans, compose import, security, manifests
Control-plane DB          PostgreSQL + Prisma schema
Infra reconcilers         Go builder/orchestrator/provisioner/log/metrics services
Runtime target            container image + Kubernetes desired state
```

Product invariants implemented in code:

- Dockerfile wins over framework detection; generated Dockerfile/buildpack fallback exists.
- API writes desired state; worker/reconciler surfaces consume workflow jobs/dry-run or execute commands.
- Services support `web`, `private`, `worker`, `cron`, `job`.
- Resource catalog supports PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Valkey, SQLite, Object Storage, Qdrant/vector, and NATS/queue contract.
- Generated manifests enforce namespace isolation, NetworkPolicy, non-root containers, no privileged/hostPath, resource limits, dropped capabilities, seccomp, and no service-account token mount.

## Prerequisites

- Node.js 24+ (required by the built-in `node:sqlite` DB console path; Node 22 LTS can be revisited by replacing it with an external SQLite adapter such as `better-sqlite3`/`sqlite3`.)
- pnpm 11.1.2 (`corepack enable`)
- Optional for execute-mode local cluster: Docker, kind or k3d, kubectl, Go 1.22+

Local verification does **not** require real cloud credentials, registry, Kubernetes, or GitHub secrets. `pnpm e2e:dry` is the default deterministic proof and writes dry-run artifacts. `pnpm e2e:live` is an explicit `--execute` path for local Docker/kind-or-k3d/kubectl environments.

## Quick start

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev:up
pnpm dev:seed
pnpm e2e:dry
pnpm dev:down
```

Legacy/script-friendly aliases are also available: `pnpm dev-up`, `pnpm dev-e2e`, `pnpm dev-down`, plus explicit split commands `pnpm dev:e2e:dry` and `pnpm dev:e2e:live`.

Evidence is written to `.raibitserver-work/e2e-report.json`.

## Verification commands

```sh
pnpm test
pnpm typecheck
node scripts/check-structure.js
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json >/tmp/raibitserver-manifest.json
node src/cli.js compose examples/docker-compose.yml >/tmp/raibitserver-compose-plan.json
pnpm prisma:validate
```

For a focused matrix by change area, see `docs/verification-commands.md`.

If Go is installed:

```sh
for dir in services/builder services/orchestrator services/provisioner services/log-ingester services/metrics-ingester; do
  (cd "$dir" && go test ./... && go build ./...)
done
```

## Environment variables

Core:

- `DATABASE_URL`
- `RAIBITSERVER_CONTROL_PLANE_DATABASE_URL` (Go builder worker DB store; falls back to `DATABASE_URL` only when `RAIBITSERVER_CONTROL_PLANE_STORE=postgresql`)
- `RAIBITSERVER_CONTROL_PLANE_FILE` (local file-state worker mode)
- `REDIS_URL`
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `REGISTRY_URL`
- `KUBECONFIG`
- `BASE_DOMAIN` (default local: `127.0.0.1.sslip.io`)
- `JWT_SECRET` or `RAIBITSERVER_AUTH_JWT_SECRET`
- `ENCRYPTION_KEY` or `RAIBITSERVER_SECRET_ENCRYPTION_KEY`
- `ADMIN_EMAILS`

GitHub App/OAuth:

- `GITHUB_APP_ID`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`

## API and CLI

Canonical API is documented in `openapi/raibitserver.yaml` and implemented through the NestJS module plus the local prototype handler used by tests.

CLI examples:

```sh
RAIBITSERVER_API_URL=http://localhost:3000/api raibit whoami
raibit projects list
raibit projects create --name demo --organization-id org_id
raibit services create --project-id prj_id --name web --image localhost:5000/demo/web:latest
raibit deploy --service-id svc_id
raibit deployments logs --deployment-id dep_id
raibit resources create --project-id prj_id --engine sqlite --name data
raibit db query --resource-id res_id --query "SELECT 1"
raibit admin approve --user-id usr_id
```

The root `src/cli.js` remains the deterministic no-server planner/executor CLI for CI smoke commands.

## Local E2E behavior

`pnpm e2e:dry` verifies:

- example app HTTP 200 through a generated RAIBITSERVER-style host,
- non-club pending user is blocked,
- admin approval and quota set unlock usage,
- club member bypasses user-facing quota,
- service/resource/deployment creation,
- `.env` upload with secret masking,
- SQLite DB console query,
- build logs, runtime logs, deployment events,
- PR preview deployment fixture,
- build/Kubernetes/provisioning dry-run artifacts.

Dry mode reports `deterministic-dry-run` or `dry-run-container-ready` and always keeps build, Kubernetes, and provisioning worker actions non-side-effecting. Live mode is separate: `pnpm e2e:live` requires Docker, kubectl, kind/k3d, and the explicit `--execute` script contract before it runs local registry, kind/k3d cluster, local-registry-to-cluster wiring, ingress, build, Kubernetes apply, and provisioning commands against the local environment. Auto/dry mode records a deterministic fallback plan when those tools are missing. An optional manually dispatched GitHub Actions workflow lives at `.github/workflows/live-e2e.yml` for Docker/kind-capable runners.

## Account and quota model

- `ADMIN` can manage all users/projects/resources.
- `CLUB_MEMBER` is approved and user-facing unlimited, with hard abuse caps still enforced.
- `NON_CLUB` defaults to `PENDING` and cannot create/deploy/provision until admin approval.
- `NON_CLUB + APPROVED` is limited by `Quota` rows. Runtime accounting includes project/service/deployment counts, preview count, DB/object storage MB, build minutes, runtime hours, aggregate CPU requests, and aggregate memory requests.

## DB support matrix

| Engine | Local proof | Provider contract |
| --- | --- | --- |
| PostgreSQL | direct provider dry-run + env injection + console contract | CREATE USER/DATABASE/GRANT, DATABASE_URL secret, connection test, pg_dump/restore |
| MySQL/MariaDB | env/provision plan | DB/user/password |
| MongoDB | env/provision plan | database/user/URI |
| Redis/Valkey | env/provision plan | URL/key browser |
| SQLite | executable local console | PVC-backed file DB |
| Object Storage | MinIO/S3 env plan | bucket/browser/presign |
| Qdrant/vector | env/provision plan | collection/search test |
| NATS/queue | env/provision plan | subject/connection info |

## Docs

- `docs/beta-criteria.md`
- `docs/architecture.md`
- `docs/local-e2e.md`
- `docs/live-e2e.md`
- `docs/github-app.md`
- `docs/security.md`
- `docs/quota.md`
- `docs/db-console.md`
- `docs/preview-deployments.md`
- `docs/workflows.md`
- `docs/provisioning.md`
- `docs/troubleshooting.md`

## Production runbook and current limitations

1. Configure production persistence: `DATABASE_URL` for the API/control-plane PostgreSQL DB plus `RAIBITSERVER_SECRET_ENCRYPTION_KEY`/`ENCRYPTION_KEY` with at least 32 characters. The Go builder can poll the same Prisma/PostgreSQL tables with `RAIBITSERVER_CONTROL_PLANE_DATABASE_URL` or with `RAIBITSERVER_CONTROL_PLANE_STORE=postgresql` plus `DATABASE_URL`; `RAIBITSERVER_CONTROL_PLANE_FILE` remains the deterministic local worker mode. The in-memory store is only for tests/dev fallback.
2. Configure auth and admin bootstrap: `RAIBITSERVER_AUTH_JWT_SECRET`, `ADMIN_EMAILS`, and hosted domain settings (`BASE_DOMAIN`, DNS, TLS/ingress).
3. Configure GitHub App/OAuth if repository import and previews are needed: `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`.
4. Configure build/runtime infrastructure: registry (`REGISTRY_URL`), Docker/BuildKit or builder service access, Kubernetes credentials (`KUBECONFIG`/in-cluster config), ingress controller, and resource limits.
5. Configure DB/resource providers: PostgreSQL provider admin URL for direct PostgreSQL provisioning first, then MySQL/Mongo/Redis/MinIO/Qdrant/NATS provider adapters as they become live.
6. Run verification before go-live: `pnpm test`, `pnpm typecheck`, `pnpm prisma:validate`, CLI validate/manifest/compose, Go service tests/builds, `pnpm e2e:dry`, and a prepared `pnpm e2e:live` against disposable local infrastructure.

Current limitations:

- Real GitHub OAuth/App network calls require configured GitHub credentials; local tests use deterministic webhook/status/check-run plans.
- Execute-mode Docker/BuildKit build, registry push, Kubernetes apply, and ingress setup require local Docker/kind-or-k3d/kubectl or production infrastructure.
- Dry E2E proves the full control-plane contract and dry-run worker artifacts without those tools; live E2E is reserved for explicit local-cluster execution.
- Go builder has a PostgreSQL control-plane store for production job claim/update/log writes; orchestrator and provisioner still need matching production DB/API stores beyond their file-state/local contracts.
- Node.js 24+ remains required until the `node:sqlite` console path is replaced with a Node 22-compatible SQLite dependency.
