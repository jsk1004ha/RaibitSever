#!/usr/bin/env node
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApiHandler } from '../packages/core/src/api.ts';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';
import { applyProject, commandExists, executeBuildWorkflow, provisionProjectResources } from '../packages/core/src/execution.ts';
import { parseE2EOptions, resolveE2EPlan } from './e2e-mode.mjs';
import { signJwtHs256 } from '../packages/core/src/auth.ts';
import { serviceHostname } from '../packages/core/src/domain-router.ts';

const e2eOptions = parseE2EOptions(process.argv.slice(2), process.env);
const jwtSecret = process.env.RAIBITSERVER_AUTH_JWT_SECRET || 'local-e2e-secret-at-least-32-chars';
const baseDomain = process.env.BASE_DOMAIN || '127.0.0.1.sslip.io';
const controlPlane = new RAIBITSERVERControlPlane();
const api = http.createServer(createApiHandler(controlPlane, { auth: { mode: 'jwt', jwtSecret, issuer: 'raibitserver' } }));
api.listen(0, '127.0.0.1');
await once(api, 'listening');
const apiPort = api.address().port;

const app = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'express-api', host: req.headers.host }));
});
app.listen(0, '127.0.0.1');
await once(app, 'listening');
const appPort = app.address().port;

const evidence = { apiPort, appPort, checks: [], tools: {}, mode: 'deterministic-dry-run' };
try {
  for (const tool of ['docker', 'kubectl', 'kind', 'k3d', 'git', 'go']) evidence.tools[tool] = await commandExists(tool);
  const e2ePlan = resolveE2EPlan({ ...e2eOptions, tools: evidence.tools });
  evidence.mode = e2ePlan.label;
  evidence.requestedMode = e2ePlan.requestedMode;
  evidence.dryRun = e2ePlan.dryRun;
  evidence.liveToolsReady = e2ePlan.liveToolsReady;
  evidence.missingLiveTools = e2ePlan.missingTools;

  const pending = await request('POST', '/auth/signup', { email: 'student@example.com', password: 'correct-horse-battery', organizationSlug: 'student-org' });
  assertStatus(pending, 201, 'non-club signup');
  const blocked = await request('POST', '/projects', { name: 'blocked', slug: 'blocked' }, pending.body.token);
  assertStatus(blocked, 403, 'non-club pending blocked');

  const adminToken = signJwtHs256({ sub: 'admin-local', role: 'owner', userRole: 'ADMIN', global: true }, jwtSecret);
  const approved = await request('POST', `/admin/users/${pending.body.user.id}/approve`, { accountType: 'NON_CLUB' }, adminToken);
  assertStatus(approved, 200, 'admin approve non-club');
  const quota = await request('PATCH', `/admin/users/${pending.body.user.id}/quota`, { maxProjects: 3, maxServices: 4, maxDeploymentsPerDay: 10, maxDbStorageMb: 2048 }, adminToken);
  assertStatus(quota, 200, 'admin quota set');

  const project = await request('POST', '/projects', { name: 'local-e2e', slug: 'local-e2e' }, pending.body.token);
  assertStatus(project, 201, 'approved non-club project create');
  const service = await request('POST', `/projects/${project.body.id}/services`, { name: 'express-api', type: 'web', sourceType: 'local', buildMode: 'generated', port: appPort, attachedResources: ['local-sqlite'] }, pending.body.token);
  assertStatus(service, 201, 'service create');
  const sqlitePath = path.resolve('.raibitserver-work/local-e2e.sqlite');
  const resource = await request('POST', `/projects/${project.body.id}/resources`, { name: 'local-sqlite', type: 'database', engine: 'sqlite', provider: 'local-pvc', sqlitePath, desiredSpec: { sqlitePath } }, pending.body.token);
  assertStatus(resource, 201, 'sqlite resource create');
  const envUpload = await request('POST', `/projects/${project.body.id}/services/${service.body.id}/env-file`, { filename: '.env', content: 'PUBLIC_URL=http://example.local\n' }, pending.body.token);
  assertStatus(envUpload, 200, 'env file upload');

  const consoleCreate = await request('POST', `/resources/${resource.body.id}/console/query`, { query: 'CREATE TABLE IF NOT EXISTS health (id INTEGER PRIMARY KEY, status TEXT)', confirmed: true }, pending.body.token);
  assertStatus(consoleCreate, 200, 'sqlite console create');
  await request('POST', `/resources/${resource.body.id}/console/query`, { query: "INSERT INTO health(status) VALUES ('ok')", confirmed: true }, pending.body.token);
  const consoleRows = await request('POST', `/resources/${resource.body.id}/console/query`, { query: 'SELECT status FROM health', limit: 10 }, pending.body.token);
  assertStatus(consoleRows, 200, 'sqlite console select');
  if (!consoleRows.body.rows.some((row) => row.status === 'ok')) throw new Error('sqlite console did not return inserted row');

  const urlHost = serviceHostname({ serviceName: 'express-api', projectSlug: 'local-e2e', organizationSlug: 'student-org', baseDomain });
  const localHttp = await getLocalApp(urlHost, appPort);
  if (localHttp.statusCode !== 200) throw new Error(`local app http check failed: ${localHttp.statusCode}`);

  const deployment = await request('POST', `/services/${service.body.id}/deployments`, { deploymentType: 'production', branch: 'main', commitSha: 'local-e2e' }, pending.body.token);
  assertStatus(deployment, 202, 'deployment enqueue');
  controlPlane.store.appendBuildLog({ deploymentId: deployment.body.id, step: 'clone', line: 'local source ready' });
  controlPlane.store.appendBuildLog({ deploymentId: deployment.body.id, step: 'build', line: 'generated Dockerfile build plan verified' });
  controlPlane.store.appendRuntimeLog({ serviceId: service.body.id, deploymentId: deployment.body.id, podName: 'local-e2e-pod', containerName: 'app', line: 'GET / 200' });
  controlPlane.store.appendDeploymentEvent({ deploymentId: deployment.body.id, type: 'rollout.ready', message: 'deterministic local rollout ready', metadata: { urlHost } });
  const logs = await request('GET', `/deployments/${deployment.body.id}/logs`, null, pending.body.token);
  assertStatus(logs, 200, 'build logs 조회');
  const runtimeLogs = await request('GET', `/services/${service.body.id}/logs`, null, pending.body.token);
  assertStatus(runtimeLogs, 200, 'runtime logs 조회');

  const preview = await request('POST', `/services/${service.body.id}/deployments`, { deploymentType: 'preview', triggerType: 'pull_request', pullRequestNumber: 42, branch: 'feature/local-e2e', previewUrl: `http://pr-42--${urlHost.replace(/^express-api--/, '')}` }, pending.body.token);
  assertStatus(preview, 202, 'PR preview deployment enqueue');

  const club = await request('POST', '/auth/signup', { email: 'club@example.com', password: 'correct-horse-battery', organizationSlug: 'club-org' });
  assertStatus(club, 201, 'club signup');
  const approvedClub = await request('POST', `/admin/users/${club.body.user.id}/approve`, { accountType: 'CLUB_MEMBER' }, adminToken);
  assertStatus(approvedClub, 200, 'admin approve club');
  const clubLogin = await request('POST', '/auth/login', { email: 'club@example.com', password: 'correct-horse-battery' });
  assertStatus(clubLogin, 200, 'club login after approval');
  const clubProject = await request('POST', '/projects', { name: 'club-paas', slug: 'club-paas' }, clubLogin.body.token);
  assertStatus(clubProject, 201, 'club project create');
  for (let i = 0; i < 6; i += 1) {
    const row = await request('POST', `/projects/${clubProject.body.id}/services`, { name: `svc-${i}`, type: 'worker', sourceType: 'image', image: `localhost:5000/club/svc-${i}:latest` }, clubLogin.body.token);
    assertStatus(row, 201, `club unlimited service ${i}`);
  }

  const sampleProject = JSON.parse(await fs.readFile('examples/project.json', 'utf8'));
  const localBuildService = {
    name: 'express-api',
    type: 'web',
    sourceType: 'local',
    buildMode: 'dockerfile',
    dockerfilePath: 'Dockerfile',
    buildContext: '.',
    projectSlug: 'local-e2e',
    registry: process.env.REGISTRY_URL || 'localhost:5000',
    localPath: 'examples/express-api',
    port: 3000,
  };
  const build = await executeBuildWorkflow(localBuildService, { Dockerfile: 'FROM node:24-alpine' }, { sourceDir: 'examples/express-api', dryRun: e2ePlan.dryRun, push: e2ePlan.mode === 'live' });
  const apply = await applyProject(sampleProject, sampleProject.filesByService || {}, { dryRun: e2ePlan.dryRun, outputDir: '.raibitserver-work', keepManifest: e2ePlan.dryRun });
  const provision = await provisionProjectResources({ ...sampleProject, resources: [...sampleProject.resources, { name: 'local-sqlite', engine: 'sqlite', type: 'database' }] }, { dryRun: e2ePlan.dryRun, outputDir: '.raibitserver-work', keepManifest: e2ePlan.dryRun });

  evidence.url = `http://${urlHost}:${appPort}`;
  evidence.deploymentStatus = 'READY';
  evidence.deploymentId = deployment.body.id;
  evidence.previewDeploymentId = preview.body.id;
  evidence.buildSteps = build.steps.map((step) => step.type);
  evidence.buildDryRun = build.dryRun;
  evidence.kubernetesManifestCount = apply.compiled.manifests.length;
  evidence.kubernetesDryRun = apply.apply.dryRun;
  evidence.provisionManifestCount = provision.provisioning.manifests.length;
  evidence.provisionDryRun = provision.apply.dryRun;
  evidence.sqlitePath = sqlitePath;
  evidence.checks.push('non-club pending blocked', 'admin approval/quota works', 'club member bypasses user-facing quota', 'build/runtime logs readable', 'SQLite DB console query works', 'preview deployment fixture created', e2ePlan.dryRun ? 'build/Kubernetes/provisioning dry-run artifacts generated' : 'build/Kubernetes/provisioning live execution completed');
  await fs.mkdir('.raibitserver-work', { recursive: true });
  await fs.writeFile('.raibitserver-work/e2e-report.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
} finally {
  api.close();
  app.close();
}

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {};
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port: apiPort, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, body: text ? JSON.parse(text) : {} });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getLocalApp(host, port) {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: '/', method: 'GET', timeout: 2500 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ statusCode: res.statusCode, dns: true }));
    });
    req.on('error', () => {
      const fallback = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', headers: { host } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ statusCode: res.statusCode, dns: false }));
      });
      fallback.on('error', () => resolve({ statusCode: 0, dns: false }));
      fallback.end();
    });
    req.end();
  });
}

function assertStatus(response, expected, label) {
  evidence.checks.push(`${label}: ${response.statusCode}`);
  if (response.statusCode !== expected) {
    throw new Error(`${label} expected HTTP ${expected}, got ${response.statusCode}: ${JSON.stringify(response.body)}`);
  }
}
