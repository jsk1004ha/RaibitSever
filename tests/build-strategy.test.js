import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBuildStrategy } from '../packages/core/src/build-strategy.ts';

const nodeFiles = {
  'package.json': JSON.stringify({ dependencies: { next: 'latest' }, scripts: { build: 'next build', start: 'next start' } }),
};

test('Dockerfile wins over framework detection and custom defaults', () => {
  const plan = resolveBuildStrategy({ name: 'api', projectSlug: 'demo', dockerfilePath: 'apps/api/Dockerfile' }, nodeFiles);
  assert.equal(plan.mode, 'dockerfile');
  assert.equal(plan.buildSteps.some((step) => step.type === 'docker-build'), true);
  assert.equal(plan.pipeline.at(-1), 'domain-and-tls');
});

test('custom build command wins when no Dockerfile is configured', () => {
  const plan = resolveBuildStrategy({ name: 'worker', projectSlug: 'demo', buildCommand: 'pnpm build', startCommand: 'node dist/worker.js' }, nodeFiles);
  assert.equal(plan.mode, 'custom');
  assert.equal(plan.runtime.startCommand, 'node dist/worker.js');
});

test('auto detection resolves Next.js into container image plan', () => {
  const plan = resolveBuildStrategy({ name: 'web', projectSlug: 'demo' }, nodeFiles);
  assert.equal(plan.mode, 'framework');
  assert.equal(plan.framework.framework, 'nextjs');
  assert.match(plan.image, /registry\.raibitserver\.local\/demo\/web:latest/);
  assert.equal(plan.controls.previewDeployments, true);
});

test('prebuilt image bypasses build and still has workload pipeline', () => {
  const plan = resolveBuildStrategy({ name: 'cleanup', sourceType: 'image', image: 'ghcr.io/acme/cleanup:1' });
  assert.equal(plan.mode, 'prebuilt-image');
  assert.deepEqual(plan.buildSteps, []);
  assert.equal(plan.pipeline.includes('kubernetes-workload'), true);
});
