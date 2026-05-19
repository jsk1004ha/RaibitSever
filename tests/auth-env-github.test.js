import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApiHandler } from '../packages/core/src/api.ts';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';
import { parseDotEnv } from '../packages/core/src/env-file.ts';
import { parseGitHubRepository, verifyGitHubWebhookSignature } from '../packages/core/src/github-integration.ts';
import crypto from 'node:crypto';

test('.env upload parser separates plain values from important secrets', () => {
  const parsed = parseDotEnv('PUBLIC_URL=https://example.com\nDATABASE_URL=postgresql://u:p@db/app\nAPI_KEY=super-secret\n');
  assert.equal(parsed.plainCount, 1);
  assert.equal(parsed.secretCount, 2);
  assert.equal(parsed.entries.find((entry) => entry.key === 'PUBLIC_URL').valueMasked, 'https://example.com');
  assert.notEqual(parsed.entries.find((entry) => entry.key === 'DATABASE_URL').valueMasked, 'postgresql://u:p@db/app');
  assert.throws(() => parseDotEnv('1BAD=value'), /invalid \.env content/);
});

test('signup/login tokens isolate hosted projects, service env upload, and GitHub integration', async () => {
  const secret = 'auth-env-github-secret';
  const controlPlane = new RAIBITSERVERControlPlane();
  const server = http.createServer(createApiHandler(controlPlane, { auth: { mode: 'jwt', jwtSecret: secret } }));
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const aliceSignup = await request(port, 'POST', '/auth/signup', { email: 'alice@example.com', password: 'correct-horse', organizationSlug: 'alice-org' });
    assert.equal(aliceSignup.statusCode, 201);
    assert.equal(Boolean(aliceSignup.body.token), true);
    assert.equal(aliceSignup.body.user.passwordHash, undefined);

    const bobSignup = await request(port, 'POST', '/auth/signup', { email: 'bob@example.com', password: 'correct-horse', organizationSlug: 'bob-org' });
    assert.equal(bobSignup.statusCode, 201);

    const duplicateOrg = await request(port, 'POST', '/auth/signup', { email: 'mallory@example.com', password: 'correct-horse', organizationSlug: 'alice-org' });
    assert.equal(duplicateOrg.statusCode, 409);

    const aliceLogin = await request(port, 'POST', '/auth/login', { email: 'alice@example.com', password: 'correct-horse' });
    assert.equal(aliceLogin.statusCode, 200);

    const aliceProject = await request(port, 'POST', '/projects', { name: 'Alice API', slug: 'alice-api' }, aliceLogin.body.token);
    assert.equal(aliceProject.statusCode, 201);
    assert.equal(aliceProject.body.organizationId, aliceSignup.body.organization.id);

    const aliceService = await request(port, 'POST', '/services', { projectId: aliceProject.body.id, name: 'web', type: 'web', sourceType: 'github' }, aliceLogin.body.token);
    assert.equal(aliceService.statusCode, 201);

    const bobDenied = await request(port, 'POST', '/services', { projectId: aliceProject.body.id, name: 'steal' }, bobSignup.body.token);
    assert.equal(bobDenied.statusCode, 403);

    const bobProjects = await request(port, 'GET', '/projects', null, bobSignup.body.token);
    assert.equal(bobProjects.statusCode, 200);
    assert.equal(bobProjects.body.projects.some((project) => project.id === aliceProject.body.id), false);

    const envUpload = await request(port, 'POST', `/projects/${aliceProject.body.id}/services/${aliceService.body.id}/env-file`, {
      filename: '.env.production',
      content: 'PUBLIC_URL=https://alice.example\nDATABASE_URL=postgresql://alice:secret@db/app\nGITHUB_TOKEN=ghp_secret\n',
    }, aliceLogin.body.token);
    assert.equal(envUpload.statusCode, 200);
    assert.equal(envUpload.body.secretCount, 2);
    assert.equal(JSON.stringify(envUpload.body).includes('ghp_secret'), false);

    const envList = await request(port, 'GET', `/projects/${aliceProject.body.id}/services/${aliceService.body.id}/env`, null, aliceLogin.body.token);
    assert.equal(envList.statusCode, 200);
    assert.equal(envList.body.entries.some((entry) => entry.key === 'PUBLIC_URL' && entry.value === 'https://alice.example'), true);
    assert.equal(JSON.stringify(envList.body).includes('postgresql://alice:secret'), false);

    const github = await request(port, 'POST', '/integrations/github', { organizationId: aliceSignup.body.organization.id, accountLogin: 'alice', token: 'ghp_private_token' }, aliceLogin.body.token);
    assert.equal(github.statusCode, 201);
    assert.equal(github.body.provider, 'github');
    assert.equal(JSON.stringify(github.body).includes('ghp_private_token'), false);

    const attached = await request(port, 'POST', `/projects/${aliceProject.body.id}/services/${aliceService.body.id}/github`, { integrationId: github.body.id, repoUrl: 'https://github.com/alice/web', branch: 'main' }, aliceLogin.body.token);
    assert.equal(attached.statusCode, 200);
    assert.equal(attached.body.github.repository, 'alice/web');
    assert.equal(controlPlane.store.services.get(aliceService.body.id).repoUrl, 'https://github.com/alice/web.git');
  } finally {
    server.close();
  }
});

test('GitHub helpers normalize repositories and verify webhook signatures', () => {
  assert.deepEqual(parseGitHubRepository('alice/web'), { owner: 'alice', repo: 'web', fullName: 'alice/web', repoUrl: 'https://github.com/alice/web.git' });
  const body = JSON.stringify({ action: 'push' });
  const signature = `sha256=${crypto.createHmac('sha256', 'webhook-secret').update(body).digest('hex')}`;
  assert.equal(verifyGitHubWebhookSignature(body, signature, 'webhook-secret'), true);
  assert.equal(verifyGitHubWebhookSignature(body, signature, 'wrong-secret'), false);
});

test('CLI parses env files and GitHub repo references without leaking secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'raibitserver-env-'));
  const file = path.join(dir, '.env');
  await fs.writeFile(file, 'API_KEY=super-secret\nPUBLIC_URL=https://example.com\n');
  const env = await runCli(['env-parse', file]);
  assert.equal(env.secretCount, 1);
  assert.equal(JSON.stringify(env).includes('super-secret'), false);
  const repo = await runCli(['github-repo', 'alice/web']);
  assert.equal(repo.repoUrl, 'https://github.com/alice/web.git');
});

function request(port, method, requestPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = process.execPath;
    import('node:child_process').then(({ spawn }) => {
      const proc = spawn(child, ['src/cli.js', ...args], { cwd: new URL('..', import.meta.url).pathname });
      const stdout = [];
      const stderr = [];
      proc.stdout.on('data', (chunk) => stdout.push(chunk));
      proc.stderr.on('data', (chunk) => stderr.push(chunk));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code) reject(new Error(Buffer.concat(stderr).toString('utf8') || `cli exited ${code}`));
        else resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')));
      });
    }, reject);
  });
}
