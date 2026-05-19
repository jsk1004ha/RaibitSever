import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { commandExists, runCommand } from '../packages/core/src/command-runner.ts';
import { cloneRepository, sourceCheckoutPlan } from '../packages/core/src/source-control.ts';
import { buildExecutionPlan, executeBuildWorkflow } from '../packages/core/src/build-executor.ts';
import { parseImageReference, registryPushPlan } from '../packages/core/src/registry.ts';
import { applyProject } from '../packages/core/src/kubernetes.ts';
import { compileProjectProvisioning, provisionProjectResources } from '../packages/core/src/provisioner.ts';
import { signJwtHs256, verifyJwtHs256 } from '../packages/core/src/auth.ts';
import { createApiHandler } from '../packages/core/src/api.ts';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';

const service = {
  name: 'web',
  projectSlug: 'demo',
  sourceType: 'github',
  repoUrl: 'https://github.com/acme/demo-web',
  branch: 'main',
  dockerfilePath: 'Dockerfile',
  buildContext: '.',
  registry: 'ghcr.io/acme',
};

const project = {
  organization: { slug: 'gdg-hongik', plan: 'club' },
  project: { slug: 'festival-2026' },
  registry: 'ghcr.io/acme',
  services: [{ ...service, name: 'web', type: 'web', port: 3000, image: undefined }],
  resources: [{ name: 'postgres', engine: 'postgresql', databaseName: 'festival', username: 'festival_app', password: 'secret' }],
};

test('source checkout plans real git clone without leaking tokens', () => {
  const plan = sourceCheckoutPlan(service, { token: 'ghp_secret', workspaceDir: '/tmp/work' });
  assert.equal(plan.required, true);
  assert.equal(plan.provider, 'github');
  assert.match(plan.command, /^git clone/);
  assert.doesNotMatch(plan.command, /ghp_secret/);
  assert.throws(() => sourceCheckoutPlan({ ...service, repoUrl: 'https://token@github.com/acme/demo-web' }), /credentialed git URLs/);
});

test('git clone adapter can execute a real local clone when git is available', async (t) => {
  if (!(await commandExists('git'))) t.skip('git executable unavailable');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'raibitserver-git-'));
  const repo = path.join(root, 'repo');
  const dest = path.join(root, 'clone');
  await fs.mkdir(repo, { recursive: true });
  await runCommand({ executable: 'git', args: ['init', '--initial-branch', 'main'], cwd: repo });
  await fs.writeFile(path.join(repo, 'README.md'), 'hello raibitserver\n');
  await runCommand({ executable: 'git', args: ['add', 'README.md'], cwd: repo });
  await runCommand({ executable: 'git', args: ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'], cwd: repo });

  const result = await cloneRepository({ repoUrl: repo, branch: 'main', destination: dest, dryRun: false });
  assert.equal(result.dryRun, false);
  assert.match(await fs.readFile(path.join(dest, 'README.md'), 'utf8'), /^hello raibitserver\r?\n$/);
});

test('BuildKit/Docker and registry execution plans are real commands but dry-run by default', async () => {
  const plan = buildExecutionPlan(service, { Dockerfile: 'FROM scratch' }, { sourceDir: '/workspace/demo', push: true, buildArgs: { SECRET_TOKEN: 'super-secret-value' } });
  assert.match(plan.buildCommand, /docker buildx build/);
  assert.match(plan.buildCommand, /--push/);
  assert.doesNotMatch(plan.buildCommand, /super-secret-value/);
  assert.equal(plan.push, true);

  const result = await executeBuildWorkflow(service, { Dockerfile: 'FROM scratch' }, { sourceDir: '/workspace/demo', push: true, buildArgs: { SECRET_TOKEN: 'super-secret-value' } });
  assert.equal(result.dryRun, true);
  assert.equal(result.steps.some((step) => step.type === 'git-clone'), true);
  const buildStep = result.steps.find((step) => step.type === 'buildkit-build');
  assert.equal(Boolean(buildStep), true);
  assert.equal('stdout' in buildStep, false);

  const push = registryPushPlan('ghcr.io/acme/demo-web:abc123');
  assert.equal(push.registry, 'ghcr.io');
  assert.equal(push.command, 'docker push ghcr.io/acme/demo-web:abc123');
  assert.equal(parseImageReference('localhost:5000/acme/demo-web:abc123').registry, 'localhost:5000');
  assert.equal(parseImageReference('ghcr.io/acme/demo-web@sha256:abc123').digest, 'sha256:abc123');
});

test('kubectl apply and DB provisioning paths create executable dry-run artifacts', async () => {
  const apply = await applyProject(project, { web: { Dockerfile: 'FROM scratch' } });
  assert.equal(apply.apply.dryRun, true);
  assert.match(apply.apply.command, /kubectl apply/);
  const written = JSON.parse(await fs.readFile(apply.apply.manifestFile, 'utf8'));
  assert.equal(written.kind, 'List');
  assert.equal(written.items.some((item) => item.kind === 'Deployment'), true);
  assert.equal(JSON.stringify(written).includes('festival_app:secret'), false);

  const provisioning = compileProjectProvisioning(project);
  assert.equal(provisioning.manifests.some((manifest) => manifest.kind === 'ManagedDatabase'), true);
  const storageProvisioning = compileProjectProvisioning({ ...project, resources: [{ name: 'assets', engine: 'object-storage' }] });
  assert.equal(storageProvisioning.manifests.some((manifest) => manifest.kind === 'ManagedObjectStorage'), true);
  const provision = await provisionProjectResources(project);
  assert.equal(provision.apply.dryRun, true);
  assert.match(provision.apply.command, /kubectl apply/);
});

test('HS256 JWT auth enforces RBAC on protected API routes', async () => {
  const secret = 'unit-test-secret';
  const server = http.createServer(createApiHandler(new RAIBITSERVERControlPlane(), { auth: { mode: 'jwt', jwtSecret: secret } }));
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const unauth = await request(port, 'POST', '/projects', { organizationId: 'org-1', name: 'demo' });
    assert.equal(unauth.statusCode, 401);

    const malformed = await request(port, 'POST', '/projects', { organizationId: 'org-1', name: 'demo' }, 'not.a.jwt');
    assert.equal(malformed.statusCode, 401);

    const viewerToken = signJwtHs256({ sub: 'viewer-1', role: 'viewer' }, secret);
    const denied = await request(port, 'POST', '/projects', { organizationId: 'org-1', name: 'demo' }, viewerToken);
    assert.equal(denied.statusCode, 403);

    const ownerToken = signJwtHs256({ sub: 'owner-1', role: 'owner', global: true }, secret);
    const created = await request(port, 'POST', '/projects', { organizationId: 'org-1', name: 'demo' }, ownerToken);
    assert.equal(created.statusCode, 201);

    const developerToken = signJwtHs256({ sub: 'dev-1', role: 'developer', projectIds: ['project-1'] }, secret);
    const deniedScope = await request(port, 'POST', '/services', { projectId: 'project-2', name: 'api' }, developerToken);
    assert.equal(deniedScope.statusCode, 403);

    const executeRemoved = await request(port, 'POST', '/execute/kubernetes-apply', project, ownerToken);
    assert.equal(executeRemoved.statusCode, 404);
  } finally {
    server.close();
  }
});

test('Prisma persistence contract and CI workflow are present', async () => {
  const schema = await fs.readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  assert.match(schema, /model Organization/);
  assert.match(schema, /model Deployment/);
  assert.match(schema, /provider = "postgresql"/);
  const ci = await fs.readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /pnpm test/);
  assert.match(ci, /go test/);
  assert.match(ci, /pnpm prisma:validate/);

  const token = signJwtHs256({ sub: 'user-1', role: 'owner' }, 'secret');
  assert.equal(verifyJwtHs256(token, 'secret').role, 'owner');
  const cliToken = await runCommand({ executable: process.execPath, args: ['src/cli.js', 'auth-token', '--role', 'owner', '--sub', 'user-1'], env: { RAIBITSERVER_AUTH_JWT_SECRET: 'secret' } });
  const parsed = JSON.parse(cliToken.stdout);
  assert.equal(Boolean(parsed.token), true);
  assert.doesNotMatch(parsed.token, /\*/);
  assert.equal(verifyJwtHs256(parsed.token, 'secret').role, 'owner');
});

function request(port, method, requestPath, body, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ port, path: requestPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
