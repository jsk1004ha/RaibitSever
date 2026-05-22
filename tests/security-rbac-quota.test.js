import test from 'node:test';
import assert from 'node:assert/strict';
import { guardDatabaseQuery, sanitizeLogRecord, validateServiceSecurity } from '../packages/core/src/security.ts';
import { ControlPlaneStore } from '../packages/core/src/store.ts';
import { sealSecret } from '../packages/core/src/secret-vault.ts';
import { can, visibleEnvironment } from '../packages/core/src/rbac.ts';
import { checkQuota } from '../packages/core/src/quota.ts';


test('security validator blocks privileged and hostPath workloads', () => {
  const result = validateServiceSecurity({ name: 'bad', privileged: true, volumes: [{ name: 'host', hostPath: '/var/run/docker.sock' }] });
  assert.equal(result.ok, false);
  assert.equal(result.findings.filter((finding) => finding.level === 'block').length, 2);
});

test('query guard requires confirmation for destructive queries', () => {
  assert.equal(guardDatabaseQuery('DROP TABLE users').allowed, false);
  assert.equal(guardDatabaseQuery('DROP TABLE users', { confirmed: true, role: 'db-admin' }).allowed, true);
  assert.equal(guardDatabaseQuery('DELETE FROM users').allowed, false);
  assert.equal(guardDatabaseQuery('SELECT * FROM users', { role: 'viewer' }).allowed, true);
  assert.equal(guardDatabaseQuery('UPDATE users SET admin = true', { role: 'viewer' }).allowed, false);
});

test('secret-looking log values are masked', () => {
  const line = sanitizeLogRecord('DATABASE_URL=postgres://user:pass@host/db TOKEN=abc123 OK=yes');
  assert.match(line, /DATABASE_URL=\*\*\*\*/);
  assert.match(line, /TOKEN=\*\*\*\*/);
  const structured = sanitizeLogRecord({ message: 'Bearer ghp_private', nested: { password: 'top-secret', line: 'api_key=raw-key' } });
  assert.equal(structured.message, 'Bearer ****');
  assert.equal(structured.nested.password, 'to****et');
  assert.equal(structured.nested.line, 'api_key=****');
});

test('RBAC and quota helpers model governance constraints', () => {
  assert.equal(can('owner', 'db:delete'), true);
  assert.equal(can('viewer', 'db:delete'), false);
  assert.deepEqual(visibleEnvironment({ DATABASE_URL: 'secret' }, 'viewer'), {});
  const quota = checkQuota({ plan: 'free', current: { apps: 3 }, requested: { apps: 1 } });
  assert.equal(quota.ok, false);
});


test('quota enforcement accounts for existing project and service usage', () => {
  const store = new ControlPlaneStore();
  const org = store.createOrganization({ name: 'Quota Org', slug: 'quota-org' });
  const user = store.createUser({ email: 'quota@example.com', name: 'Quota User', approvalStatus: 'APPROVED', accountType: 'NON_CLUB' });
  store.addMember({ organizationId: org.id, userId: user.id, role: 'owner' });
  store.setQuota({ userId: user.id, maxProjects: 1, maxServices: 1 });
  const project = store.createProject({ organizationId: org.id, name: 'one', slug: 'one' });
  store.createService({ projectId: project.id, name: 'web' });

  assert.throws(() => store.enforceUserCan({ userId: user.id, action: 'project:create', metric: 'maxProjects', increment: 1 }), /quota exceeded: maxProjects/);
  assert.throws(() => store.enforceUserCan({ userId: user.id, action: 'service:create', metric: 'maxServices', increment: 1 }), /quota exceeded: maxServices/);
});

test('production secret sealing requires a runtime encryption key', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEncryptionKey = process.env.ENCRYPTION_KEY;
  const previousRaibitKey = process.env.RAIBITSERVER_SECRET_ENCRYPTION_KEY;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    delete process.env.RAIBITSERVER_SECRET_ENCRYPTION_KEY;
    assert.throws(() => sealSecret('secret'), /ENCRYPTION_KEY/);
    assert.doesNotThrow(() => sealSecret('secret', { encryptionKey: 'x'.repeat(32) }));
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = previousEncryptionKey;
    if (previousRaibitKey === undefined) delete process.env.RAIBITSERVER_SECRET_ENCRYPTION_KEY; else process.env.RAIBITSERVER_SECRET_ENCRYPTION_KEY = previousRaibitKey;
  }
});
