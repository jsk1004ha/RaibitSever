import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import YAML from 'yaml';
import { RAIBITSERVERClient } from '../packages/api-client/src/index.ts';
import { PrismaControlPlaneRepository, resolveControlPlaneRepositoryConfig } from '../packages/core/src/persistence.ts';

test('api client uses project-scoped deployment route and keeps legacy fallback', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
    const payload = req.method === 'GET' ? { deployments: [] } : { id: 'dep_1', serviceId: 'service 1', status: 'queued' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new RAIBITSERVERClient({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  try {
    await client.createDeployment('project 1', 'service 1', { deploymentType: 'preview', branch: 'feat/api' });
    await client.listDeployments('project 1', 'service 1');
    await client.createDeployment('service 1', { deploymentType: 'manual' });
  } finally {
    server.close();
  }
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/projects/project%201/services/service%201/deployments');
  assert.equal(JSON.parse(requests[0].body).deploymentType, 'preview');
  assert.equal(requests[1].method, 'GET');
  assert.equal(requests[1].url, '/projects/project%201/services/service%201/deployments');
  assert.equal(requests[2].url, '/services/service%201/deployments');
});

test('OpenAPI and Nest controller surface expose client contract routes', async () => {
  const openapi = YAML.parse(await fs.readFile(new URL('../openapi/raibitserver.yaml', import.meta.url), 'utf8'));
  for (const route of [
    '/projects/{projectId}',
    '/services/{serviceId}',
    '/projects/{projectId}/services/{serviceId}/deployments',
    '/deployments/{deploymentId}',
    '/deployments/{deploymentId}/status',
    '/deployments/{deploymentId}/cancel',
    '/deployments/{deploymentId}/rollback',
    '/projects/{projectId}/services/{serviceId}/env',
    '/projects/{projectId}/services/{serviceId}/env-file',
    '/auth/github/login',
    '/auth/github/callback',
    '/github/installations',
    '/integrations/github',
    '/projects/{projectId}/services/{serviceId}/github',
    '/github/installations/{installationId}/repositories',
    '/github/webhooks',
    '/github/repositories/import',
    '/github/repositories/{repositoryId}/sync',
    '/resources/{resourceId}/console/schema',
    '/resources/{resourceId}/console/tables',
    '/resources/{resourceId}/console/collections',
    '/resources/{resourceId}/console/keys',
    '/resources/{resourceId}/console/query',
    '/resources/{resourceId}/console/command',
    '/resources/{resourceId}/console/browse',
    '/usage/me',
  ]) {
    assert.ok(openapi.paths[route], `${route} missing from OpenAPI`);
  }

  const appModule = await fs.readFile(new URL('../apps/api/src/app.module.ts', import.meta.url), 'utf8');
  assert.match(appModule, /ServiceDeploymentsController/);
  assert.match(appModule, /DeploymentLogsController/);
  assert.match(appModule, /ResourceConsoleController/);
  assert.match(appModule, /UsageController/);

  const servicesController = await fs.readFile(new URL('../apps/api/src/modules/services/services.controller.ts', import.meta.url), 'utf8');
  const projectsController = await fs.readFile(new URL('../apps/api/src/modules/projects/projects.controller.ts', import.meta.url), 'utf8');
  const deploymentsController = await fs.readFile(new URL('../apps/api/src/modules/deployments/deployments.controller.ts', import.meta.url), 'utf8');
  const resourcesController = await fs.readFile(new URL('../apps/api/src/modules/resources/resources.controller.ts', import.meta.url), 'utf8');
  const resourceConsoleController = await fs.readFile(new URL('../apps/api/src/modules/resources/resource-console.controller.ts', import.meta.url), 'utf8');
  const githubController = await fs.readFile(new URL('../apps/api/src/modules/integrations/github.controller.ts', import.meta.url), 'utf8');
  const authController = await fs.readFile(new URL('../apps/api/src/modules/auth/auth.controller.ts', import.meta.url), 'utf8');
  const apiMain = await fs.readFile(new URL('../apps/api/src/main.ts', import.meta.url), 'utf8');
  const persistence = await fs.readFile(new URL('../packages/core/src/persistence.ts', import.meta.url), 'utf8');
  const apiClient = await fs.readFile(new URL('../packages/api-client/src/index.ts', import.meta.url), 'utf8');
  assert.match(servicesController, /@Get\(\)/);
  assert.match(projectsController, /@Get\(':projectId'\)/);
  assert.match(projectsController, /@Patch\(':projectId'\)/);
  assert.match(projectsController, /@Delete\(':projectId'\)/);
  assert.match(servicesController, /ServiceDetailController/);
  assert.match(servicesController, /@Patch\(\)/);
  for (const marker of ["@Get('deployments/:deploymentId')", "@Patch('deployments/:deploymentId/status')", "@Post('deployments/:deploymentId/status')", "@Post('deployments/:deploymentId/cancel')", "@Post('deployments/:deploymentId/rollback')"]) assert.ok(deploymentsController.includes(marker), `${marker} missing from Deployments controller`);
  assert.match(resourcesController, /@Get\(\)/);
  for (const marker of ["@Get('schema')", "@Get('tables')", "@Get('collections')", "@Get('keys')", "@Post('query')", "@Post('command')", "@Post('browse')"]) assert.ok(resourceConsoleController.includes(marker), `${marker} missing from ResourceConsoleController`);
  for (const marker of ["@Get('github/installations')", "@Get('github/installations/:installationId/repositories')", "@Post('github/webhooks')", "@Post('github/repositories/import')", "@Post('github/repositories/:repositoryId/sync')"]) assert.ok(githubController.includes(marker), `${marker} missing from GitHub controller`);
  assert.ok(apiMain.includes('rawBody: true'), 'Nest bootstrap must keep raw webhook bytes for GitHub HMAC verification');
  assert.ok(githubController.includes('req.rawBody'), 'GitHub webhook controller must verify the original raw payload bytes');
  assert.ok(persistence.includes('if (integrationIds.length === 0) return { installationId: String(input.installationId), repositories: [] };'), 'Prisma GitHub installation repository listing must not leak all repos when scope filters out integrations');
  assert.ok(!persistence.includes('integrationIds.length === 0 || integrationIds.includes'), 'Prisma GitHub installation repository listing must not use broad fallback matching');
  assert.ok(authController.includes("@Get('github/login')"));
  assert.ok(authController.includes("@Get('github/callback')"));
  for (const method of ['getProject', 'updateProject', 'deleteProject', 'getService', 'updateService', 'deleteService', 'getDeployment', 'updateDeploymentStatus', 'cancelDeployment', 'rollbackDeployment', 'resourceSchema', 'resourceTables', 'resourceCollections', 'resourceKeys', 'commandResource', 'listGitHubInstallations', 'listGitHubInstallationRepositories', 'importGitHubRepository', 'syncGitHubRepository']) assert.match(apiClient, new RegExp(method));
});

test('production persistence defaults to Prisma and rejects unsafe memory/secret gaps', () => {
  assert.deepEqual(resolveControlPlaneRepositoryConfig({}, {}), { kind: 'memory', production: false });
  assert.deepEqual(resolveControlPlaneRepositoryConfig({}, {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/raibitserver',
    RAIBITSERVER_SECRET_ENCRYPTION_KEY: 'x'.repeat(32),
  }), { kind: 'prisma', production: true });
  assert.throws(() => resolveControlPlaneRepositoryConfig({ kind: 'memory' }, { NODE_ENV: 'production' }), /in-memory persistence is disabled in production/);
  assert.throws(() => resolveControlPlaneRepositoryConfig({}, { NODE_ENV: 'production', RAIBITSERVER_SECRET_ENCRYPTION_KEY: 'x'.repeat(32) }), /DATABASE_URL is required/);
  assert.throws(() => resolveControlPlaneRepositoryConfig({}, { NODE_ENV: 'production', DATABASE_URL: 'postgresql://db' }), /RAIBITSERVER_SECRET_ENCRYPTION_KEY/);
  assert.equal(resolveControlPlaneRepositoryConfig({ kind: 'memory' }, { NODE_ENV: 'production', RAIBITSERVER_ALLOW_MEMORY_PERSISTENCE: '1' }).kind, 'memory');
});

test('Prisma desired-state writer uses the authenticated organization id instead of default memory semantics', async () => {
  const calls = [];
  const tx = {
    organization: {
      findUnique: async ({ where }) => {
        calls.push({ model: 'organization', op: 'findUnique', where });
        return where.id === 'org_123' ? { id: 'org_123', slug: 'tenant-org', name: 'Tenant Org' } : null;
      },
      upsert: async (args) => {
        calls.push({ model: 'organization', op: 'upsert', args });
        return { id: 'unexpected', slug: args.where.slug };
      },
    },
    project: {
      upsert: async (args) => {
        calls.push({ model: 'project', op: 'upsert', args });
        return { id: 'prj_123', organizationId: args.where.organizationId_slug.organizationId, slug: args.where.organizationId_slug.slug, name: args.create.name };
      },
    },
    service: { upsert: async (args) => ({ id: 'svc_123', projectId: args.create.projectId, slug: args.create.slug }) },
    resource: { upsert: async (args) => ({ id: 'res_123', projectId: args.create.projectId, name: args.create.name }) },
    auditLog: { create: async (args) => calls.push({ model: 'auditLog', op: 'create', args }) },
  };
  const repo = new PrismaControlPlaneRepository({ $transaction: (callback) => callback(tx) });
  const result = await repo.writeDesiredProject({ organizationId: 'org_123', name: 'Tenant App', services: [{ name: 'web' }], resources: [{ name: 'data', engine: 'postgresql' }] });

  assert.equal(result.organization.id, 'org_123');
  assert.equal(result.project.organizationId, 'org_123');
  assert.equal(calls.some((call) => call.model === 'organization' && call.op === 'upsert'), false);
  const projectUpsert = calls.find((call) => call.model === 'project' && call.op === 'upsert');
  assert.equal(projectUpsert.args.where.organizationId_slug.organizationId, 'org_123');
});
