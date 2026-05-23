# RAIBITSERVER Staging 배포

> Staging은 production과 같은 구성 요소를 작은 규모로 실행해 release 후보를 검증하는 환경입니다.

## 목적

Production 배포 전에 API, dashboard, Go workers, registry, ingress, certificate 경계를 확인합니다.

## 필요한 구성 요소

- NestJS API
- Next.js dashboard
- Go orchestrator
- Go builder
- Go provisioner
- PostgreSQL
- Redis
- registry
- ingress controller
- cert-manager integration

## 배포 전 확인

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm prisma:validate
pnpm e2e:dry
```

Go가 설치된 runner라면 다음도 확인합니다.

```sh
for dir in services/builder services/orchestrator services/provisioner; do
  (cd "$dir" && go test ./... && go build ./...)
done
```

## 운영 원칙

- Production secret을 staging에 재사용하지 않습니다.
- Staging database와 registry는 production과 분리합니다.
- smoke test 실패 시 production promotion을 중단합니다.
- preview deployment cleanup이 누락되지 않았는지 주기적으로 확인합니다.

## 관련 문서

- [Production 배포](../production/README.md)
- [Live E2E](../../docs/live-e2e.md)
- [검증 명령](../../docs/verification-commands.md)
