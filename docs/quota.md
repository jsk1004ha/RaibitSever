# Quota and Approval

- `NON_CLUB` users default to `PENDING` and cannot create projects, services, deployments, resources, or previews.
- Admins approve/reject users and can patch per-user quota.
- `NON_CLUB + APPROVED` is constrained by the `Quota` row.
- `CLUB_MEMBER` is treated as unlimited for user-facing quota but still subject to hard security/safety caps.
- Quota blocks return 403/429-style errors and are audit logged in persistence-capable paths.

Runtime quota usage now includes:

- project and service counts,
- daily deployment count,
- preview deployment count,
- DB storage MB and object storage MB,
- monthly build minutes from usage records and deployment build timestamps,
- monthly runtime hours from usage records and deployment runtime timestamps,
- aggregate service CPU requests in millicores,
- aggregate service memory requests in MB.

Plan-time quota names in `packages/core/src/quota.ts` (`apps`, `projects`, `dbStorageGb`, `buildMinutesMonthly`) remain the public plan model. Runtime enforcement maps those concepts to `Quota` row fields such as `maxServices`, `maxProjects`, `maxDbStorageMb`, `maxBuildMinutesPerMonth`, and `maxRuntimeHoursPerMonth`.

Local proof: `pnpm e2e:dry` blocks a pending non-club user, approves it, sets quota, confirms build/runtime/resource usage evidence, and then confirms a club member can create services beyond non-club limits.
