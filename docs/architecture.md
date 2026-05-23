# RAIBITSERVER 아키텍처

> RAIBITSERVER는 TypeScript 제어 평면과 Go 인프라 reconcilers를 분리해, 사용자의 원하는 상태를 안전하게 실제 런타임 상태로 수렴시키는 플랫폼입니다.

## 목적

이 문서는 RAIBITSERVER의 주요 구성 요소, 데이터 흐름, 책임 경계를 설명합니다. 구현 세부 파일을 찾기 전 전체 구조를 이해할 때 사용합니다.

## 구성 요소

| 영역 | 위치 | 책임 |
| --- | --- | --- |
| Dashboard | `apps/dashboard` | 프로젝트, 서비스, 리소스, 로그, 승인/쿼터 관리 UI |
| Control Plane API | `apps/api` | 인증, RBAC, quota, audit, desired state 저장 |
| CLI | `apps/cli`, `src/cli.js` | API 조작과 로컬 smoke/manifest/compose 검증 |
| Core | `packages/core` | 빌드 전략, compose import, 도메인 라우팅, manifest compile, 보안/쿼터 규칙 |
| Shared packages | `packages/*` | schemas, API client, UI, config 공유 |
| Builder | `services/builder` | source/Dockerfile/image build, registry push, build log 기록 |
| Orchestrator | `services/orchestrator` | Kubernetes manifest apply, rollout 확인, runtime log/event 기록 |
| Provisioner | `services/provisioner` | 관리형 DB/storage/cache/vector/queue provider reconcile |
| Infra | `infra/*`, `deploy/*` | Terraform, Helm, CRD, 배포 환경 구성 |

## 핵심 흐름

```txt
사용자 입력/API 요청
  -> TypeScript API가 desired state 저장
  -> WorkflowJob 생성
  -> Go worker가 job claim
  -> build / k8s apply / resource provision 수행
  -> status, log, event, artifact 저장
  -> Dashboard/API/CLI에서 조회
```

## 설계 원칙

- 사용자 워크로드는 항상 **container image + Kubernetes desired state**로 귀결됩니다.
- 사용자 Dockerfile이 프레임워크 감지, buildpack, 생성 Dockerfile보다 우선합니다.
- API 요청 경로는 장시간 build/Kubernetes 작업을 직접 실행하지 않고 desired state와 job만 기록합니다.
- Go 서비스는 dry-run과 execute mode를 구분해 로컬 검증과 실제 실행을 분리합니다.
- local verification은 실제 Kubernetes, registry, cloud credential 없이 동작해야 합니다.

## 제어 평면과 인프라 경계

| 제어 평면이 하는 일 | Go 인프라 서비스가 하는 일 |
| --- | --- |
| 사용자/조직/프로젝트/서비스/리소스 모델 관리 | build, push, apply, provision 실행 |
| 인증, RBAC, quota, audit 처리 | job claim, retry, status update 처리 |
| desired state와 workflow job 저장 | 실제 인프라 상태를 desired state에 수렴 |
| secret 참조와 masking 정책 적용 | 실행 로그에서 secret 노출 방지 |

## 보안 기본값

생성 runtime artifact는 다음을 기본으로 합니다.

- namespace isolation
- NetworkPolicy
- non-root container
- privileged/hostPath/host networking 차단
- resource requests/limits
- dropped capabilities
- `RuntimeDefault` seccomp
- service account token automount 차단
- secret ref 기반 환경 변수 주입

자세한 내용은 [보안 문서](security.md)를 참고하세요.

## 관련 문서

- [워크플로 작업](workflows.md)
- [리소스 프로비저닝](provisioning.md)
- [보안](security.md)
- [검증 명령](verification-commands.md)
