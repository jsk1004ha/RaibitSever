# RAIBITSERVER

> 동아리, 학교, 소규모 팀을 위한 **컨테이너 우선 PaaS + DBaaS + 프로젝트 운영 플랫폼**입니다.

RAIBITSERVER는 GitHub 저장소, Dockerfile, 사전 빌드 이미지, ZIP/로컬 예제, 관리형 DB와 리소스를 하나의 프로젝트 모델로 묶습니다. 사용자의 서비스는 항상 **컨테이너 이미지**와 **Kubernetes desired state**로 변환되며, TypeScript 제어 평면이 원하는 상태를 저장하고 Go 인프라 서비스가 실제 빌드·배포·프로비저닝을 조정합니다.

이 README는 처음 온 사람이 빠르게 이해하고 실행할 수 있도록 핵심만 담습니다. 세부 운영 문서는 [문서 허브](docs/README.md)에 목적별로 분리했습니다.

## 주요 기능

- **멀티 서비스 프로젝트**: `web`, `private`, `worker`, `cron`, `job` 서비스를 한 프로젝트에서 관리합니다.
- **컨테이너 우선 빌드**: 사용자 Dockerfile을 최우선으로 사용하고, 없을 때만 프레임워크 감지/생성 Dockerfile fallback을 사용합니다.
- **관리형 리소스**: PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Valkey, SQLite, Object Storage, Qdrant/vector, NATS/queue를 카탈로그 리소스로 다룹니다.
- **서브도메인 라우팅**: 서비스 실행 URL, preview URL, console/resource 화면은 `<service>--<project>--<org>` 형태의 서브도메인을 사용합니다.
- **승인·쿼터·감사**: 비동아리 사용자는 관리자 승인 후 쿼터 안에서 사용하고, 주요 작업은 감사 로그와 사용량에 반영됩니다.
- **안전한 기본값**: namespace 격리, NetworkPolicy, non-root 컨테이너, privileged/hostPath 차단, 리소스 제한, secret masking을 기본으로 적용합니다.
- **빌드 경로 격리**: `buildContext`/`dockerfilePath`는 서비스 소스 디렉터리 내부로 강제되어 worker 호스트 경로 유출을 차단합니다.
- **로컬 검증 가능**: 기본 검증은 실제 Kubernetes, registry, cloud, GitHub secret 없이 dry-run으로 재현됩니다.

## 아키텍처 요약

| 영역 | 구현 | 역할 |
| --- | --- | --- |
| Dashboard / API / CLI | TypeScript, Next.js, NestJS | 제품 UI, 인증/RBAC, API, CLI |
| Deterministic core | `packages/core` | 빌드 계획, compose import, 라우팅, manifest, 보안/쿼터 규칙 |
| Control-plane DB | PostgreSQL + Prisma | 프로젝트, 서비스, 리소스, 배포, 워크플로 desired state 저장 |
| Infra reconcilers | Go services | builder/orchestrator/provisioner/log/metrics 작업 처리 |
| Runtime target | Container image + Kubernetes | 사용자 워크로드 실행 상태 |

자세한 구성은 [아키텍처 문서](docs/architecture.md)를 참고하세요.

## 사전 요구사항

- Node.js **24+**
- pnpm **11.1.2** (`corepack enable` 권장)
- 선택 사항: Docker, kind 또는 k3d, kubectl, Go 1.22+

Node.js 24+는 로컬 SQLite DB console 경로가 `node:sqlite`를 사용하기 때문에 필요합니다. 기본 dry-run 검증은 cloud credential, registry, Kubernetes cluster, GitHub secret 없이 실행됩니다.

## 빠른 시작

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev:up
pnpm dev:seed
pnpm e2e:dry
pnpm dev:down
```

결과 증거는 `.raibitserver-work/e2e-report.json`에 저장됩니다.

기존 스크립트 호환 alias도 유지합니다.

| 권장 명령 | 호환 alias | 설명 |
| --- | --- | --- |
| `pnpm dev:up` | `pnpm dev-up` | 로컬 도구 감지 및 dev 상태 준비 |
| `pnpm e2e:dry` | `pnpm dev:e2e:dry`, `pnpm dev-e2e` | 외부 부작용 없는 기본 E2E |
| `pnpm e2e:live` | `pnpm dev:e2e:live` | Docker/kind·k3d/kubectl을 사용하는 live E2E |
| `pnpm dev:down` | `pnpm dev-down` | 로컬 상태 정리 |

## 기본 검증

변경 전후에 아래 명령을 우선 확인합니다.

```sh
pnpm test
pnpm typecheck
node scripts/check-structure.js
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json >/tmp/raibitserver-manifest.json
node src/cli.js compose examples/docker-compose.yml >/tmp/raibitserver-compose-plan.json
pnpm prisma:validate
```

Go가 설치되어 있다면 인프라 서비스도 확인합니다.

```sh
for dir in services/builder services/orchestrator services/provisioner services/log-ingester services/metrics-ingester; do
  (cd "$dir" && go test ./... && go build ./...)
done
```

변경 영역별 검증 명령은 [검증 명령 매트릭스](docs/verification-commands.md)에 정리되어 있습니다.

## API와 CLI 사용 예시

정식 API 계약은 [`openapi/raibitserver.yaml`](openapi/raibitserver.yaml)에 있고, CLI는 API client와 로컬 planner/executor smoke path를 함께 검증합니다.

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

CI smoke와 manifest 생성에는 루트 CLI도 사용할 수 있습니다.

```sh
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json
node src/cli.js compose examples/docker-compose.yml
```

## 문서 바로가기

| 필요 | 문서 |
| --- | --- |
| 전체 문서 목록 | [docs/README.md](docs/README.md) |
| 시스템 구조 | [docs/architecture.md](docs/architecture.md) |
| 로컬 dry-run E2E | [docs/local-e2e.md](docs/local-e2e.md) |
| live E2E | [docs/live-e2e.md](docs/live-e2e.md) |
| GitHub App/preview | [docs/github-app.md](docs/github-app.md), [docs/preview-deployments.md](docs/preview-deployments.md) |
| 보안 정책 | [docs/security.md](docs/security.md) |
| 승인/쿼터 | [docs/quota.md](docs/quota.md) |
| DB console | [docs/db-console.md](docs/db-console.md) |
| 리소스 프로비저닝 | [docs/provisioning.md](docs/provisioning.md) |
| 워크플로 작업 | [docs/workflows.md](docs/workflows.md) |
| 문제 해결 | [docs/troubleshooting.md](docs/troubleshooting.md) |
| 베타 출시 기준 | [docs/beta-criteria.md](docs/beta-criteria.md) |
| Staging 배포 | [deploy/staging/README.md](deploy/staging/README.md) |
| Production 배포 | [deploy/production/README.md](deploy/production/README.md) |
| 변경 이력 | [CHANGELOG.md](CHANGELOG.md) |

## 핵심 환경 변수

| 분류 | 변수 |
| --- | --- |
| DB/상태 | `DATABASE_URL`, `RAIBITSERVER_PERSISTENCE`, `RAIBITSERVER_CONTROL_PLANE_DATABASE_URL`, `RAIBITSERVER_CONTROL_PLANE_STORE`, `RAIBITSERVER_CONTROL_PLANE_FILE`, `REDIS_URL` |
| Secret/Auth | `JWT_SECRET`, `RAIBITSERVER_AUTH_JWT_SECRET`, `RAIBITSERVER_AUTH_ISSUER`, `ENCRYPTION_KEY`, `RAIBITSERVER_SECRET_ENCRYPTION_KEY`, `ADMIN_EMAILS` |
| Dashboard/API | `PORT`, `RAIBITSERVER_API_URL`, `RAIBITSERVER_DASHBOARD_TOKEN`, `RAIBITSERVER_TOKEN`, `RAIBITSERVER_DASHBOARD_BASIC_AUTH` |
| Build/Runtime | `REGISTRY_URL`, `RAIBITSERVER_REGISTRY`, `RAIBITSERVER_REGISTRY_USERNAME`, `RAIBITSERVER_REGISTRY_PASSWORD`, `KUBECONFIG`, `RAIBITSERVER_KUBE_CONTEXT`, `BASE_DOMAIN`, `RAIBITSERVER_BASE_DOMAIN`, `RAIBITSERVER_EXECUTE`, `RAIBITSERVER_PUSH` |
| Object Storage | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Provider | `RAIBITSERVER_POSTGRES_PROVIDER_URL`, `POSTGRES_PROVIDER_URL` |
| GitHub App/OAuth | `RAIBITSERVER_GITHUB_CLIENT_ID`, `RAIBITSERVER_GITHUB_CLIENT_SECRET`, `RAIBITSERVER_GITHUB_REDIRECT_URI`, `RAIBITSERVER_GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` |

Production 실행 전 필수 설정은 [production 배포 문서](deploy/production/README.md)를 확인하세요.
GitHub webhook 엔드포인트(`POST /github/webhooks`)는 HMAC 검증을 반드시 수행하므로 `RAIBITSERVER_GITHUB_WEBHOOK_SECRET`(또는 `GITHUB_WEBHOOK_SECRET`)이 비어 있으면 요청을 거부합니다.

## 서버 구축 세팅 체크리스트

이 섹션은 베타/production 서버를 직접 구성할 때 누락되기 쉬운 항목을 한 번에 점검하기 위한 운영 체크리스트입니다. 로컬 dry-run은 파일 기반 상태와 mock provider로도 동작하지만, 실제 서버는 **PostgreSQL control-plane DB + Kubernetes runtime + registry + Go worker** 구성이 기본입니다.

### 1. 권장 배포 형태

```txt
사용자/관리자
  -> HTTPS Ingress / Load Balancer
     -> Dashboard(Next.js)
     -> API(NestJS, /api)
     -> 사용자 서비스 Ingress(*.apps / *.preview)

비공개 네트워크
  -> PostgreSQL(control-plane)
  -> Redis/queue/cache
  -> Image registry
  -> Object storage
  -> Kubernetes API
  -> Go workers(builder, orchestrator, provisioner, log/metrics ingester)
```

- **Control plane**: API, Dashboard, Prisma/PostgreSQL, audit/quota/auth 상태를 담당합니다.
- **Runtime plane**: Kubernetes namespace, Deployment/Service/Ingress, Secret ref, NetworkPolicy를 담당합니다.
- **Worker plane**: builder가 source를 image로 만들고 registry에 push하며, orchestrator/provisioner가 DB desired state를 실제 Kubernetes/resource 상태로 reconcile합니다.
- `RAIBITSERVER_CONTROL_PLANE_FILE`은 deterministic local worker 전용입니다. 베타/production에서는 PostgreSQL store를 사용합니다.

### 2. 서버와 클러스터 준비물

| 영역 | 필요 설정 |
| --- | --- |
| OS/런타임 | Linux 서버 또는 Kubernetes cluster, Node.js 24+, pnpm 11.1.2, Go 1.22+ |
| Container build | Docker/BuildKit 또는 Kubernetes 내부 builder, image push 권한이 있는 registry |
| Kubernetes | `kubectl`, Helm, ingress controller, 기본 StorageClass/PVC, namespace 생성 권한 |
| Database | PostgreSQL 15+ 권장, Prisma migration 적용 가능해야 함 |
| Queue/cache | Redis 호환 backend 권장. workflow lease/backlog와 cache에 사용 |
| TLS/DNS | public load balancer, wildcard DNS, TLS 인증서 또는 cert-manager |
| Storage | object storage/S3-compatible backend, DB backup 저장소, registry retention 정책 |
| 관측성 | API health check, worker log, Kubernetes event, audit log, metrics/log 수집 경로 |

단일 서버 베타는 한 노드에 control-plane과 소형 Kubernetes(kind/k3d/k3s 등)를 함께 둘 수 있지만, 외부 사용자를 받는 운영 환경은 control-plane DB, registry, runtime cluster를 분리하는 구성을 권장합니다.

### 3. DNS와 라우팅

`BASE_DOMAIN=raibitserver.app`을 예로 들면 다음 DNS가 ingress/load balancer를 바라봐야 합니다.

| 용도 | 예시 |
| --- | --- |
| API | `api.raibitserver.app` |
| Dashboard/Admin | `admin.raibitserver.app` 또는 `console.raibitserver.app` (반드시 별도 인증 계층 적용) |
| 서비스 실행 URL | `*.apps.raibitserver.app` |
| PR preview URL | `*.preview.raibitserver.app` |
| 서비스 관리 화면 | `*.console.raibitserver.app` |
| 리소스 관리 화면 | `*.resources.raibitserver.app` |

서비스/preview host는 `<service>--<project>--<org>` 또는 `pr-<number>--<service>--<project>--<org>` 패턴으로 생성됩니다. 따라서 `*.apps`, `*.preview`, `*.console`, `*.resources` wildcard 인증서를 준비해야 합니다.

> 보안 필수: `/admin` 경로는 API 토큰 기반 서버 렌더링 데이터를 표시하므로 public ingress에 노출할 때 반드시 별도 인증 계층을 적용하세요. 기본 구성에서는 `RAIBITSERVER_DASHBOARD_BASIC_AUTH`를 `username:password` 형식으로 설정해야 하며, 미설정 시 `/admin`은 503으로 차단됩니다.

### 4. production 환경 변수 예시

아래 값은 예시입니다. 실제 secret은 password manager, sealed secret, cloud secret manager, Kubernetes Secret 등으로 주입하고 저장소에 커밋하지 마세요.

```sh
# 공통
NODE_ENV=production
PORT=3000
BASE_DOMAIN=raibitserver.app
RAIBITSERVER_BASE_DOMAIN=raibitserver.app

# Control-plane DB / Prisma
RAIBITSERVER_PERSISTENCE=prisma
DATABASE_URL=postgresql://raibitserver:<password>@postgres.internal:5432/raibitserver?schema=public
RAIBITSERVER_CONTROL_PLANE_STORE=postgresql
RAIBITSERVER_CONTROL_PLANE_DATABASE_URL=postgresql://raibitserver:<password>@postgres.internal:5432/raibitserver?schema=public

# Auth / secret
RAIBITSERVER_AUTH_JWT_SECRET=<32바이트-이상-랜덤값>
RAIBITSERVER_AUTH_ISSUER=raibitserver
RAIBITSERVER_SECRET_ENCRYPTION_KEY=<32바이트-이상-랜덤값>
ADMIN_EMAILS=admin@example.com

# Dashboard -> API
RAIBITSERVER_API_URL=https://api.raibitserver.app/api
RAIBITSERVER_DASHBOARD_TOKEN=<dashboard-server-side-token>
RAIBITSERVER_DASHBOARD_BASIC_AUTH=<admin-user>:<strong-random-password>

# Kubernetes / runtime
KUBECONFIG=/etc/raibitserver/kubeconfig
RAIBITSERVER_KUBE_CONTEXT=raibitserver-prod
RAIBITSERVER_EXECUTE=1
RAIBITSERVER_ROLLOUT_TIMEOUT_SECONDS=300

# Registry / builder
REGISTRY_URL=registry.raibitserver.app/raibitserver
RAIBITSERVER_REGISTRY=registry.raibitserver.app
RAIBITSERVER_REGISTRY_USERNAME=<registry-user>
RAIBITSERVER_REGISTRY_PASSWORD=<registry-password>
RAIBITSERVER_PUSH=1
RAIBITSERVER_BUILD_TIMEOUT_SECONDS=900

# Provider
REDIS_URL=redis://redis.internal:6379
RAIBITSERVER_POSTGRES_PROVIDER_URL=postgresql://provider:<password>@postgres-provider.internal:5432/postgres
RAIBITSERVER_POSTGRES_POOLER_HOST=pgbouncer.shared-providers.svc.cluster.local
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY=<access-key>
S3_SECRET_KEY=<secret-key>

# GitHub OAuth/App
RAIBITSERVER_GITHUB_CLIENT_ID=<github-oauth-client-id>
RAIBITSERVER_GITHUB_CLIENT_SECRET=<github-oauth-client-secret>
RAIBITSERVER_GITHUB_REDIRECT_URI=https://api.raibitserver.app/api/auth/github/callback
RAIBITSERVER_GITHUB_WEBHOOK_SECRET=<webhook-secret>
GITHUB_APP_ID=<github-app-id>
GITHUB_PRIVATE_KEY=<github-app-private-key-pem>
```

운영에서 사용하면 안 되는 개발 편의 변수도 있습니다.

- `RAIBITSERVER_AUTH_DISABLED`, `RAIBITSERVER_AUTH_DEV_HEADERS`, `RAIBITSERVER_AUTH_DEV_TOKEN`, `RAIBITSERVER_ROLE`은 로컬 개발 전용입니다.
- `RAIBITSERVER_ALLOW_MEMORY_PERSISTENCE=1`은 production 안전 조건을 깨뜨립니다.
- `RAIBITSERVER_DRY_RUN=1` 또는 `RAIBITSERVER_EXECUTE` 미설정 상태에서는 worker가 실제 apply/push/provision을 수행하지 않습니다.
- builder는 `localPath`, `buildContext`, `dockerfilePath`를 workspace/source 경계 안으로만 해석합니다. 상위 디렉터리(`..`) 또는 절대 경로로 경계를 벗어나는 빌드 입력은 거부됩니다.

### 5. 처음 서버 올리는 순서

1. **DB 생성**
   - PostgreSQL database/user를 만들고 `DATABASE_URL`로 접근을 확인합니다.
   - production API는 in-memory store를 사용하지 않도록 `RAIBITSERVER_PERSISTENCE=prisma`를 둡니다.
2. **Prisma 준비**
   ```sh
   pnpm install --frozen-lockfile
   pnpm prisma:validate
   pnpm prisma:generate
   pnpm exec prisma migrate deploy --schema prisma/schema.prisma
   ```
3. **Secret 준비**
   - `RAIBITSERVER_AUTH_JWT_SECRET`, `RAIBITSERVER_SECRET_ENCRYPTION_KEY`, GitHub/registry/provider secret을 secret manager에 저장합니다.
   - 첫 로그인 사용자는 자동으로 `ADMIN / NON_CLUB / APPROVED`가 됩니다. 모든 회원가입은 먼저 `NON_CLUB`으로 시작하며, 운영자는 어드민 화면에서 `CLUB_MEMBER`/`NON_CLUB`을 전환합니다. `ADMIN_EMAILS`에도 break-glass 관리자 이메일을 넣어 둡니다.
4. **이미지 빌드/배포**
   - API, Dashboard, Go workers 이미지를 빌드해 registry에 push합니다.
   - Helm을 사용한다면 `infra/helm/raibitserver/values.yaml`의 `image.registry`, `image.tag`, `ingress.host`, replica 수를 환경에 맞게 덮어씁니다.
5. **API와 Dashboard 기동**
   - API는 `/api` global prefix를 사용합니다. health check와 auth/login/signup 경로를 확인합니다.
   - Dashboard는 `RAIBITSERVER_API_URL=https://api.<BASE_DOMAIN>/api`로 API를 바라보게 합니다.
6. **Go worker 기동**
   - builder/orchestrator/provisioner/log-ingester/metrics-ingester에 PostgreSQL control-plane URL을 주입합니다.
   - 실제 적용 환경에서는 `RAIBITSERVER_EXECUTE=1`, build push가 필요하면 `RAIBITSERVER_PUSH=1`을 설정합니다.
7. **GitHub App/OAuth 연결**
   - OAuth callback: `https://api.<BASE_DOMAIN>/api/auth/github/callback`
   - Webhook URL: `https://api.<BASE_DOMAIN>/api/github/webhooks`
   - Webhook event는 `push`, `pull_request`, `installation`, `installation_repositories`를 포함합니다.
   - 자세한 권한과 fixture 검증은 [GitHub App 문서](docs/github-app.md)와 [Preview Deployment 문서](docs/preview-deployments.md)를 참고하세요.
8. **운영 smoke 검증**
   - 관리자 첫 로그인 → 조직/프로젝트 생성 → GitHub repo attach 또는 image service 생성 → deployment queue → worker 처리 → 서비스 URL 접속까지 확인합니다.
   - Disposable cluster 기준 live 검증은 `RAIBITSERVER_EXECUTE=1 pnpm e2e:live`로 실행합니다.

### 6. Kubernetes 보안 기본값

- platform component는 `raibitserver-system` 같은 전용 namespace에 두고, 사용자 workload는 조직/프로젝트별 namespace로 분리합니다.
- tenant workload에는 restricted Pod Security, non-root 실행, resource requests/limits, Secret ref, NetworkPolicy를 적용합니다.
- privileged container, hostPath, hostNetwork, root 실행, quota 초과 배포는 배포 전 차단되어야 합니다.
- orchestrator service account는 필요한 namespace/resource에만 권한을 주고 cluster-admin 상시 권한은 피합니다.
- registry pull secret과 provider credential은 사용자가 API body로 직접 넘기는 값이 아니라 platform secret/ref로 관리합니다.

### 7. 방화벽과 네트워크

| 방향 | 열어야 할 대상 |
| --- | --- |
| Public inbound | 80/443 -> ingress/load balancer |
| Private inbound | PostgreSQL, Redis, registry, object storage, Kubernetes API |
| Admin only | SSH, Kubernetes API 직접 접근, DB admin endpoint |
| Outbound | GitHub API/webhook response, registry, package mirror, object storage |

DB, Redis, provider credential endpoint는 public internet에 직접 노출하지 않습니다. GitHub webhook은 API public endpoint로 받아야 하므로 webhook secret/HMAC 검증이 필수입니다.

### 8. 백업, 복구, 관측성

- PostgreSQL은 PITR 또는 주기 백업을 켜고, migration 전 스냅샷을 남깁니다.
- object storage bucket, registry image retention, Kubernetes secret 백업 정책을 정합니다.
- audit log, workflow job, deployment event, preview cleanup event를 일정 기간 보관합니다.
- `/health` 또는 ingress health check, worker backlog, failed workflow, quota violation, GitHub webhook 401/5xx를 모니터링합니다.
- 복구 리허설은 “DB restore → API boot → worker reconcile → 기존 서비스 URL 정상화” 순서로 확인합니다.

### 9. go-live 직전 검증

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm prisma:validate
pnpm prisma:generate
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json >/tmp/raibitserver-manifest.json
node src/cli.js compose examples/docker-compose.yml >/tmp/raibitserver-compose-plan.json
RAIBITSERVER_EXECUTE=1 pnpm e2e:live
```

Go가 설치된 운영 빌드 환경에서는 다음도 함께 확인합니다.

```sh
for dir in services/builder services/orchestrator services/provisioner services/log-ingester services/metrics-ingester; do
  (cd "$dir" && go test ./... && go build ./...)
done
```

Production 세부 항목은 [Production 배포 문서](deploy/production/README.md), 검증 기준은 [베타 출시 기준](docs/beta-criteria.md)과 [검증 명령 매트릭스](docs/verification-commands.md)를 함께 확인하세요.

## DB와 리소스 지원 범위

RAIBITSERVER의 관리형 리소스는 raw compose container가 아니라 프로젝트에 연결되는 catalog resource입니다. `shared-small` DBaaS/cache 플랜은 resource마다 PostgreSQL/MySQL/MongoDB/Redis 컨테이너를 새로 띄우지 않고, 공유 provider 안에 database/user/bucket/collection/prefix를 생성합니다.

| 엔진 | 로컬 proof | Provider contract |
| --- | --- | --- |
| PostgreSQL | provider dry-run, env injection, console contract | shared PostgreSQL + PgBouncer, database/user/grant, `DATABASE_URL`, connection test, `pg_dump -Fc` backup/restore |
| MySQL/MariaDB | env/provision plan | shared server, DB/user/password/grant |
| MongoDB | collection/document contract | shared server, database/user/URI, `mongodump --db` |
| Redis/Valkey | key/value/TTL contract | shared server, ACL user + `REDIS_KEY_PREFIX`, key browser, prefix delete via `SCAN MATCH` + `UNLINK` |
| SQLite | 실행 가능한 로컬 console | PVC-backed file DB |
| Object Storage | MinIO/S3 env plan | bucket/browser/presign |
| Qdrant/vector | collection/search-test contract | vector collection/search |
| NATS/queue | subject/connection contract | queue connection info |

운영 리스크는 공유 인스턴스의 본질적인 trade-off입니다. noisy neighbor, 낮은 프로세스/디스크 I/O 격리, 프로젝트 단위 백업/복구 복잡도, Redis prefix-only 위험을 줄이기 위해 quota/metering, timeout, PgBouncer, provider-owned secret, Redis ACL key pattern, dedicated plan 승격 경로를 함께 둡니다.

베타에서는 destructive operation 방지와 기본 연결/timeout 제한을 우선 구현합니다. PostgreSQL resource plan은 PgBouncer 경유 URL과 role별 connection/statement/idle/lock timeout 계약을 생성하고, Redis/Valkey plan은 ACL + prefix와 `SCAN MATCH`/`UNLINK` 삭제만 허용합니다. 자동 noisy-neighbor 탐지, per-prefix Redis restore, dedicated plan 자동 승격은 정식 버전 범위로 문서화했습니다.

자세한 내용은 [리소스 프로비저닝](docs/provisioning.md)과 [DB console](docs/db-console.md)을 참고하세요.

## 문제 해결

자주 발생하는 문제는 [troubleshooting](docs/troubleshooting.md)에 정리되어 있습니다.

- `pnpm install --frozen-lockfile` 실패: Node.js 24+와 pnpm 11.1.2를 확인합니다.
- Production API 부팅 실패: `DATABASE_URL`, auth secret, encryption key를 확인합니다.
- dry E2E는 성공하지만 live E2E가 실패: Docker, kubectl, kind/k3d와 `.raibitserver-work/e2e-report.json`의 `liveSetupResults`를 확인합니다.
- DB console query 거부: 역할, `confirmed: true`, provider-owned connection 여부를 확인합니다.

## 지원, 라이선스, 변경 이력

- 지원/문의: 저장소 이슈 트래커([GitHub Issues](https://github.com/jsk1004ha/RaibitSever/issues)) 또는 프로젝트 운영 채널을 사용합니다.
- 라이선스: [Apache-2.0](LICENSE)
- 변경 이력: [CHANGELOG.md](CHANGELOG.md)

## 문서 작성 기준

이 README와 하위 문서는 “프로젝트 목적, 설치/사용 방법, 문제 해결, 지원/라이선스, 심화 링크를 간결하게 제공하고 긴 내용은 별도 문서로 분리한다”는 원칙으로 정리했습니다. 작성 기준은 InfoGrab의 [좋은 README 작성하는 방법](https://insight.infograb.net/blog/2023/08/23/good-readme/)을 참고했습니다.
