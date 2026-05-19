import fs from 'node:fs';

const required = [
  'apps/dashboard/package.json',
  'apps/api/package.json',
  'apps/cli/package.json',
  'packages/core/src/index.ts',
  'packages/schemas/src/index.ts',
  'packages/api-client/src/index.ts',
  'packages/ui/src/index.ts',
  'services/orchestrator/go.mod',
  'services/builder/go.mod',
  'services/provisioner/go.mod',
  'openapi/raibitserver.yaml',
  'infra/terraform/main.tf',
  'infra/helm/raibitserver/Chart.yaml',
  'deploy/local/docker-compose.yml',
];

const missing = required.filter((path) => !fs.existsSync(path));
if (missing.length) {
  console.error(`Missing required monorepo files:\n${missing.join('\n')}`);
  process.exit(1);
}
console.log('monorepo-structure-ok');
