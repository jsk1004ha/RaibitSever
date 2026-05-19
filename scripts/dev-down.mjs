#!/usr/bin/env node
import fs from 'node:fs/promises';
await fs.rm('.raibitserver-work/local-stack.json', { force: true });
console.log(JSON.stringify({ ok: true, stopped: 'raibitserver-local-e2e', preserved: ['.raibitserver-work/seed.json', '.raibitserver-work/e2e-report.json'] }, null, 2));
