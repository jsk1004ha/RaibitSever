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
    '/projects/{projectId}/services/{serviceId}/deployments',
    '/projects/{projectId}/services/{serviceId}/env',
    '/projects/{projectId}/services/{serviceId}/env-file',
    '/integrations/github',
    '/projects/{projectId}/services/{serviceId}/github',
    '/resources/{resourceId}/console/query',
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
  const resourcesController = await fs.readFile(new URL('../apps/api/src/modules/resources/resources.controller.ts', import.meta.url), 'utf8');
  assert.match(servicesController, /@Get\(\)/);
  assert.match(resourcesController, /@Get\(\)/);
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
