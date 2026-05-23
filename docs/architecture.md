# RAIBITSERVER Architecture

RAIBITSERVER is a TypeScript-centered control plane with Go infrastructure reconcilers.

- **Dashboard/API/CLI:** TypeScript, shared Zod schemas, API client, and deterministic core packages.
- **Control plane DB:** PostgreSQL via Prisma schema (`prisma/schema.prisma`). The in-memory store remains for deterministic local tests only.
- **Workers:** Go builder/orchestrator/provisioner/log/metrics services reconcile desired state and can run in dry-run or execute mode. Builder can claim/update Prisma/PostgreSQL `WorkflowJob` rows directly; file-state mode remains for deterministic local tests.
- **Runtime:** every service resolves to a container image and Kubernetes desired state. Dockerfile wins over detection; generated Dockerfile/buildpack fallback is available.
- **Security:** non-root, no privileged/hostPath/host networking, read-only root FS, dropped capabilities, seccomp, resource limits, masked logs, encrypted secrets.

Local verification is intentionally credential-free: `pnpm e2e:dry` runs the control-plane/API/DB-console/log/preview/quota flow and emits dry-run build/Kubernetes/provisioning artifacts while live execution is isolated behind `pnpm e2e:live -- --execute` semantics.
