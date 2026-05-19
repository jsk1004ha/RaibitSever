# DB Web Console

Supported contract:

- PostgreSQL/MySQL/MariaDB: schema/table/query contract with provider-backed execution when live connection is configured.
- SQLite: local executable console using Node's `node:sqlite`; supports table browse and guarded query execution.
- MongoDB: collection/document contract.
- Redis/Valkey: key/value/TTL contract.
- Object storage: bucket browser contract.
- Qdrant/vector: collection/search-test contract.
- NATS/queue: connection info and subject contract.

Guards: destructive SQL requires confirmation; viewer is read-only; query limits/timeouts/result-size controls are enforced by the console layer or provider adapter. Local E2E proves SQLite query and browse behavior.
