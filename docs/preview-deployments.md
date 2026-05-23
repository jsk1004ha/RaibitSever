# Preview Deployment

> PR preview는 pull request 단위로 임시 배포 URL을 만들고, PR 종료 시 cleanup workflow로 정리하는 기능입니다.

## URL 패턴

```txt
pr-<number>--<service>--<project>--<org>.preview.<BASE_DOMAIN>
```

서비스 실행 URL과 관리 화면은 subdomain-first routing 원칙을 따릅니다.

## 생성 흐름

1. GitHub `pull_request` 이벤트가 들어옵니다.
2. `opened`, `synchronize`, `reopened` 이벤트는 `PREVIEW` deployment를 queue합니다.
3. RAIBITSERVER는 preview deployment record, workflow job, preview URL을 생성합니다.
4. Builder/orchestrator가 preview build와 apply를 처리합니다.
5. Dashboard/API/CLI에서 preview 상태와 로그를 조회합니다.

## Cleanup 흐름

- `closed` 이벤트는 preview cleanup job을 queue합니다.
- cleanup은 deployment/resource/log/event를 idempotent하게 정리해야 합니다.
- 이미 정리된 preview에 대해 cleanup이 재실행되어도 성공으로 처리합니다.

## 로컬 검증

`pnpm e2e:dry`는 실제 GitHub credential 없이 pull request fixture payload로 preview deployment record, workflow job, URL 생성을 확인합니다.

## 관련 문서

- [GitHub App 연동](github-app.md)
- [워크플로 작업](workflows.md)
- [Live E2E](live-e2e.md)
