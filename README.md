# RAIBITSERVER

> **RAIBITSERVER**는 GitHub repo, Dockerfile, 컨테이너 이미지, DB, 스토리지를 한 프로젝트 안에서 관리하고 배포할 수 있는 동아리·학교·소규모 팀용 클라우드 PaaS + DBaaS 플랫폼입니다.

이 저장소는 사용자가 제안한 최종 방향인 **TypeScript 중심 모노레포 + Go 기반 인프라 컨트롤러** 구조로 잡혀 있습니다.

```txt
제품/대시보드/일반 API        → TypeScript
Kubernetes 제어/빌드/런타임   → Go
인프라 정의                  → Terraform + Helm/Kubernetes manifests
```

핵심 원칙은 하나입니다.

> **NestJS API는 desired state를 저장하고, Go infra services는 actual state를 맞춘다.**

---

## 최종 코드베이스 구조

```txt
RAIBITSERVER/
├─ apps/
│  ├─ dashboard/              # Next.js 웹 대시보드
│  ├─ api/                    # NestJS Control Plane API
│  └─ cli/                    # raibitserver CLI
│
├─ services/
│  ├─ orchestrator/           # Go: Kubernetes 배포 제어/reconcile
│  ├─ builder/                # Go: Dockerfile/Buildpack 빌드 워커
│  ├─ provisioner/            # Go: DB/Redis/Storage 생성 관리
│  ├─ log-ingester/           # Go: build/runtime/database/audit log 수집
│  ├─ metrics-ingester/       # Go: CPU/RAM/network/request/DB metrics 수집
│  └─ webhook-worker/         # TypeScript: GitHub webhook 처리
│
├─ packages/
│  ├─ core/                   # TypeScript prototype core/domain logic
│  ├─ ui/                     # 공용 UI 유틸/컴포넌트 foundation
│  ├─ config/                 # 공용 TS/build config foundation
│  ├─ api-client/             # Dashboard/CLI/SDK용 API client
│  ├─ schemas/                # 공용 타입/schema contract
│  └─ sdk/                    # 사용자/관리자용 SDK facade
│
├─ openapi/
│  └─ raibitserver.yaml       # REST API contract
│
├─ infra/
│  ├─ terraform/              # cloud/DNS/registry/base infra skeleton
│  ├─ helm/raibitserver/      # control plane + infra services Helm chart skeleton
│  ├─ k8s/                    # AppService CRD 등 raw manifest
│  └─ operators/              # ManagedDatabase CRD 등 operator 확장
│
├─ deploy/
│  ├─ local/                  # local PostgreSQL/Redis/MinIO compose
│  ├─ staging/
│  └─ production/
│
├─ src/                       # thin TypeScript entrypoints + JS compatibility wrappers
├─ examples/                  # project spec + docker-compose import example
├─ tests/                     # local deterministic verification
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ README.md
```

`packages/core`는 실제 클라우드 자격증명 없이 핵심 동작을 검증하기 위한 TypeScript prototype core입니다. `src/`에는 기존 명령 호환을 위한 얇은 TypeScript entrypoint/wrapper만 둡니다.

---

## 구현된 핵심 기능

### Product/API/SDK 영역 — TypeScript

- `apps/dashboard`: Next.js 대시보드 화면 골격
- `apps/api`: NestJS Control Plane API 골격
- `apps/cli`: CLI entrypoint 골격
- `packages/schemas`: Organization/Project/Service/Resource/Deployment 타입 contract
- `packages/api-client`: REST client foundation
- `packages/ui`: dashboard 공용 UI utility foundation
- `openapi/raibitserver.yaml`: REST + OpenAPI contract

### Infra execution 영역 — Go

- `services/orchestrator`: desired state를 Kubernetes actual state로 reconcile하는 Go service skeleton
- `services/builder`: Dockerfile/Buildpack/prebuilt image build worker skeleton
- `services/provisioner`: PostgreSQL/MySQL/MongoDB/Redis/Object Storage/Vector DB/Queue provider interface skeleton
- `services/log-ingester`: log pipeline skeleton
- `services/metrics-ingester`: metrics pipeline skeleton

### Local deterministic core — TypeScript, Node.js built-ins only

- Build strategy resolver
- Framework detector
- Managed resource catalog
- Environment variable injection
- docker-compose importer
- Kubernetes-style manifest compiler
- Security/RBAC/quota/query guard helpers
- In-memory control-plane store
- HTTP API
- CLI
- Tests

---

## 빠른 검증

요구사항: Node.js 24 이상 권장. 현재 testable prototype은 Node의 TypeScript 실행 지원을 사용하므로 외부 npm install 없이 실행됩니다.

```sh
npm test
node scripts/check-structure.js
node src/cli.js catalog
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json > /tmp/raibitserver-manifest.json
node src/cli.js compose examples/docker-compose.yml > /tmp/raibitserver-compose-plan.json
npm run start:prototype-api
```

API 서버:

```sh
curl http://localhost:3000/health
curl http://localhost:3000/catalog
```

---

## 실행 모델

모든 앱 runtime은 내부적으로 아래 pipeline으로 통일됩니다.

```txt
Source Code / Dockerfile / Image
        ↓
Container Image
        ↓
Registry
        ↓
Kubernetes Workload
        ↓
Ingress / Domain / TLS
        ↓
Public URL 또는 internal service
```

지원 service type:

| Type | 예시 | 생성되는 Kubernetes 리소스 |
| --- | --- | --- |
| `web` | Next.js, React SPA, Express API, FastAPI | Deployment + Service + Ingress + PDB/HPA |
| `private` | internal API, admin service | Deployment + Service + PDB/HPA |
| `worker` | queue consumer, Discord bot, crawler | Deployment + PDB/HPA |
| `cron` | scheduled cleanup/report job | CronJob |
| `job` | migration, seed, import | Job |


---

## Subdomain-first routing

RAIBITSERVER는 서비스 실행 URL과 관리 화면을 모두 subdomain으로 분리합니다. 서비스별 격리, 로그/메트릭/DB 콘솔 분리, wildcard TLS 운영을 쉽게 하기 위해 기본 hostname은 단일 라벨에 `--`를 쓰는 패턴입니다.

```txt
Platform
- app.raibitserver.app                 # 사용자 대시보드
- api.raibitserver.app                 # Control Plane API
- admin.raibitserver.app               # 운영자 콘솔
- logs.raibitserver.app                # 로그 화면/endpoint
- metrics.raibitserver.app             # 메트릭 화면/endpoint

Public app service
- <service>--<project>--<org>.apps.raibitserver.app

Preview deployment
- pr-32--<service>--<project>--<org>.preview.raibitserver.app
- branch-feature-login--<service>--<project>--<org>.preview.raibitserver.app

Individual management screens
- <org>.console.raibitserver.app
- <project>--<org>.console.raibitserver.app
- <service>--<project>--<org>.console.raibitserver.app
- <resource>--<project>--<org>.resources.raibitserver.app
```

예를 들어 `gdg-hongik / festival-2026 / web` 서비스는 기본적으로 다음 URL을 받습니다.

```txt
실행 URL:      web--festival-2026--gdg-hongik.apps.raibitserver.app
서비스 화면:   web--festival-2026--gdg-hongik.console.raibitserver.app
Preview URL:   pr-32--web--festival-2026--gdg-hongik.preview.raibitserver.app
```

커스텀 도메인은 이 기본 subdomain 위에 alias로 붙입니다. 즉, 플랫폼 내부 식별과 운영 화면은 안정적인 RAIBITSERVER subdomain을 유지하고, 사용자가 연결한 `festival.example.com` 같은 도메인은 public app route에 추가로 매핑합니다.

---

## 빌드 전략

`packages/core/src/build-strategy.ts`는 다음 우선순위로 빌드 plan을 만듭니다.

1. `sourceType=image` 또는 `prebuilt-image`: build 없이 image 검증 후 runtime으로 전달
2. 명시/감지된 Dockerfile: 사용자 Dockerfile 최우선
3. custom build command
4. framework auto-detection
5. Buildpack/Nixpacks-compatible fallback

지원 설정:

```txt
rootDirectory
buildContext
dockerfilePath
installCommand
buildCommand
startCommand
outputDirectory
port
image
registry
```

---

## DB/Resource Catalog

`packages/core/src/catalog.ts`는 실제 DBaaS catalog의 출발점입니다.

| Catalog key | Engine | Provider 방향 | 주요 env |
| --- | --- | --- | --- |
| `postgresql` | PostgreSQL | CloudNativePG | `DATABASE_URL`, `POSTGRES_URL`, `PG*` |
| `mysql` | MySQL | Percona Operator | `MYSQL_URL`, `MYSQL_*` |
| `mariadb` | MariaDB | MariaDB/Percona profile | `MARIADB_URL`, `MYSQL_*` |
| `mongodb` | MongoDB | MongoDB/Atlas Operator | `MONGODB_URI`, `MONGO_*` |
| `redis` | Redis/Valkey | Redis Operator/Upstash adapter | `REDIS_URL`, `REDIS_*` |
| `object-storage` | S3-compatible | MinIO/S3 adapter | `S3_ENDPOINT`, `S3_*` |
| `vector-db` | Qdrant-compatible | Vector provider adapter | `VECTOR_DB_*` |
| `message-queue` | NATS-compatible | NATS/Kafka/Redpanda/RabbitMQ | `QUEUE_*` |

서비스가 resource를 attach하면 Secret/ConfigMap 환경변수가 자동 생성됩니다.

```json
{
  "name": "api",
  "attachedResources": ["festival-postgres", "festival-redis"]
}
```

---

## docker-compose import

Compose는 그대로 실행하지 않고 RAIBITSERVER 플랫폼 리소스로 변환합니다.

```sh
node src/cli.js compose examples/docker-compose.yml
```

예:

```yaml
services:
  web:
    build: ./web
    ports:
      - "3000:3000"
  postgres:
    image: postgres:16
  redis:
    image: redis:7
```

변환 결과:

```txt
web      -> RAIBITSERVER web service
postgres -> Managed PostgreSQL resource
redis    -> Managed Redis resource
```

이 방식은 backup, monitoring, RBAC, quota, scaling, lifecycle을 플랫폼이 통제할 수 있게 합니다.

---

## Kubernetes compiler

`packages/core/src/manifest-compiler.ts`는 project spec을 아래 manifest plan으로 컴파일합니다.

```txt
Namespace
Deployment / CronJob / Job
Service
Ingress
Secret
ConfigMap
HorizontalPodAutoscaler
NetworkPolicy
PodDisruptionBudget
Resource lifecycle plan
```

기본 보안:

- tenant namespace 분리
- `pod-security.kubernetes.io/enforce=restricted`
- non-root container
- `allowPrivilegeEscalation=false`
- capabilities drop ALL
- RuntimeDefault seccomp
- privileged / hostNetwork / hostPath validator block
- Secret과 ConfigMap 분리
- secret-looking value masking
- NetworkPolicy로 cross-project/control-plane 접근 차단 모델링
- destructive DB query confirmation guard

---

## NestJS API의 책임

`apps/api`는 실제 서비스에서 다음만 담당합니다.

```txt
사용자 요청 처리
권한 확인
Control Plane DB에 desired state 저장
결제/쿼터 확인
감사 로그 기록
workflow enqueue
```

예시 흐름:

```txt
POST /projects/:id/services
  ↓
services row 생성
  ↓
deployments row 생성
  ↓
build_jobs 또는 DeployWorkflow 생성
  ↓
Go builder/orchestrator/provisioner가 actual state reconcile
```

---

## Go services의 책임

### `services/orchestrator`

```txt
Kubernetes namespace 생성
Deployment/CronJob/Job 생성
Service/Ingress/Gateway 생성
Secret/ConfigMap 반영
Health check
Rollout/Rollback
Status sync
```

### `services/builder`

```txt
GitHub/GitLab/ZIP source fetch
Dockerfile 감지
BuildKit build
Buildpacks fallback
static app containerization
image push
build log streaming
cache/scanning/signing integration
```

### `services/provisioner`

```txt
PostgreSQL 생성
MySQL/MariaDB 생성
MongoDB 생성
Redis 생성
Object Storage 생성
Vector DB 생성
Message Queue 생성
Credential rotation
Backup/Restore
Secret injection status
```

---

## CLI

Prototype CLI (`src/cli.js` is a JS compatibility wrapper around `src/cli.ts`):

```sh
node src/cli.js help
node src/cli.js catalog
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json
node src/cli.js compose examples/docker-compose.yml
RAIBITSERVER_CONFIRMED=1 node src/cli.js guard-query "DROP TABLE users"
```

Workspace CLI skeleton:

```txt
apps/cli/src/index.ts
```

---

## HTTP API prototype

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 서버 상태 |
| `GET` | `/catalog` | managed resource catalog |
| `GET` | `/snapshot` | in-memory control-plane snapshot(masked) |
| `POST` | `/plan/build` | service build plan 생성 |
| `POST` | `/plan/compose` | compose text를 project plan으로 변환 |
| `POST` | `/plan/manifests` | project spec을 Kubernetes deployment plan으로 컴파일 |
| `POST` | `/validate` | security/quota/metrics 검증 |
| `POST` | `/guard/query` | destructive DB query guard |
| `POST` | `/organizations` | organization 생성 |
| `POST` | `/projects` | project 생성 |
| `POST` | `/services` | service 생성 |
| `POST` | `/resources` | resource 생성 |

OpenAPI contract는 `openapi/raibitserver.yaml`에 있습니다.

---

## Control Plane DB 방향

실제 RAIBITSERVER control-plane DB는 PostgreSQL 고정입니다. 사용자가 생성하는 PostgreSQL/MySQL/MongoDB/Redis/Object Storage/Vector DB는 별도 managed resource입니다.

초기 Prisma schema skeleton:

```txt
apps/api/prisma/schema.prisma
```

핵심 엔티티:

```txt
Organization
Project
Service
Deployment
Resource
AuditLog
```

장기적으로 추가할 엔티티:

```txt
User
Membership
Build
Runtime
EnvironmentVariable
Domain
Database
StorageBucket
Secret
UsageRecord
WebhookEvent
```

---

## 테스트

```sh
npm test
node scripts/check-structure.js
```

테스트 범위:

- Dockerfile/custom/framework/buildpack/prebuilt image build strategy
- framework detection
- resource catalog/env injection/secret masking
- docker-compose import
- Kubernetes manifest compiler
- security/RBAC/quota/query guard
- HTTP API and in-memory store
- monorepo structure presence

---

## 실제 서비스 확장 순서

1. **Product monorepo 완성**: Next.js dashboard, NestJS API, schemas, api-client, CLI.
2. **Control Plane DB 연결**: in-memory store를 PostgreSQL + Prisma로 교체.
3. **Builder 구현**: GitHub clone, Dockerfile 감지, BuildKit build, registry push, logs.
4. **Orchestrator 구현**: Kubernetes client-go/controller-runtime reconcile loop.
5. **Provisioner 구현**: CloudNativePG, Percona, MongoDB, Redis, MinIO/provider adapters.
6. **Workflow 도입**: 초기 BullMQ, 고도화 시 Temporal.
7. **Observability**: Loki/OpenSearch/ClickHouse, Prometheus, Grafana, Alertmanager.
8. **Billing/Quota**: usage_records 기반 Stripe/Toss/PortOne integration.
9. **Education features**: hackathon workspace, showcase, mentor mode, template gallery, assignment mode.

---

## 한 문장 정의

**RAIBITSERVER는 제품 개발은 TypeScript로 빠르게, 인프라 제어는 Go로 안정적으로, 전체 관리는 모노레포로 가져가는 컨테이너 기반 PaaS + DBaaS 플랫폼입니다.**
