#!/usr/bin/env node
import fs from 'node:fs/promises';
import { commandExists } from '../packages/core/src/execution.ts';

const tools = Object.fromEntries(await Promise.all(['docker', 'kubectl', 'kind', 'k3d', 'git', 'go'].map(async (tool) => [tool, await commandExists(tool)])));
const mode = tools.docker && tools.kubectl && (tools.kind || tools.k3d) ? 'container-stack-ready' : 'deterministic-local-fallback';
const state = {
  service: 'raibitserver-local-e2e',
  mode,
  tools,
  baseDomain: process.env.BASE_DOMAIN || '127.0.0.1.sslip.io',
  registry: process.env.REGISTRY_URL || 'localhost:5000',
  startedAt: new Date().toISOString(),
  note: mode === 'container-stack-ready'
    ? 'Docker/Kubernetes tools are present; Go reconcilers can be run against kind/k3d with --execute workflows.'
    : 'Docker/Kubernetes tools are missing, so dev:e2e will run deterministic local control-plane/build/provision/orchestration smoke without external side effects.',
};
await fs.mkdir('.raibitserver-work', { recursive: true });
await fs.writeFile('.raibitserver-work/local-stack.json', `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));
