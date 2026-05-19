#!/usr/bin/env node
import fs from 'node:fs/promises';
import { secureRandomSecret } from '../packages/core/src/secret-vault.ts';

const seed = {
  admin: { email: 'admin@raibitserver.local', password: `admin-${secureRandomSecret(8)}` },
  nonClub: { email: 'student@example.com', password: 'correct-horse-battery' },
  clubMember: { email: 'club@example.com', password: 'correct-horse-battery' },
  organization: { name: 'Local Club', slug: 'local-club', plan: 'club' },
  project: { name: 'local-e2e', slug: 'local-e2e' },
  generatedAt: new Date().toISOString(),
};
await fs.mkdir('.raibitserver-work', { recursive: true });
await fs.writeFile('.raibitserver-work/seed.json', `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, seedFile: '.raibitserver-work/seed.json', users: Object.keys(seed).filter((key) => ['admin','nonClub','clubMember'].includes(key)) }, null, 2));
