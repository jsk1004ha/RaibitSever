import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importCompose, parseComposeYaml } from '../packages/core/src/compose-importer.ts';

const compose = fs.readFileSync(new URL('../examples/docker-compose.yml', import.meta.url), 'utf8');

test('minimal compose parser reads build, ports, image, and environment', () => {
  const parsed = parseComposeYaml(compose);
  assert.equal(parsed.services.web.build, './web');
  assert.deepEqual(parsed.services.web.ports, ['3000:3000']);
  assert.equal(parsed.services.api.build.context, './api');
  assert.equal(parsed.services.worker.environment.QUEUE_NAME, 'reservations');
});

test('compose import turns stateful services into managed resources', () => {
  const plan = importCompose(compose, { projectName: 'festival' });
  assert.deepEqual(plan.resources.map((r) => r.engine).sort(), ['object-storage', 'postgresql', 'redis']);
  assert.equal(plan.services.find((s) => s.name === 'web').buildMode, 'dockerfile');
  assert.equal(plan.services.find((s) => s.name === 'api').port, 8080);
  assert.deepEqual(plan.services.find((s) => s.name === 'web').attachedResources.sort(), ['assets', 'postgres', 'redis']);
});
