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
| DB/상태 | `DATABASE_URL`, `RAIBITSERVER_CONTROL_PLANE_DATABASE_URL`, `RAIBITSERVER_CONTROL_PLANE_FILE`, `REDIS_URL` |
| Secret/Auth | `JWT_SECRET`, `RAIBITSERVER_AUTH_JWT_SECRET`, `ENCRYPTION_KEY`, `RAIBITSERVER_SECRET_ENCRYPTION_KEY`, `ADMIN_EMAILS` |
| Build/Runtime | `REGISTRY_URL`, `KUBECONFIG`, `BASE_DOMAIN` |
| Object Storage | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| GitHub App/OAuth | `GITHUB_APP_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` |

Production 실행 전 필수 설정은 [production 배포 문서](deploy/production/README.md)를 확인하세요.

## DB와 리소스 지원 범위

| 엔진 | 로컬 proof | Provider contract |
| --- | --- | --- |
| PostgreSQL | provider dry-run, env injection, console contract | user/database/grant, `DATABASE_URL`, connection test, backup/restore |
| MySQL/MariaDB | env/provision plan | DB/user/password |
| MongoDB | collection/document contract | database/user/URI |
| Redis/Valkey | key/value/TTL contract | URL/key browser |
| SQLite | 실행 가능한 로컬 console | PVC-backed file DB |
| Object Storage | MinIO/S3 env plan | bucket/browser/presign |
| Qdrant/vector | collection/search-test contract | vector collection/search |
| NATS/queue | subject/connection contract | queue connection info |

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
