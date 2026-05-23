# GitHub App 연동

> GitHub App/OAuth/webhook은 repository import, push deployment, PR preview deployment를 RAIBITSERVER workflow로 연결합니다.

## 목적

이 문서는 GitHub credentials, webhook 검증, token 저장, 로컬 fixture 계약을 설명합니다.

## 필요한 환경 변수

```txt
GITHUB_APP_ID
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
```

## 구현된 로컬 계약

- GitHub repository URL parsing과 clone planning은 token이 argv에 노출되지 않게 처리합니다.
- Webhook signature는 HMAC SHA-256으로 검증합니다.
- GitHub integration token은 encrypted `SecretValue` row 또는 sealed local store에 저장합니다.
- `pnpm e2e:dry`는 pull request fixture payload로 preview deployment record, workflow job, URL 생성을 검증합니다.

## credential이 없을 때

실제 GitHub credential이 없으면 다음 경로를 사용합니다.

- manual repository import
- webhook fixture 기반 테스트
- dry-run preview deployment proof

## credential이 있을 때

동일 API 계약이 GitHub OAuth/App installation과 webhook endpoint에 매핑됩니다. 정식 API contract는 [`openapi/raibitserver.yaml`](../openapi/raibitserver.yaml)을 확인하세요.

## 보안 주의사항

- token, private key, webhook secret은 request/CLI/log에 평문으로 출력하지 않습니다.
- clone command에는 token을 직접 argv로 넣지 않습니다.
- webhook secret 불일치 요청은 처리하지 않습니다.

## 관련 문서

- [Preview Deployment](preview-deployments.md)
- [보안](security.md)
- [로컬 E2E](local-e2e.md)
