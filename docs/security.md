# Security

Runtime workload policy blocks privileged containers, root users, hostPath, hostNetwork, hostPID/IPC style escapes, and missing hard resource safety caps. Generated manifests include restricted pod/container security context, no service account token mount, NetworkPolicy, limits, PDB, and HPA support.

Secrets:

- `.env` upload separates plain values from secret-looking keys.
- Secret values are AES-256-GCM sealed with `ENCRYPTION_KEY` / `RAIBITSERVER_SECRET_ENCRYPTION_KEY` or a local-dev fallback.
- API snapshots and logs mask secret-looking keys and primitive values.
- CLI auth-token is intentionally unmasked only for the token command; other outputs are masked.

DB console guard blocks destructive SQL unless explicitly confirmed and keeps viewer role read-only.
