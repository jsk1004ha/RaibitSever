# Verification command matrix

Use these exact commands to verify production-risk hardening changes. The baseline commands are deterministic and do not require cloud credentials, a live Kubernetes cluster, or GitHub secrets.

## Baseline local acceptance

Run this set before handing off any production-hardening slice:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm prisma:validate
node src/cli.js validate examples/project.json
node src/cli.js manifest examples/project.json >/tmp/raibitserver-manifest.json
node src/cli.js compose examples/docker-compose.yml >/tmp/raibitserver-compose-plan.json
node src/cli.js provision-plan examples/project.json >/tmp/raibitserver-provision-plan.json
node src/cli.js k8s-apply examples/project.json >/tmp/raibitserver-k8s-apply.json
pnpm e2e:dry
```

If Go is installed, also run the same Go loop as CI:

```sh
for dir in services/builder services/orchestrator services/provisioner services/log-ingester services/metrics-ingester; do
  test -f "$dir/go.mod"
  (cd "$dir" && go test ./... && go build ./...)
done
```

## Focused checks by change area

### Go builder/orchestrator/provisioner workers

```sh
node --test tests/go-builder-worker.test.js tests/go-orchestrator-reconciler.test.js
for dir in services/builder services/orchestrator services/provisioner; do
  (cd "$dir" && go test ./... && go build ./...)
done
```

Add or update focused Go package tests next to the changed package. For example, production control-plane store changes in `services/builder/internal/controlplane` should include a package-level store test plus the builder worker contract test above.

### Live E2E bootstrap and CI workflow contract

```sh
node --test tests/e2e-mode.test.js tests/local-e2e.test.js tests/ci-cli-smoke.test.js
pnpm e2e:dry
```

Only run the live local-cluster proof when side effects are intentional and Docker, kubectl, and kind or k3d are available:

```sh
pnpm dev:up
pnpm e2e:live
pnpm dev:down
```

### TypeScript control plane, API, auth, GitHub, and workflow jobs

```sh
node --test \
  tests/api-store.test.js \
  tests/api-contract-sync.test.js \
  tests/api-contract-github-resource-console.test.js \
  tests/auth-env-github.test.js \
  tests/scope-auth.test.js \
  tests/workflow-jobs.test.js
pnpm --filter @raibitserver/api typecheck
pnpm --filter @raibitserver/api test
```

### Build, manifest, resource provider, and security policy changes

```sh
node --test \
  tests/build-strategy.test.js \
  tests/manifest-compiler.test.js \
  tests/compose-importer.test.js \
  tests/domain-router.test.js \
  tests/resource-providers.test.js \
  tests/security-rbac-quota.test.js
pnpm --filter @raibitserver/core test
pnpm --filter @raibitserver/core typecheck
```

### CLI, Prisma, OpenAPI, and infrastructure manifests

```sh
node --test tests/ci-cli-smoke.test.js
pnpm prisma:validate
pnpm prisma:generate
node -e "import('yaml').then(({default:YAML})=>{const fs=require('node:fs'); YAML.parse(fs.readFileSync('openapi/raibitserver.yaml','utf8')); for (const f of ['infra/k8s/appservice-crd.yaml','infra/operators/manageddatabase-crd.yaml','infra/operators/managedresources-crd.yaml']) YAML.parse(fs.readFileSync(f,'utf8')); console.log('yaml-ok')})"
```

If Helm is installed:

```sh
helm template raibitserver infra/helm/raibitserver >/tmp/raibitserver-helm.yaml
```

### Dashboard and app-package changes

```sh
pnpm --filter @raibitserver/dashboard typecheck
pnpm --filter @raibitserver/dashboard lint
pnpm --filter @raibitserver/cli typecheck
```

## Known coverage gaps

- `pnpm lint` currently runs `git diff --check` and `node scripts/check-structure.js`; it is not a full ESLint pass for every package.
- Root `pnpm typecheck` covers `packages/core`, `apps/api`, `apps/cli`, and `apps/dashboard`; packages without scripts are not independently typechecked.
- `pnpm e2e:live` is intentionally side-effecting and outside default CI; use `pnpm e2e:dry` as the deterministic default proof.
- Go service validation is a manual CI loop rather than a root script.
