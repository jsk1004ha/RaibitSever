# Workflow Jobs

RAIBITSERVER stores desired state in the TypeScript control plane and moves infrastructure work through `WorkflowJob` records.

Implemented workflow contract:

- queued job claim with `lockedBy` and `lockedAt`,
- lock timeout/lease recovery,
- attempt counting,
- exponential retry backoff,
- terminal `succeeded`, `failed`, and `cancelled` states,
- idempotent target identity through `targetType` and `targetId`,
- audit records for enqueue, claim, complete, and fail,
- secret masking for job payloads, errors, and logs.

Current workflow types:

- `build-and-deploy`
- `preview-deploy`
- `kubernetes-apply`
- `provision-resource`

The local E2E path enqueues build/preview jobs and proves claim/retry/failure helpers without requiring a live queue broker. Production API persistence uses Prisma/PostgreSQL; the in-memory queue is restricted to deterministic dev/test fallback. The Go builder supports both local file-state mode (`RAIBITSERVER_CONTROL_PLANE_FILE`) and Prisma/PostgreSQL polling (`RAIBITSERVER_CONTROL_PLANE_DATABASE_URL`, or `RAIBITSERVER_CONTROL_PLANE_STORE=postgresql` plus `DATABASE_URL`) for `WorkflowJob` claim/update/log/event writes.

Worker implementations should call `processNextWorkflowJob` with type-specific handlers. Handlers must be idempotent: if the target deployment/resource already reached the desired state, return success and include existing artifact IDs instead of re-running unsafe work.
