# Local E2E

```sh
pnpm install --frozen-lockfile
pnpm dev:up
pnpm dev:seed
pnpm e2e:dry
pnpm dev:down
```

`dev:up` records local tool availability for Docker, kind/k3d, kubectl, git, and Go. `pnpm e2e:dry` always runs deterministic local E2E without external side effects:

1. starts the API handler and an example app,
2. verifies NON_CLUB pending is blocked,
3. approves the user and sets quota,
4. creates project/service/SQLite resource,
5. runs SQLite DB console queries,
6. queues deployment and preview deployment,
7. stores build/runtime logs and deployment events,
8. compiles build/Kubernetes/provisioning dry-run artifacts.

Evidence is written to `.raibitserver-work/e2e-report.json`. Use `pnpm e2e:live` only when Docker, kubectl, and kind/k3d are available and you intentionally want `--execute` build/Kubernetes/provisioning commands against the local cluster.
