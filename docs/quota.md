# Quota and Approval

- `NON_CLUB` users default to `PENDING` and cannot create projects, services, deployments, resources, or previews.
- Admins approve/reject users and can patch per-user quota.
- `NON_CLUB + APPROVED` is constrained by the `Quota` row.
- `CLUB_MEMBER` is treated as unlimited for user-facing quota but still subject to hard security/safety caps.
- Quota blocks return 403/429-style errors and are audit logged in persistence-capable paths.

Local proof: `pnpm e2e:dry` blocks a pending non-club user, approves it, sets quota, then confirms a club member can create services beyond non-club limits.
