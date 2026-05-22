# Resource Provisioning

Managed resources are catalog resources attached to projects/services, not raw Docker Compose containers. The catalog includes PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Valkey, SQLite, Object Storage, Qdrant/vector, and NATS/queue.

## Desired-state plan

`packages/core/src/provisioner.ts` compiles each resource into a provider-neutral plan:

- `ManagedDatabase`, `ManagedCache`, `ManagedObjectStorage`, `ManagedVectorDatabase`, or `ManagedMessageQueue` CR-style manifest,
- provider name and plan (`shared-small` by default),
- storage, version, backup policy, and credential secret name,
- Secret manifest for generated connection environment variables.

`provisionProjectResources` applies those manifests through the same dry-run/execute command surface used by Kubernetes workloads.

## Local deterministic mode

Dry E2E uses provider manifests and SQLite console execution. It does not require cloud credentials or a local PostgreSQL/Redis server.

SQLite resources use a PVC-style path contract and inject:

- `SQLITE_PATH`
- `DATABASE_URL=sqlite:<path>`

## Live provider mode

When provider-owned credentials are configured:

- PostgreSQL console queries resolve a sealed provider `connectionSecretName`; tenant request bodies and resource-create payloads cannot supply connection URLs.
- Read-only PostgreSQL console queries and table browse run inside a database `READ ONLY` transaction with statement timeout, row limit, and result-size controls.
- PostgreSQL mutations require both `db:query` permission and explicit confirmation.
- SQLite query/table browse executes locally through `node:sqlite` only for provider-owned paths under `.raibitserver-work/sqlite`; filesystem-opening SQL (`ATTACH`, `DETACH`, `VACUUM INTO`, `load_extension`, and unsafe PRAGMAs) is blocked even for confirmed admin queries.
- Other catalog entries expose provider connection/browse contracts until their dedicated provider adapters are configured.

Secrets must be stored through sealed secret rows or Kubernetes Secret refs; API/CLI/log snapshots mask secret-looking values.
