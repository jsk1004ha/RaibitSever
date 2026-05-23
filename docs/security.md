# 보안 정책

> RAIBITSERVER는 사용자 workload와 secret, DB console, 로그가 기본적으로 안전한 경계 안에서 동작하도록 제한합니다.

## 목적

이 문서는 runtime workload 정책, secret 저장/마스킹, DB console guard, 로컬 검증 범위를 설명합니다.

## Workload security

Runtime workload policy는 다음을 차단합니다.

- privileged container
- root user 실행
- hostPath
- hostNetwork
- hostPID/hostIPC escape
- capability 추가
- writable non-`/tmp` mount
- service account token automount
- `RuntimeDefault`가 아닌 seccomp
- hard resource safety cap 누락

생성 manifest는 다음을 포함합니다.

- restricted pod/container security context
- NetworkPolicy
- resource requests/limits
- dropped capabilities
- no service account token mount
- PodDisruptionBudget 지원
- HPA 지원

## Secret security

- `.env` upload는 일반 값과 secret-looking key를 분리합니다.
- Secret 값은 `ENCRYPTION_KEY` 또는 `RAIBITSERVER_SECRET_ENCRYPTION_KEY`로 AES-256-GCM sealing합니다.
- 로컬 개발 fallback은 dev/test 전용입니다.
- API snapshot과 log는 secret-looking key/value를 masking합니다.
- CLI auth-token command는 token 발급 목적상 예외이며, 그 외 출력은 masking합니다.

## DB console guard

- destructive SQL은 explicit confirmation이 필요합니다.
- viewer role은 read-only query만 실행할 수 있습니다.
- provider-owned connection만 사용하고 request-supplied URL은 무시합니다.
- SQLite는 filesystem-opening statement를 실행 전에 차단합니다.

## 검증

```sh
pnpm test
node --test tests/security-rbac-quota.test.js
pnpm e2e:dry
```

변경 범위가 manifest compiler나 resource provider에 닿으면 [검증 명령 매트릭스](verification-commands.md)의 해당 섹션도 실행합니다.

## 관련 문서

- [승인과 쿼터](quota.md)
- [DB Console](db-console.md)
- [리소스 프로비저닝](provisioning.md)
