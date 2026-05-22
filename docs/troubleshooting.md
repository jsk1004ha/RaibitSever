# Troubleshooting

## `pnpm install --frozen-lockfile` fails

Use Node.js 24+ and pnpm 11.1.2:

```sh
corepack enable
pnpm --version
```

The repository pins `packageManager: pnpm@11.1.2`.

## Production API refuses to boot

Production persistence defaults to Prisma/PostgreSQL. Set:

- `DATABASE_URL`
- `ENCRYPTION_KEY` or `RAIBITSERVER_SECRET_ENCRYPTION_KEY`
- `JWT_SECRET` or `RAIBITSERVER_AUTH_JWT_SECRET`

The in-memory repository is only for dev/test fallback and requires explicit opt-in outside those modes.

## Dry E2E passes but live E2E fails immediately

`pnpm e2e:live` requires Docker, kubectl, and kind or k3d. Run:

```sh
pnpm dev:up
cat .raibitserver-work/local-stack.json
```

Missing tools are reported before any side-effecting build or Kubernetes operation starts.

## Deployment blocked by security policy

RAIBITSERVER blocks privileged containers, root execution, host networking, host PID/IPC, hostPath, capability additions, writable non-`/tmp` mounts, service-account token automount, and non-`RuntimeDefault` seccomp. Fix the service desired state and retry deployment.

## DB console query rejected

- Viewer role can run read-only queries only.
- Non-read SQL requires `db:query` permission and `confirmed: true`.
- Live PostgreSQL queries require a provider-owned connection URL on the resource; request-supplied URLs are ignored.
- Resource-create payloads strip connection URL/URI/DSN/JDBC variants from both top-level resource fields and nested `desiredSpec`.
- SQLite creates parent directories only under the provider-owned `.raibitserver-work/sqlite` local console root, and blocks `ATTACH`, `DETACH`, `VACUUM INTO`, `load_extension`, and unsafe PRAGMAs before SQLite executes them.
