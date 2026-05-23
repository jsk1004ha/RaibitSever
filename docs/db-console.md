# DB Web Console

> DB Web Console은 관리형 resource를 안전하게 탐색하고 제한된 query를 실행하는 운영/개발 도구입니다.

## 목적

각 resource engine별 console 지원 범위와 query guard를 설명합니다. Console은 provider-owned secret을 사용하며 request body의 connection URL을 신뢰하지 않습니다.

## 지원 범위

| 엔진 | Console contract |
| --- | --- |
| PostgreSQL | schema/table/query, provider-backed execution |
| MySQL/MariaDB | schema/table/query contract |
| SQLite | `node:sqlite` 기반 local executable console, table browse, guarded query |
| MongoDB | collection/document browse contract |
| Redis/Valkey | key/value/TTL browse contract |
| Object Storage | bucket browser contract |
| Qdrant/vector | collection/search-test contract |
| NATS/queue | connection info, subject contract |

## 공통 guard

- destructive SQL은 명시적 confirmation이 필요합니다.
- viewer 역할은 read-only입니다.
- query limit, timeout, result-size control을 console layer 또는 provider adapter에서 강제합니다.
- provider connection material은 sealed provider secret에서만 가져옵니다.
- request body의 connection URL/URI/DSN/JDBC 값은 사용하지 않습니다.

## SQLite 추가 guard

SQLite는 실행 전에 다음을 차단합니다.

- `ATTACH`
- `DETACH`
- `VACUUM INTO`
- `load_extension`
- unsafe PRAGMA

SQLite parent directory는 provider-owned `.raibitserver-work/sqlite` local console root 아래에서만 생성합니다.

## 로컬 검증

`pnpm e2e:dry`가 SQLite query와 table browse 동작을 검증합니다.

## 관련 문서

- [리소스 프로비저닝](provisioning.md)
- [보안](security.md)
- [문제 해결](troubleshooting.md)
