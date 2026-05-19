import test from 'node:test';
import assert from 'node:assert/strict';
import { listCatalog } from '../packages/core/src/catalog.ts';
import { connectionEnvForResource, injectResourceEnv } from '../packages/core/src/env-injection.ts';
import { maskSecrets } from '../packages/core/src/secrets.ts';

test('catalog includes relational, cache, storage, vector, and queue resources', () => {
  const keys = listCatalog().map((entry) => entry.key);
  for (const key of ['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'object-storage', 'vector-db', 'message-queue']) {
    assert.equal(keys.includes(key), true, key);
  }
});

test('postgres resource generates standard connection variables', () => {
  const env = connectionEnvForResource({ name: 'todo-postgres', engine: 'postgresql', databaseName: 'todo', username: 'todo_app', password: 'pw' }, 'todo');
  assert.match(env.DATABASE_URL, /^postgresql:\/\/todo_app:pw@todo-postgres\.todo\.svc\.cluster\.local:5432\/todo$/);
  assert.equal(env.PGDATABASE, 'todo');
});

test('service env injection attaches selected resources only', () => {
  const env = injectResourceEnv(
    { name: 'api', attachedResources: ['redis'], environment: { NODE_ENV: 'production' } },
    [
      { name: 'postgres', engine: 'postgresql' },
      { name: 'redis', engine: 'redis', password: 'secret' },
    ],
    'demo',
  );
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.POSTGRES_URL, undefined);
  assert.match(env.REDIS_URL, /^redis:\/\/:secret@redis\.demo\.svc\.cluster\.local:6379$/);
});

test('secret masking hides secret-looking fields', () => {
  const masked = maskSecrets({ DATABASE_URL: 'postgres://user:password@host/db', visible: 'ok' });
  assert.notEqual(masked.DATABASE_URL, 'postgres://user:password@host/db');
  assert.equal(masked.visible, 'ok');
});
