# Production runbook

Production needs PostgreSQL persistence, secret encryption key, auth JWT secret, admin bootstrap emails, GitHub credentials when previews/import are enabled, registry/BuildKit/Kubernetes access, ingress/TLS/DNS, and provider admin credentials for direct PostgreSQL provisioning. Run tests, typecheck, Prisma validation, CLI smoke, Go service checks, dry E2E, and prepared live E2E before go-live.
