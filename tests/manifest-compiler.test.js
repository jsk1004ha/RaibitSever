import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileProject } from '../packages/core/src/manifest-compiler.ts';

const example = JSON.parse(fs.readFileSync(new URL('../examples/project.json', import.meta.url), 'utf8'));
const plan = compileProject(example, example.filesByService);

function kinds() {
  return plan.manifests.map((manifest) => manifest.kind);
}

function find(kind, name) {
  return plan.manifests.find((manifest) => manifest.kind === kind && (!name || manifest.metadata.name === name));
}

test('compiler emits namespace, workloads, routes, autoscaling, and isolation', () => {
  assert.equal(plan.metadata.namespace, 'gdg-hongik-festival-2026');
  for (const kind of ['Namespace', 'Deployment', 'CronJob', 'Job', 'Service', 'Ingress', 'HorizontalPodAutoscaler', 'NetworkPolicy', 'PodDisruptionBudget']) {
    assert.equal(kinds().includes(kind), true, kind);
  }
});

test('web service uses secret refs and safe container defaults', () => {
  const deployment = find('Deployment', 'web');
  const container = deployment.spec.template.spec.containers[0];
  assert.equal(container.securityContext.runAsNonRoot, true);
  assert.equal(container.securityContext.allowPrivilegeEscalation, false);
  assert.equal(container.securityContext.readOnlyRootFilesystem, true);
  assert.deepEqual(container.securityContext.capabilities, { drop: ['ALL'] });
  assert.deepEqual(container.securityContext.seccompProfile, { type: 'RuntimeDefault' });
  assert.deepEqual(container.volumeMounts, [{ name: 'tmp', mountPath: '/tmp' }]);
  assert.deepEqual(deployment.spec.template.spec.volumes, [{ name: 'tmp', emptyDir: {} }]);
  assert.equal(deployment.spec.template.spec.automountServiceAccountToken, false);
  assert.equal(container.env.some((env) => env.name === 'DATABASE_URL' && env.valueFrom.secretKeyRef.name === 'web-env'), true);
  assert.equal(deployment.spec.strategy.rollingUpdate.maxUnavailable, 0);
});

test('tenant network policy allows DNS but blocks metadata and private control-plane ranges', () => {
  const policy = find('NetworkPolicy', 'tenant-isolation');
  const dnsRule = policy.spec.egress.find((rule) => rule.ports?.some((port) => port.port === 53));
  assert.ok(dnsRule, 'DNS egress rule exists');
  const externalRule = policy.spec.egress.find((rule) => rule.to?.[0]?.ipBlock?.cidr === '0.0.0.0/0');
  assert.ok(externalRule, 'external egress rule exists');
  assert.deepEqual(externalRule.to[0].ipBlock.except, ['10.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16']);
  assert.equal(policy.raibitserver.blocksMetadataEndpoint, true);
  assert.equal(policy.raibitserver.blocksControlPlane, true);
});

test('private services do not receive public ingress', () => {
  const apiIngress = plan.manifests.find((manifest) => manifest.kind === 'Ingress' && manifest.metadata.name === 'api');
  const apiService = plan.manifests.find((manifest) => manifest.kind === 'Service' && manifest.metadata.name === 'api');
  assert.equal(apiIngress, undefined);
  assert.equal(apiService.kind, 'Service');
});

test('resource plans expose catalog lifecycle and env variable names', () => {
  const postgres = plan.resourcePlans.find((resource) => resource.name === 'festival-postgres');
  assert.equal(postgres.operator, 'CloudNativePG');
  assert.equal(postgres.lifecycle.includes('backup'), true);
  assert.equal(postgres.env.includes('DATABASE_URL'), true);
});
