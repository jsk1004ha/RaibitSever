import test from 'node:test';
import assert from 'node:assert/strict';
import { parseE2EOptions, resolveE2EPlan, hasLiveE2ETools, missingLiveE2EToolGroups } from '../scripts/e2e-mode.mjs';

test('e2e mode defaults to deterministic dry-run without execute side effects', () => {
  const options = parseE2EOptions([], {});
  assert.deepEqual(options, { requestedMode: 'dry', execute: false });

  const plan = resolveE2EPlan({ ...options, tools: { docker: false, kubectl: false, kind: false, k3d: false } });
  assert.equal(plan.mode, 'dry');
  assert.equal(plan.dryRun, true);
  assert.equal(plan.label, 'deterministic-dry-run');
  assert.deepEqual(plan.missingTools, ['docker', 'kubectl', 'kind|k3d']);
});

test('live e2e requires explicit execute plus container and cluster tools', () => {
  assert.equal(hasLiveE2ETools({ docker: true, kubectl: true, kind: true }), true);
  assert.equal(hasLiveE2ETools({ docker: true, kubectl: true, kind: false, k3d: false }), false);
  assert.deepEqual(missingLiveE2EToolGroups({ docker: true, kubectl: false, kind: false, k3d: true }), ['kubectl']);

  assert.throws(() => resolveE2EPlan({ requestedMode: 'live', execute: false, tools: { docker: true, kubectl: true, kind: true } }), /requires --execute/);
  assert.throws(() => resolveE2EPlan({ requestedMode: 'live', execute: true, tools: { docker: true, kubectl: false, kind: true } }), /kubectl/);

  const plan = resolveE2EPlan({ requestedMode: 'live', execute: true, tools: { docker: true, kubectl: true, k3d: true } });
  assert.equal(plan.mode, 'live');
  assert.equal(plan.dryRun, false);
  assert.equal(plan.label, 'live-container-execute');
});

test('auto mode only escalates to live when execute is explicit and tools are ready', () => {
  const tools = { docker: true, kubectl: true, kind: true };
  assert.equal(resolveE2EPlan({ requestedMode: 'auto', execute: false, tools }).mode, 'dry');
  assert.equal(resolveE2EPlan({ requestedMode: 'auto', execute: true, tools }).mode, 'live');
});
