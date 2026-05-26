#!/usr/bin/env node
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compileProject } from '../packages/core/src/manifest-compiler.ts';

const args = new Set(process.argv.slice(2));
const baselineFile = '.omx/goals/performance/planner-core/baseline.json';
const threshold = 0.85;

const fixture = buildFixture({
  serviceCount: 72,
  resourceCount: 18,
});

const result = benchmark(() => compileProject(fixture), {
  warmup: 4,
  samples: 9,
  iterationsPerSample: 3,
});

if (args.has('--record-baseline')) {
  fs.mkdirSync('.omx/goals/performance/planner-core', { recursive: true });
  fs.writeFileSync(baselineFile, `${JSON.stringify({ ...result, recordedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, baseline: result, baselineFile }, null, 2));
  process.exit(0);
}

if (args.has('--assert')) {
  if (!fs.existsSync(baselineFile)) {
    console.error(`missing baseline: run node scripts/perf-planner.mjs --record-baseline first`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const targetMedianMs = baseline.medianMs * threshold;
  const ok = result.medianMs <= targetMedianMs;
  const payload = {
    ok,
    current: result,
    baseline,
    targetMedianMs,
    improvement: 1 - (result.medianMs / baseline.medianMs),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(ok ? 0 : 1);
}

console.log(JSON.stringify({ ok: true, result }, null, 2));

function benchmark(fn, options) {
  for (let i = 0; i < options.warmup; i += 1) fn();
  const samples = [];
  let manifestCount = 0;
  for (let sample = 0; sample < options.samples; sample += 1) {
    const start = performance.now();
    for (let iteration = 0; iteration < options.iterationsPerSample; iteration += 1) {
      const output = fn();
      manifestCount = output.manifests.length;
    }
    samples.push((performance.now() - start) / options.iterationsPerSample);
  }
  samples.sort((a, b) => a - b);
  return {
    medianMs: round(samples[Math.floor(samples.length / 2)]),
    minMs: round(samples[0]),
    maxMs: round(samples.at(-1)),
    samplesMs: samples.map(round),
    manifestCount,
    serviceCount: fixture.services.length,
    resourceCount: fixture.resources.length,
  };
}

function buildFixture({ serviceCount, resourceCount }) {
  const resources = Array.from({ length: resourceCount }, (_, index) => {
    const engine = ['postgresql', 'mysql', 'redis'][index % 3];
    return {
      name: `${engine}-${index}`,
      engine,
      plan: 'shared-small',
      storageMb: engine === 'redis' ? 128 : 512,
    };
  });
  const services = Array.from({ length: serviceCount }, (_, index) => ({
    name: `svc-${index}`,
    type: index % 9 === 0 ? 'worker' : 'web',
    sourceType: 'image',
    image: `registry.local/demo/svc-${index}:latest`,
    port: 3000 + (index % 10),
    resources: {
      requests: { cpu: '100m', memory: '128Mi' },
      limits: { cpu: '500m', memory: '512Mi' },
    },
  }));
  return {
    organization: { slug: 'perf-org', plan: 'club' },
    project: { name: 'planner-perf', slug: 'planner-perf' },
    services,
    resources,
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
