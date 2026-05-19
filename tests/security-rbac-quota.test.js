import test from 'node:test';
import assert from 'node:assert/strict';
import { guardDatabaseQuery, sanitizeLogRecord, validateServiceSecurity } from '../packages/core/src/security.ts';
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
});

test('RBAC and quota helpers model governance constraints', () => {
  assert.equal(can('owner', 'db:delete'), true);
  assert.equal(can('viewer', 'db:delete'), false);
  assert.deepEqual(visibleEnvironment({ DATABASE_URL: 'secret' }, 'viewer'), {});
  const quota = checkQuota({ plan: 'free', current: { apps: 3 }, requested: { apps: 1 } });
  assert.equal(quota.ok, false);
});
