# Workflow Jobs

> RAIBITSERVER는 장시간 인프라 작업을 API request path에서 직접 실행하지 않고 `WorkflowJob`으로 저장한 뒤 worker가 처리합니다.

## 목적

이 문서는 workflow job의 claim, retry, lease recovery, idempotency, worker 연동 원칙을 설명합니다.

## 기본 흐름

```txt
API가 desired state 저장
  -> WorkflowJob 생성
  -> worker가 claim
  -> type-specific handler 실행
  -> status/log/event/artifact 업데이트
  -> terminal state 기록
```

## 구현된 계약

- queued job claim with `lockedBy`, `lockedAt`
- lock timeout/lease recovery
- attempt counting
- exponential retry backoff
- terminal `succeeded`, `failed`, `cancelled` state
- `targetType`, `targetId` 기반 idempotent target identity
- enqueue/claim/complete/fail audit record
- job payload, error, log secret masking

## 현재 workflow type

- `build-and-deploy`
- `preview-deploy`
- `kubernetes-apply`
- `provision-resource`

## Worker 구현 원칙

Worker는 `processNextWorkflowJob`에 type-specific handler를 전달해 실행합니다. Handler는 idempotent해야 합니다.

- target deployment/resource가 이미 원하는 상태라면 성공으로 반환합니다.
- unsafe 작업을 재실행하지 않고 기존 artifact ID를 포함합니다.
- 실패는 error code/message와 event로 남깁니다.
- secret-looking 값은 payload, error, log에 남기지 않습니다.

## 로컬과 production store

| 모드 | 저장소 | 용도 |
| --- | --- | --- |
| dev/test fallback | in-memory | deterministic local test 전용 |
| local worker | `RAIBITSERVER_CONTROL_PLANE_FILE` | 파일 기반 deterministic worker mode |
| production | Prisma/PostgreSQL | API persistence와 Go builder polling |

Go builder는 `RAIBITSERVER_CONTROL_PLANE_DATABASE_URL` 또는 `RAIBITSERVER_CONTROL_PLANE_STORE=postgresql` + `DATABASE_URL`로 Prisma/PostgreSQL `WorkflowJob`을 claim/update/log/event 할 수 있습니다.

## 로컬 검증

`pnpm e2e:dry`는 build/preview job queue와 claim/retry/failure helper를 live queue broker 없이 검증합니다.

## 관련 문서

- [아키텍처](architecture.md)
- [Preview Deployment](preview-deployments.md)
- [Live E2E](live-e2e.md)
