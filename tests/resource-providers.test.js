import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPostgresProviderPlan, providerConsoleSurface, provisionProjectResources, ControlPlaneStore, browseDbConsole, runDbConsoleQuery } from '../packages/core/src/index.ts';

test('PostgreSQL direct provider plan creates database/user/grant/test/backup contracts without leaking password', () => {
  const plan = buildPostgresProviderPlan({ name: 'Festival PG', databaseName: 'festival', username: 'festival_app', projectSlug: 'festival-2026' }, { password: 'super-secret-db-password', providerAdminUrl: 'postgresql://admin:adminpass@localhost/postgres' });
  assert.equal(plan.databaseName, 'festival');
  assert.equal(plan.username, 'festival_app');
  assert.match(plan.sqlStatements.join('\n'), /CREATE USER/);
  assert.match(plan.sqlStatements.join('\n'), /CREATE DATABASE/);
  assert.match(plan.sqlStatements.join('\n'), /GRANT ALL PRIVILEGES/);
  assert.match(plan.commands.backup, /pg_dump/);
  assert.match(plan.commands.restore, /pg_restore/);
  assert.equal(JSON.stringify(plan).includes('super-secret-db-password'), false);
  assert.equal(plan.secret.key, 'DATABASE_URL');
  assert.equal(plan.secret.providerOwned, true);
  assert.equal(typeof plan.secret.valueMasked, 'string');
  assert.equal(plan.databaseUrl, undefined);
});

test('PostgreSQL provider dry-run attaches provider-owned connection secret and console can resolve it', async () => {
  const store = new ControlPlaneStore();
  const resource = store.createResource({ projectId: 'prj_1', name: 'pg-provider', engine: 'postgresql', provider: 'postgresql-direct', databaseName: 'appdb', username: 'app_user' });
  const provisioned = await store.provisionResourceProvider({ resourceId: resource.id, dryRun: true, actorUserId: 'provider-test', password: 'provider-secret-password' });
  assert.equal(provisioned.resource.status, 'ready');
  assert.equal(Boolean(provisioned.resource.connectionSecretName), true);
  assert.equal(JSON.stringify(store.snapshot()).includes('provider-secret-password'), false);
  const consoleResource = store.resourceForConsole(provisioned.resource);
  assert.match(consoleResource.providerConnection.databaseUrl, /^postgresql:\/\/app_user:/);
});

test('project provisioning can include direct PostgreSQL provider dry-run result', async () => {
  const result = await provisionProjectResources({ project: { slug: 'demo' }, resources: [{ name: 'pg', engine: 'postgresql', provider: 'postgresql-direct', databaseName: 'demo' }] }, { dryRun: true, providerMode: 'direct', password: 'secret-db-password' });
  assert.equal(result.apply.dryRun, true);
  assert.equal(result.providerResults.length, 1);
  assert.equal(result.providerResults[0].engine, 'postgresql');
  assert.equal(JSON.stringify(result).includes('secret-db-password'), false);
});

test('resource console surfaces deterministic adapters for Redis and provider contracts for other engines', async () => {
  const redis = await browseDbConsole({ engine: 'redis', desiredSpec: { keys: ['session:1', 'queue:jobs'] } });
  assert.deepEqual(redis.keys, ['session:1', 'queue:jobs']);
  assert.equal(redis.mode, 'deterministic-adapter');
  const redisQuery = await runDbConsoleQuery({ engine: 'redis' }, 'GET session:1', { role: 'viewer' });
  assert.match(redisQuery.command, /SCAN/);
  for (const [engine, field] of [['mysql', 'tables'], ['mariadb', 'tables'], ['mongodb', 'collections'], ['object-storage', 'buckets'], ['qdrant', 'collections'], ['nats', 'subjects']]) {
    const surface = providerConsoleSurface({ engine, desiredSpec: { [field]: ['sample'] } });
    assert.equal(surface.engine, engine === 'object-storage' ? 'object-storage' : engine);
    assert.ok(surface[field]);
    assert.equal(surface.mode, 'provider-contract');
  }
});
