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

- Node.js 24+
- pnpm 11.1.2 (`corepack enable`)
- Optional for execute-mode local cluster: Docker, kind or k3d, kubectl, Go 1.22+

Local verification does **not** require real cloud credentials, registry, Kubernetes, or GitHub secrets. When Docker/Kubernetes are unavailable, `dev:e2e` runs deterministic local proof and writes dry-run artifacts.

## Quick start

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev:up
pnpm dev:seed
pnpm dev:e2e
pnpm dev:down
```

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

If Go is installed:

```sh
for dir in services/builder services/orchestrator services/provisioner services/log-ingester services/metrics-ingester; do
  (cd "$dir" && go test ./... && go build ./...)
done
```

## Environment variables

Core:

- `DATABASE_URL`
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

`pnpm dev:e2e` verifies:

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

If Docker/kind/kubectl are installed, the same command reports `container-stack-ready`; otherwise it reports `deterministic-local-fallback` and still succeeds without external side effects.

## Account and quota model

- `ADMIN` can manage all users/projects/resources.
- `CLUB_MEMBER` is approved and user-facing unlimited, with hard abuse caps still enforced.
- `NON_CLUB` defaults to `PENDING` and cannot create/deploy/provision until admin approval.
- `NON_CLUB + APPROVED` is limited by `Quota` rows.

## DB support matrix

| Engine | Local proof | Provider contract |
| --- | --- | --- |
| PostgreSQL | env/provision plan | DB/user/password/backup |
| MySQL/MariaDB | env/provision plan | DB/user/password |
| MongoDB | env/provision plan | database/user/URI |
| Redis/Valkey | env/provision plan | URL/key browser |
| SQLite | executable local console | PVC-backed file DB |
| Object Storage | MinIO/S3 env plan | bucket/browser/presign |
| Qdrant/vector | env/provision plan | collection/search test |
| NATS/queue | env/provision plan | subject/connection info |

## Docs

- `docs/architecture.md`
- `docs/local-e2e.md`
- `docs/github-app.md`
- `docs/security.md`
- `docs/quota.md`
- `docs/db-console.md`
- `docs/preview-deployments.md`

## Production notes and current limitations

- Real GitHub OAuth/App actions require configured GitHub credentials.
- Execute-mode Docker/BuildKit build, registry push, and Kubernetes apply require local Docker/kind/kubectl or production infrastructure.
- Local E2E proves the full control-plane contract and dry-run worker artifacts when those tools are absent.
- Use PostgreSQL for production API persistence; the in-memory store is for tests/dev fallback only.
