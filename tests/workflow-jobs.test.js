import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneStore, WORKFLOW_STATUSES, createWorkflowJobRecord, processNextWorkflowJob } from '../packages/core/src/index.ts';

test('workflow processor claims one due job and prevents duplicate active claims', () => {
  const store = new ControlPlaneStore();
  const job = store.enqueueWorkflowJob({
    type: 'build-and-deploy',
    targetType: 'deployment',
    targetId: 'dep-1',
    payload: { serviceId: 'svc-1', token: 'secret-token' },
    runAfter: '2026-01-01T00:00:00.000Z',
  });

  const claimed = store.claimNextWorkflowJob({ workerId: 'worker-a', now: '2026-01-01T00:00:01.000Z' });
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, WORKFLOW_STATUSES.RUNNING);
  assert.equal(claimed.lockedBy, 'worker-a');
  assert.equal(claimed.attempts, 1);
  assert.equal(store.claimNextWorkflowJob({ workerId: 'worker-b', now: '2026-01-01T00:00:02.000Z' }), null);
  assert.equal(JSON.stringify(claimed).includes('secret-token'), false);
});

test('workflow processor retries failures with sanitized errors before final failure', () => {
  const store = new ControlPlaneStore();
  store.enqueueWorkflowJob({ targetId: 'dep-2', maxAttempts: 2, runAfter: '2026-01-01T00:00:00.000Z' });

  const first = store.claimNextWorkflowJob({ workerId: 'worker-a', now: '2026-01-01T00:00:01.000Z' });
  const retry = store.failWorkflowJob(first.id, 'DATABASE_URL=postgres://user:pass@db/app failed', { workerId: 'worker-a', now: '2026-01-01T00:00:01.000Z', retryDelayMs: 0 });
  assert.equal(retry.status, WORKFLOW_STATUSES.QUEUED);
  assert.match(retry.payload.lastError, /DATABASE_URL=\*\*\*\*/);
  assert.equal(retry.payload.lastError.includes('user:pass'), false);

  const second = store.claimNextWorkflowJob({ workerId: 'worker-a', now: '2026-01-01T00:00:02.000Z' });
  const failed = store.failWorkflowJob(second.id, 'TOKEN=abc123 failed', { workerId: 'worker-a', now: '2026-01-01T00:00:02.000Z' });
  assert.equal(failed.status, WORKFLOW_STATUSES.FAILED);
  assert.match(failed.payload.lastError, /TOKEN=\*\*\*\*/);
});

test('workflow processor completes jobs with masked result metadata', async () => {
  const store = new ControlPlaneStore();
  store.enqueueWorkflowJob({ targetId: 'dep-3', runAfter: '2026-01-01T00:00:00.000Z' });
  const result = await processNextWorkflowJob(store, {
    'build-and-deploy': async () => ({ image: 'demo:latest', registryToken: 'raw-token' }),
  }, { workerId: 'worker-a', now: '2026-01-01T00:00:01.000Z' });

  assert.equal(result.ok, true);
  assert.equal(result.job.status, WORKFLOW_STATUSES.SUCCEEDED);
  assert.equal(result.job.lockedBy, null);
  assert.equal(JSON.stringify(result).includes('raw-token'), false);
  assert.equal(store.snapshot().workflowJobs[0].payload.lastResult.registryToken, 'ra****en');
});

test('workflow job records mask secret payloads at creation', () => {
  const job = createWorkflowJobRecord({ targetId: 'dep-4', payload: { nested: { apiKey: 'super-secret-api-key' }, plain: 'ok' } });
  assert.equal(job.payload.plain, 'ok');
  assert.equal(job.payload.nested.apiKey, 'su****ey');
});

test('quota checks count existing usage before allowing new side effects', () => {
  const store = new ControlPlaneStore();
  const user = store.createUser({ name: 'User', email: 'user@example.com', approvalStatus: 'APPROVED' });
  const org = store.createOrganization({ name: 'Quota Org', slug: 'quota-org' });
  store.addMember({ organizationId: org.id, userId: user.id, role: 'owner' });
  store.setQuota({ userId: user.id, maxProjects: 1 });
  store.createProject({ organizationId: org.id, name: 'First', slug: 'first' });

  assert.throws(() => store.enforceUserCan({ userId: user.id, action: 'project:create', metric: 'maxProjects', increment: 1 }), /quota exceeded: maxProjects \(2\/1\)/);
  assert.equal(store.snapshot().projects.length, 1);
});
