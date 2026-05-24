# 변경 이력

이 문서는 사용자와 운영자가 확인해야 할 주요 변경 사항을 요약합니다. 상세 구현 이력은 Git commit과 release tag를 함께 확인하세요.

## Unreleased

### 보안

- builder worker가 tenant 입력 경로(`localPath`, `buildContext`, `dockerfilePath`)를 workspace/source 디렉터리 경계 안으로 강제하도록 수정했습니다.
- 경로가 `..` 또는 절대 경로로 빌드 경계를 벗어나는 경우 빌드를 실패 처리하도록 테스트를 추가했습니다.

### 문서

- README를 한국어 진입 문서로 재작성했습니다.
- 목적별 문서 허브(`docs/README.md`)를 추가하고 README에서 세부 문서로 연결했습니다.
- 운영, 보안, E2E, 프로비저닝, GitHub, DB console 문서를 한국어 중심 구조로 정리했습니다.

## 0.1.0

### 플랫폼 골격

- TypeScript 중심 monorepo와 Go 인프라 서비스 구조를 도입했습니다.
- 프로젝트, 서비스, 배포, 관리형 리소스, 승인/쿼터, preview deployment의 로컬 검증 계약을 제공합니다.
- 외부 credential 없이 실행 가능한 deterministic dry-run E2E 경로를 제공합니다.
