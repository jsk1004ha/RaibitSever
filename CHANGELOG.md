# 변경 이력

이 문서는 사용자와 운영자가 확인해야 할 주요 변경 사항을 요약합니다. 상세 구현 이력은 Git commit과 release tag를 함께 확인하세요.

## Unreleased

### 보안

- 빌드 실행 시 `buildContext`와 `dockerfilePath`가 체크아웃된 서비스 소스 디렉터리 바깥으로 벗어나지 못하도록 경로 포함 검증을 추가했습니다.
- Go builder 엔트리포인트/worker 양쪽에 동일한 경로 검증을 적용해 실제 `docker buildx` 실행 경계에서 path traversal 기반 호스트 파일 노출을 차단했습니다.

### 문서

- README를 한국어 진입 문서로 재작성했습니다.
- 목적별 문서 허브(`docs/README.md`)를 추가하고 README에서 세부 문서로 연결했습니다.
- 운영, 보안, E2E, 프로비저닝, GitHub, DB console 문서를 한국어 중심 구조로 정리했습니다.

## 0.1.0

### 플랫폼 골격

- TypeScript 중심 monorepo와 Go 인프라 서비스 구조를 도입했습니다.
- 프로젝트, 서비스, 배포, 관리형 리소스, 승인/쿼터, preview deployment의 로컬 검증 계약을 제공합니다.
- 외부 credential 없이 실행 가능한 deterministic dry-run E2E 경로를 제공합니다.
