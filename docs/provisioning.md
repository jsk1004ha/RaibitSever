# 리소스 프로비저닝

> RAIBITSERVER의 DB/storage/cache/vector/queue는 raw compose container가 아니라 프로젝트에 연결되는 관리형 catalog resource입니다.

## 목적

이 문서는 resource catalog, provider-neutral desired-state plan, dry-run/live provider mode, secret 처리 원칙을 설명합니다.

## 지원 catalog

- PostgreSQL
- MySQL
- MariaDB
- MongoDB
- Redis
- Valkey
- SQLite
- Object Storage
- Qdrant/vector
- NATS/queue

## Desired-state plan

`packages/core/src/provisioner.ts`는 각 resource를 provider-neutral plan으로 compile합니다.

- `ManagedDatabase`, `ManagedCache`, `ManagedObjectStorage`, `ManagedVectorDatabase`, `ManagedMessageQueue` 형태의 CR-style manifest
- provider 이름과 plan (`shared-small` 기본값). `shared-small`은 resource마다 새 DB/Redis 컨테이너를 띄우는 뜻이 아니라, 공유 provider 인스턴스 안에 tenant primitive를 만드는 뜻입니다.
- storage, version, backup policy, credential secret 이름
- connection environment variable용 Secret manifest

`provisionProjectResources`는 workload Kubernetes apply와 같은 dry-run/execute command surface로 이 manifest를 적용합니다.

## Shared provider model

RAIBITSERVER DBaaS의 기본 운영 단위는 **공유 provider 인스턴스 + 프로젝트별 tenant primitive**입니다. RAM을 줄이고 운영 표면을 단순화하기 위해 `shared-small` 플랜은 다음처럼 동작해야 합니다.

| 엔진 | 공유 provider | 프로젝트별 생성 단위 | 삭제/복구 단위 |
| --- | --- | --- | --- |
| PostgreSQL | PostgreSQL 서버 1개 + PgBouncer | database + cluster-level role/user | `pg_dump -Fc`/`pg_restore` per database |
| MySQL/MariaDB | MySQL/MariaDB 서버 1개 | database + user/grant | database dump/restore |
| MongoDB | MongoDB 서버 1개 | database + user | `mongodump --db` / `mongorestore --db` |
| Redis/Valkey | Redis/Valkey 서버 1개 | ACL user + key prefix | `SCAN MATCH <prefix>*` + `UNLINK`; prefix restore는 별도 검증 필요 |
| Object Storage | S3/MinIO provider | bucket + scoped credentials | bucket mirror/restore |

PostgreSQL 서비스 연결은 기본적으로 `서비스/API -> PgBouncer -> PostgreSQL` 경로를 사용합니다. Provider admin URL은 database/user/grant 생성에만 사용하고, workload에는 provider-owned secret으로 PgBouncer 경유 `DATABASE_URL`을 주입합니다.

### 메모리/연결 최적화

- PostgreSQL은 `max_connections`를 낮게 유지하고 PgBouncer transaction pooling으로 앱 연결 폭증을 흡수합니다.
- OOM 압력이 생기면 provider 운영자는 `shared_buffers`, `work_mem`, `hash_mem_multiplier`, 과도한 connection 수를 함께 낮춥니다.
- shared-small tenant에는 role/database 단위 `statement_timeout`, `idle_in_transaction_session_timeout`, connection limit, storage/quota/metering을 적용합니다.
- Redis/Valkey는 prefix만 믿지 않고 ACL key pattern(`~<prefix>*`)과 위험 명령 차단(`-FLUSHDB`, `-FLUSHALL`)을 같이 사용합니다.

### 단점과 위험 완화

- **Noisy neighbor**: 무거운 쿼리, 인덱스 생성, 대량 insert, Redis 대량 key가 같은 provider의 다른 tenant에 영향을 줄 수 있습니다. shared-small에는 quota/timeout/slow-query 관측을 켜고, 반복 위반 또는 상위 사용량 tenant는 dedicated plan으로 승격합니다.
- **격리 한계**: database/user 분리는 실용적이지만 PostgreSQL role, WAL, autovacuum, shared buffers, 디스크 I/O는 공유됩니다. 따라서 username/database/bucket/prefix는 provider 전체에서 충돌하지 않게 생성하고 tenant가 admin endpoint를 직접 받지 않게 합니다.
- **백업/복구 복잡도**: shared provider에서는 프로젝트 단위 복구만 수행하도록 per-database/per-bucket dump 흐름을 표준화합니다. Redis prefix 복구는 가장 취약하므로 production 전 restore rehearsal이 필요합니다.
- **Redis prefix-only 위험**: Redis logical DB 분리는 tenant 격리 수단으로 쓰지 않습니다. Redis Cluster는 database 0만 사용하는 제약도 있으므로 ACL key pattern과 command 제한을 필수로 둡니다.
- **파괴적 삭제 위험**: shared Redis/Valkey provider에서 `FLUSHDB`/`FLUSHALL`은 금지입니다. 삭제 command contract는 `SCAN MATCH <prefix>*`로 key를 찾고 `UNLINK`로 비동기 삭제합니다.

## Beta vs 정식 버전 위험 완화 범위

베타에서는 “한 tenant가 다른 tenant 데이터를 지우거나, 기본 연결 폭증으로 provider를 즉시 불안정하게 만드는 위험”을 우선 막습니다. 정식 버전에서는 자동 관측·승격·복구 자동화처럼 운영 자동화 수준이 필요한 항목을 완료합니다.

| 위험 | 베타 필수 구현 | 정식 버전/GA까지 유예 |
| --- | --- | --- |
| PostgreSQL connection/OOM | PgBouncer 경유 `DATABASE_URL`, role별 `CONNECTION LIMIT`, `statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout` provider plan contract | 실제 provider별 pool size 자동 튜닝, tenant별 slow-query 기반 throttling |
| PostgreSQL noisy neighbor | per-role timeout/connection limit와 quota/metering contract | heavy query 자동 탐지, project별 dedicated DB 자동 승격, index/build 작업 제한 UI |
| PostgreSQL role/database 격리 | provider 전체에서 충돌하기 어려운 generated database/user naming, provider-owned secret만 주입 | 조직별 별도 cluster/namespace 또는 paid dedicated plan |
| MySQL/MariaDB/MongoDB 격리 | database + user/grant 또는 database + user 생성 contract, database 단위 dump/restore command | provider별 live quota enforcement와 point-in-time per-tenant restore 자동화 |
| Redis/Valkey 전체 삭제 | ACL user + `REDIS_KEY_PREFIX`, `-@admin`, `-@dangerous`, `-FLUSHALL`, `-FLUSHDB`, 삭제는 `SCAN MATCH <prefix>*` + `UNLINK` | per-prefix memory/key cardinality meter, restore rehearsal 자동화, Redis Cluster topology별 prefix scan adapter |
| 백업/복구 | PostgreSQL/MySQL/MongoDB는 tenant primitive 단위 command contract 문서화 | Redis prefix-level restore tooling, self-serve point-in-time restore UI, 정기 복구 리허설 자동화 |

따라서 베타에서 “완전한 noisy-neighbor 해소”를 약속하지 않습니다. 베타의 완료 조건은 shared-small을 안전하게 체험할 수 있도록 destructive operation, connection 폭증, timeout 부재를 막는 것입니다.

## 로컬 deterministic mode

Dry E2E는 provider manifest와 SQLite console 실행만 사용합니다. cloud credential이나 로컬 PostgreSQL/Redis 서버가 필요하지 않습니다.

SQLite resource는 PVC-style path contract를 사용하고 다음 env를 주입합니다.

```txt
SQLITE_PATH
DATABASE_URL=sqlite:<path>
```

## Live provider mode

Provider-owned credential이 설정되면 다음 원칙을 적용합니다.

- PostgreSQL console query는 sealed provider `connectionSecretName`에서 connection material을 가져옵니다.
- tenant request body와 resource-create payload는 connection URL/URI/DSN/JDBC variants를 제공할 수 없습니다.
- read-only PostgreSQL console query와 table browse는 `READ ONLY` transaction, statement timeout, row limit, result-size control 안에서 실행합니다.
- PostgreSQL mutation은 `db:query` permission과 명시적 확인이 모두 필요합니다.
- SQLite query/table browse는 provider-owned `.raibitserver-work/sqlite` root 아래 path에 대해서만 실행합니다.
- SQLite는 `ATTACH`, `DETACH`, `VACUUM INTO`, `load_extension`, unsafe PRAGMA를 실행 전에 차단합니다.
- 다른 catalog resource는 dedicated provider adapter가 설정되기 전까지 connection/browse contract를 노출합니다.

## Secret 처리

- provider secret은 sealed secret row 또는 Kubernetes Secret ref로 저장합니다.
- API/CLI/log snapshot은 secret-looking 값을 masking합니다.
- 서비스 env에는 secret 값을 직접 기록하지 않고 secret ref를 사용합니다.

## 관련 문서

- [DB Console](db-console.md)
- [보안](security.md)
- [승인·쿼터](quota.md)
