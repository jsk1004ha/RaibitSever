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
- provider 이름과 plan (`shared-small` 기본값)
- storage, version, backup policy, credential secret 이름
- connection environment variable용 Secret manifest

`provisionProjectResources`는 workload Kubernetes apply와 같은 dry-run/execute command surface로 이 manifest를 적용합니다.

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
