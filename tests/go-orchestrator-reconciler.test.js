import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function hasCommand(command) {
  return spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).status === 0;
}

test('Go orchestrator reconciler contract is executable when Go exists or statically present otherwise', async () => {
  if (hasCommand('go')) {
    const result = spawnSync('go', ['test', './...'], { cwd: 'services/orchestrator', encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return;
  }

  const [main, reconciler, kube, store, errorSpec] = await Promise.all([
    fs.readFile('services/orchestrator/cmd/orchestrator/main.go', 'utf8'),
    fs.readFile('services/orchestrator/internal/reconciler/reconciler.go', 'utf8'),
    fs.readFile('services/orchestrator/internal/kube/deployment.go', 'utf8'),
    fs.readFile('services/orchestrator/internal/store/store.go', 'utf8'),
    fs.readFile('services/orchestrator/internal/store/error_spec.go', 'utf8'),
  ]);
  assert.match(main, /NewServiceReconcilerWithStore/);
  assert.match(store, /ListDeploymentsForReconcile/);
  assert.match(reconciler, /orchestrator\.apply\.started/);
  assert.match(reconciler, /rollout.*status/s);
  assert.match(reconciler, /preview\.cleanup\.completed/);
  assert.match(reconciler, /ErrorCodeKubernetesReconcileFailed/);
  assert.match(reconciler, /ErrorSpecForFailure/);
  assert.match(errorSpec, /ErrorCodeImagePullBackoff/);
  assert.match(errorSpec, /ErrorCodeKubernetesReconcileFailed/);
  assert.match(errorSpec, /UserMessage/);
  assert.match(kube, /previewKey := "pr-"/);
  assert.match(kube, /serviceName = previewKey \+ "-" \+ baseServiceName/);
  assert.match(kube, /raibitserver\.io\/preview/);
  assert.match(kube, /NetworkPolicy/);
  assert.match(kube, /readOnlyRootFilesystem/);
});

test('Go orchestrator network policy stays namespace-scoped instead of all-namespace wildcard', async () => {
  const [kube, kubeTest] = await Promise.all([
    fs.readFile('services/orchestrator/internal/kube/deployment.go', 'utf8'),
    fs.readFile('services/orchestrator/internal/kube/deployment_test.go', 'utf8'),
  ]);
  assert.doesNotMatch(kube, /namespaceSelector": map\[string\]any\{\}/, 'NetworkPolicy must not allow every namespace with an empty namespaceSelector');
  assert.match(kube, /kubernetes\.io\/metadata\.name/);
  assert.match(kube, /spec\.Namespace/);
  assert.match(kube, /raibitserver\.io\/ingress-gateway/);
  assert.doesNotMatch(kube, /raibitserver\.io\/ingress": "true"/);
  assert.match(kube, /k8s-app/);
  assert.match(kube, /kube-dns/);
  assert.match(kube, /servicePublicEgressPolicy/);
  assert.match(kube, /privateIPv4EgressExceptions/);
  assert.match(kube, /169\.254\.0\.0\/16/);
  assert.match(kubeTest, /TestNetworkPolicyUsesSharedIngressGatewayLabel/);
  assert.match(kubeTest, /TestPublicEgressIsServiceScopedAndOptIn/);
});
