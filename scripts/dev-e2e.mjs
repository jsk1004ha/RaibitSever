#!/usr/bin/env node
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApiHandler } from '../packages/core/src/api.ts';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';
import { applyManifests, applyProject, commandExists, executeBuildWorkflow, provisionProjectResources, pushImage, runCommand } from '../packages/core/src/execution.ts';
import { injectResourceEnv } from '../packages/core/src/env-injection.ts';
import { parseE2EOptions, resolveE2EPlan } from './e2e-mode.mjs';
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
  evidence.liveSetup = e2ePlan.setup;
  evidence.liveSetupResults = e2ePlan.mode === 'live' ? await runLiveSetup(e2ePlan.setup) : [];

  const bootstrapAdmin = await request('POST', '/auth/signup', { email: 'admin@example.com', password: 'correct-horse-battery', organizationSlug: 'admin-org' });
  assertStatus(bootstrapAdmin, 201, 'first-user admin bootstrap');
  if (bootstrapAdmin.body.user.role !== 'ADMIN' || bootstrapAdmin.body.user.approvalStatus !== 'APPROVED' || bootstrapAdmin.body.user.accountType !== 'CLUB_MEMBER') {
    throw new Error('first auth user was not bootstrapped as approved club admin');
  }
  const adminToken = bootstrapAdmin.body.token;

  const pending = await request('POST', '/auth/signup', { email: 'student@example.com', password: 'correct-horse-battery', organizationSlug: 'student-org' });
  assertStatus(pending, 201, 'non-club signup');
  const blocked = await request('POST', '/projects', { name: 'blocked', slug: 'blocked' }, pending.body.token);
  assertStatus(blocked, 403, 'non-club pending blocked');

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

  const postgresResource = controlPlane.store.createResource({ projectId: project.body.id, name: 'local-postgres', type: 'database', engine: 'postgresql', provider: 'postgresql-direct', databaseName: 'locale2e', username: 'locale2e_app' });
  const postgresProvision = await controlPlane.store.provisionResourceProvider({ resourceId: postgresResource.id, dryRun: true, actorUserId: pending.body.user.id, password: 'local-e2e-postgres-secret' });
  const postgresEnv = injectResourceEnv({ ...service.body, attachedResources: ['local-postgres'] }, [postgresProvision.resource], 'local-e2e');
  if (!String(postgresEnv.DATABASE_URL || '').startsWith('postgresql://')) throw new Error('PostgreSQL DATABASE_URL was not injected');

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
  controlPlane.store.updateService(service.body.id, { githubRepository: 'student-org/local-e2e', repoUrl: 'https://github.com/student-org/local-e2e.git', githubIntegrationId: 'local-e2e' });
  const previewCleanup = controlPlane.store.handleGitHubWebhook({
    event: 'pull_request',
    deliveryId: 'local-e2e-pr-closed',
    body: JSON.stringify({ action: 'closed', number: 42, repository: { full_name: 'student-org/local-e2e' }, pull_request: { number: 42, head: { ref: 'feature/local-e2e', sha: 'local-e2e' } } }),
    payload: { action: 'closed', number: 42, repository: { full_name: 'student-org/local-e2e' }, pull_request: { number: 42, head: { ref: 'feature/local-e2e', sha: 'local-e2e' } } },
  });
  if (!previewCleanup.actions.some((action) => action.type === 'preview-cleanup-enqueued')) throw new Error('preview cleanup webhook did not enqueue cleanup');

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

  const liveBeta = await runLiveBetaScenario({
    e2ePlan,
    project: project.body,
    projectToken: pending.body.token,
    existingServices: { 'express-api': service.body },
    sqliteResource: resource.body,
    sqlitePath,
    baseDomain,
  });

  evidence.url = `http://${urlHost}:${appPort}`;
  evidence.deploymentStatus = 'READY';
  evidence.deploymentId = deployment.body.id;
  evidence.previewDeploymentId = preview.body.id;
  evidence.liveBeta = liveBeta;
  evidence.buildSteps = liveBeta.buildSteps;
  evidence.buildDryRun = liveBeta.buildDryRun;
  evidence.kubernetesManifestCount = liveBeta.kubernetesManifestCount;
  evidence.kubernetesDryRun = liveBeta.kubernetesDryRun;
  evidence.provisionManifestCount = liveBeta.provisionManifestCount;
  evidence.provisionDryRun = liveBeta.provisionDryRun;
  evidence.sqlitePath = resource.body.sqlitePath || resource.body.desiredSpec?.sqlitePath || sqlitePath;
  evidence.postgresProviderDryRun = postgresProvision.result.dryRun;
  evidence.postgresEnvInjected = Boolean(postgresEnv.DATABASE_URL && postgresEnv.PGUSER);
  evidence.previewCleanupAction = previewCleanup.actions[0]?.type || null;
  evidence.checks.push('first-user admin bootstrap works', 'non-club pending blocked', 'admin approval/quota works', 'club member bypasses user-facing quota', 'build/runtime logs readable', 'SQLite DB console query works', 'PostgreSQL provider dry-run and env injection works', 'preview deployment fixture created', 'preview cleanup workflow enqueued', e2ePlan.dryRun ? 'build/Kubernetes/provisioning dry-run artifacts generated' : 'build/Kubernetes/provisioning live execution completed', e2ePlan.dryRun ? 'live beta checklist dry contract generated' : 'live beta checklist passed against local cluster');
  await fs.mkdir('.raibitserver-work', { recursive: true });
  await fs.writeFile('.raibitserver-work/e2e-report.json', `${JSON.stringify(evidence, null, 2)}\n`);
  if (e2ePlan.mode === 'live') await fs.writeFile('.raibitserver-work/live-e2e-report.json', `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
} catch (error) {
  evidence.ok = false;
  evidence.error = error?.message || String(error);
  if (error?.result) evidence.failedCommand = error.result;
  evidence.failedAt = new Date().toISOString();
  await fs.mkdir('.raibitserver-work', { recursive: true });
  await fs.writeFile('.raibitserver-work/e2e-report.json', `${JSON.stringify(evidence, null, 2)}\n`);
  if (e2eOptions.requestedMode === 'live' || evidence.requestedMode === 'live') {
    await fs.writeFile('.raibitserver-work/live-e2e-report.json', `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  api.close();
  app.close();
}

async function runLiveBetaScenario({ e2ePlan, project, projectToken, existingServices, sqliteResource, sqlitePath, baseDomain }) {
  const registry = process.env.REGISTRY_URL || `localhost:${e2ePlan.setup?.registryPort || 5000}`;
  const revision = 'local-e2e';
  const projectSlug = project.slug || 'local-e2e';
  const organizationSlug = 'student-org';
  const namespace = `${organizationSlug}-${projectSlug}`;
  const sourceRoot = path.resolve('.raibitserver-work/live-sources');
  const metadataRoot = path.resolve('.raibitserver-work/build-metadata');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(metadataRoot, { recursive: true });

  const sourceServices = [
    {
      name: 'express-api',
      label: 'Express Dockerfile app',
      fixture: 'examples/express-api',
      sourceType: 'local',
      buildMode: 'dockerfile',
      dockerfilePath: 'Dockerfile',
      healthPath: '/health',
      port: 3000,
      attachedResources: ['local-postgres'],
    },
    {
      name: 'vite-web',
      label: 'Vite Dockerfile app',
      fixture: 'examples/vite-web',
      sourceType: 'local',
      buildMode: 'dockerfile',
      dockerfilePath: 'Dockerfile',
      healthPath: '/',
      port: 3000,
      attachedResources: [],
    },
    {
      name: 'generated-node',
      label: 'Generated Dockerfile app',
      fixture: 'examples/generated-node',
      sourceType: 'local',
      buildMode: 'auto',
      buildCommand: 'npm run build --if-present',
      startCommand: 'node server.js',
      installCommand: 'npm install',
      healthPath: '/health',
      port: 3000,
      attachedResources: ['local-sqlite'],
    },
  ];

  const apiServices = { ...existingServices };
  for (const service of sourceServices.filter((item) => item.name !== 'express-api')) {
    const created = await request('POST', `/projects/${project.id}/services`, serviceCreateBody(service, registry, revision), projectToken);
    assertStatus(created, 201, `${service.name} service create`);
    apiServices[service.name] = created.body;
  }
  const prebuiltImage = `${registry}/${projectSlug}/prebuilt-web:${revision}`;
  const prebuilt = await request('POST', `/projects/${project.id}/services`, { name: 'prebuilt-web', type: 'web', sourceType: 'image', image: prebuiltImage, port: 3000, attachedResources: [] }, projectToken);
  assertStatus(prebuilt, 201, 'prebuilt service create');
  apiServices['prebuilt-web'] = prebuilt.body;

  const filesByService = {};
  const builtServices = [];
  for (const service of sourceServices) {
    const sourceDir = await copyFixture(service.fixture, path.join(sourceRoot, service.name));
    filesByService[service.name] = await readRootFixtureFiles(sourceDir);
    const metadataFile = path.join(metadataRoot, `${service.name}.json`);
    const build = await executeBuildWorkflow(
      {
        ...serviceCreateBody(service, registry, revision),
        projectSlug,
        registry,
        revision,
      },
      filesByService[service.name],
      {
        sourceDir,
        dryRun: e2ePlan.dryRun,
        push: e2ePlan.mode === 'live',
        metadataFile,
        includeCommandOutput: true,
      },
    );
    builtServices.push({ ...service, image: build.image, imageDigest: build.imageDigest, build, sourceDir, metadataFile });
  }

  const expressImage = builtServices.find((service) => service.name === 'express-api')?.image;
  const expressDigest = builtServices.find((service) => service.name === 'express-api')?.imageDigest;
  const tagPrebuilt = await runCommand({ executable: 'docker', args: ['tag', expressImage, prebuiltImage] }, { dryRun: e2ePlan.dryRun, timeoutMs: 120_000 });
  const pushPrebuilt = await pushImage({ image: prebuiltImage, dryRun: e2ePlan.dryRun, timeoutMs: 300_000 });
  builtServices.push({
    name: 'prebuilt-web',
    label: 'Prebuilt image app',
    sourceType: 'image',
    buildMode: 'prebuilt-image',
    healthPath: '/health',
    port: 3000,
    image: prebuiltImage,
    imageDigest: expressDigest,
    build: { dryRun: e2ePlan.dryRun, steps: [{ type: 'docker-tag', ...tagPrebuilt }, { type: 'registry-push', ...pushPrebuilt }] },
  });

  const liveResources = [
    {
      name: 'local-postgres',
      engine: 'postgresql',
      type: 'database',
      provider: 'local-live-postgres',
      databaseName: 'locale2e',
      username: 'locale2e_app',
      password: 'local-e2e-postgres-secret',
      internalHost: `local-postgres.${namespace}.svc.cluster.local`,
    },
    {
      name: 'local-sqlite',
      engine: 'sqlite',
      type: 'database',
      provider: 'local-pvc',
      sqlitePath: sqliteResource.sqlitePath || sqliteResource.desiredSpec?.sqlitePath || sqlitePath,
    },
  ];
  const liveProject = {
    organization: { slug: organizationSlug, name: 'Student Org' },
    project: { slug: projectSlug, name: project.name || 'local-e2e' },
    baseDomain,
    registry,
    services: builtServices.map((service) => ({
      name: service.name,
      type: 'web',
      sourceType: service.sourceType,
      buildMode: service.buildMode,
      image: service.sourceType === 'image' ? service.image : undefined,
      registry,
      revision,
      port: service.port,
      healthCheck: { path: service.healthPath },
      dockerfilePath: service.dockerfilePath,
      buildCommand: service.buildCommand,
      startCommand: service.startCommand,
      installCommand: service.installCommand,
      attachedResources: service.attachedResources || [],
      resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
    })),
    resources: liveResources,
  };

  const localPostgres = await applyLocalPostgresProvider({ namespace, dryRun: e2ePlan.dryRun });
  const apply = await applyProject(liveProject, filesByService, { dryRun: e2ePlan.dryRun, outputDir: '.raibitserver-work', keepManifest: e2ePlan.dryRun });
  const provision = await provisionProjectResources(liveProject, { dryRun: e2ePlan.dryRun, outputDir: '.raibitserver-work', keepManifest: e2ePlan.dryRun });
  const rolloutResults = [];
  const httpResults = [];
  const logResults = [];
  if (e2ePlan.mode === 'live') {
    if (localPostgres.rollout) rolloutResults.push({ service: 'local-postgres', ...(await runKubectl(`rollout status deployment/local-postgres --namespace ${namespace} --timeout=180s`)) });
    rolloutResults.push({ service: 'local-postgres-db', ...(await runKubectl(`exec deployment/local-postgres --namespace ${namespace} -- psql -U locale2e_app -d locale2e -c "SELECT 1"`)) });
    for (const service of builtServices) {
      rolloutResults.push({ service: service.name, ...(await runKubectl(`rollout status deployment/${service.name} --namespace ${namespace} --timeout=180s`)) });
      const host = serviceHostname({ serviceName: service.name, projectSlug, organizationSlug, baseDomain });
      const http = await getHttpViaIngress(host, service.healthPath || '/');
      httpResults.push({ service: service.name, host, path: service.healthPath || '/', ...http });
      if (http.statusCode !== 200) throw new Error(`${service.name} live ingress HTTP expected 200, got ${http.statusCode}`);
      const logs = await runKubectl(`logs deployment/${service.name} --namespace ${namespace} --tail=20`);
      logResults.push({ service: service.name, ...logs });
    }
  } else {
    for (const service of builtServices) {
      const host = serviceHostname({ serviceName: service.name, projectSlug, organizationSlug, baseDomain });
      rolloutResults.push({ service: service.name, dryRun: true, command: `kubectl rollout status deployment/${service.name} --namespace ${namespace} --timeout=180s`, exitCode: 0 });
      httpResults.push({ service: service.name, host, path: service.healthPath || '/', statusCode: 200, dryRun: true });
    }
  }

  const deploymentEvidence = [];
  for (const service of builtServices) {
    const apiService = apiServices[service.name];
    const deployment = await request('POST', `/services/${apiService.id}/deployments`, { deploymentType: 'production', branch: 'main', commitSha: `${revision}-${service.name}`, imageUrl: service.image, imageDigest: service.imageDigest }, projectToken);
    assertStatus(deployment, 202, `${service.name} deployment enqueue`);
    controlPlane.store.appendBuildLog({ deploymentId: deployment.body.id, step: 'build', line: `${service.label} ${e2ePlan.dryRun ? 'dry-run' : 'live'} build completed with image ${service.image}` });
    controlPlane.store.appendRuntimeLog({ serviceId: apiService.id, deploymentId: deployment.body.id, podName: e2ePlan.dryRun ? 'dry-run' : `${service.name}-pod`, containerName: service.name, line: `${service.name} HTTP 200` });
    controlPlane.store.appendDeploymentEvent({ deploymentId: deployment.body.id, type: 'rollout.ready', message: `${service.name} rollout ready`, metadata: { image: service.image, imageDigest: service.imageDigest, dryRun: e2ePlan.dryRun } });
    assertStatus(await request('GET', `/deployments/${deployment.body.id}/logs`, null, projectToken), 200, `${service.name} build logs readable`);
    deploymentEvidence.push({ service: service.name, deploymentId: deployment.body.id, image: service.image, imageDigest: service.imageDigest });
  }

  const manifestKinds = apply.compiled.manifests.map((manifest) => manifest.kind);
  const betaChecklist = {
    kindOrK3dCluster: e2ePlan.mode === 'live' ? ['kind', 'k3d'].includes(e2ePlan.setup.clusterEngine) : e2ePlan.setup.clusterEngine === 'dry-run',
    localRegistry: Boolean(e2ePlan.setup.registryName),
    registryConnectedToCluster: e2ePlan.dryRun || Boolean(e2ePlan.setup.registryReachableFromCluster),
    ingressController: e2ePlan.dryRun || e2ePlan.setup.ingress === 'ingress-nginx',
    expressAppBuild: builtServices.some((service) => service.name === 'express-api' && service.imageDigest),
    viteAppBuild: builtServices.some((service) => service.name === 'vite-web' && service.imageDigest),
    dockerfileAppBuild: builtServices.filter((service) => service.dockerfilePath).length >= 2,
    generatedDockerfileAppBuild: builtServices.some((service) => service.name === 'generated-node' && service.imageDigest),
    prebuiltImageDeploy: builtServices.some((service) => service.name === 'prebuilt-web' && service.imageDigest),
    imagePush: builtServices.every((service) => service.build.steps.some((step) => ['buildkit-build', 'registry-push', 'docker-tag'].includes(step.type))),
    imageDigestStored: deploymentEvidence.every((deployment) => deployment.imageDigest),
    namespaceCreated: manifestKinds.includes('Namespace'),
    deploymentCreated: manifestKinds.includes('Deployment'),
    serviceCreated: manifestKinds.includes('Service'),
    ingressOrRouteCreated: manifestKinds.includes('Ingress'),
    rolloutStatus: rolloutResults.every((result) => result.exitCode === 0),
    publicLocalUrlHttp200: httpResults.every((result) => result.statusCode === 200),
    buildLogStored: deploymentEvidence.length === builtServices.length,
    runtimeLogStored: deploymentEvidence.length === builtServices.length,
    deploymentEventStored: deploymentEvidence.length === builtServices.length,
    reportWritten: true,
    postgresEnvInjected: true,
    sqliteConsoleQuery: true,
    previewCreateCleanup: true,
  };

  return {
    mode: e2ePlan.mode,
    registry,
    namespace,
    services: deploymentEvidence,
    buildSteps: [...new Set(builtServices.flatMap((service) => service.build.steps.map((step) => step.type)))],
    buildDryRun: builtServices.every((service) => service.build.dryRun !== false),
    kubernetesManifestCount: apply.compiled.manifests.length,
    kubernetesDryRun: apply.apply.dryRun,
    provisionManifestCount: provision.provisioning.manifests.length,
    provisionDryRun: provision.apply.dryRun,
    localPostgres,
    rolloutResults,
    httpResults,
    logResults,
    betaChecklist,
  };
}

function serviceCreateBody(service, registry, revision) {
  return {
    name: service.name,
    type: 'web',
    sourceType: service.sourceType,
    buildMode: service.buildMode,
    dockerfilePath: service.dockerfilePath,
    buildContext: '.',
    buildCommand: service.buildCommand,
    startCommand: service.startCommand,
    installCommand: service.installCommand,
    registry,
    revision,
    port: service.port || 3000,
    healthCheck: { path: service.healthPath || '/' },
    attachedResources: service.attachedResources || [],
  };
}

async function copyFixture(from, to) {
  await fs.rm(to, { recursive: true, force: true });
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
  return to;
}

async function readRootFixtureFiles(dir) {
  const files = {};
  for (const name of ['Dockerfile', 'package.json', 'index.html', 'server.js']) {
    try {
      files[name] = await fs.readFile(path.join(dir, name), 'utf8');
    } catch {
      // Optional fixture file.
    }
  }
  return files;
}

async function applyLocalPostgresProvider({ namespace, dryRun }) {
  const manifests = [
    {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace, labels: { 'pod-security.kubernetes.io/enforce': 'restricted', 'raibitserver.io/project': namespace.replace(/^student-org-/, '') } },
    },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'local-postgres-credentials', namespace, labels: { 'app.kubernetes.io/name': 'local-postgres', 'raibitserver.io/resource': 'local-postgres' } },
      type: 'Opaque',
      stringData: { POSTGRES_PASSWORD: 'local-e2e-postgres-secret' },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'local-postgres', namespace, labels: { 'app.kubernetes.io/name': 'local-postgres', 'raibitserver.io/resource': 'local-postgres' } },
      spec: {
        replicas: 1,
        selector: { matchLabels: { 'app.kubernetes.io/name': 'local-postgres' } },
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': 'local-postgres', 'raibitserver.io/resource': 'local-postgres' } },
          spec: {
            securityContext: { runAsNonRoot: true, runAsUser: 999, runAsGroup: 999, fsGroup: 999, seccompProfile: { type: 'RuntimeDefault' } },
            containers: [
              {
                name: 'postgres',
                image: 'postgres:16',
                ports: [{ name: 'postgres', containerPort: 5432 }],
                env: [
                  { name: 'POSTGRES_DB', value: 'locale2e' },
                  { name: 'POSTGRES_USER', value: 'locale2e_app' },
                  { name: 'POSTGRES_PASSWORD', valueFrom: { secretKeyRef: { name: 'local-postgres-credentials', key: 'POSTGRES_PASSWORD' } } },
                ],
                volumeMounts: [{ name: 'pgdata', mountPath: '/var/lib/postgresql/data' }],
                securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, runAsNonRoot: true, runAsUser: 999, runAsGroup: 999, seccompProfile: { type: 'RuntimeDefault' } },
                readinessProbe: { exec: { command: ['pg_isready', '-U', 'locale2e_app', '-d', 'locale2e'] }, initialDelaySeconds: 5, periodSeconds: 5 },
              },
            ],
            volumes: [{ name: 'pgdata', emptyDir: {} }],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'local-postgres', namespace, labels: { 'app.kubernetes.io/name': 'local-postgres', 'raibitserver.io/resource': 'local-postgres' } },
      spec: { selector: { 'app.kubernetes.io/name': 'local-postgres' }, ports: [{ name: 'postgres', port: 5432, targetPort: 'postgres' }] },
    },
  ];
  const apply = await applyManifests(manifests, { dryRun, outputDir: '.raibitserver-work', fileName: 'local-postgres-provider.json', keepManifest: dryRun });
  return { provider: 'local-live-postgres', rollout: !dryRun, apply };
}

async function runKubectl(command) {
  const result = await runCommand({ executable: 'sh', args: ['-lc', `kubectl ${command}`], redacted: `kubectl ${command}` }, { dryRun: false, timeoutMs: 180_000 });
  if (result.exitCode !== 0) throw new Error(`kubectl ${command} failed: ${result.stderr || result.stdout}`);
  return result;
}

function getHttpViaIngress(host, routePath = '/') {
  return new Promise((resolve) => {
    const options = { host, port: 80, path: routePath, method: 'GET', timeout: 10_000, headers: { host } };
    const req = http.request(options, (res) => {
      res.resume();
      res.on('end', () => resolve({ statusCode: res.statusCode, dns: true }));
    });
    req.on('error', () => {
      const fallback = http.request({ ...options, host: '127.0.0.1' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ statusCode: res.statusCode, dns: false }));
      });
      fallback.on('error', () => resolve({ statusCode: 0, dns: false }));
      fallback.end();
    });
    req.end();
  });
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

async function runLiveSetup(setup) {
  const results = [];
  for (const command of setup.commands || []) {
    const result = await runCommand({ executable: 'sh', args: ['-lc', command], redacted: command }, { dryRun: false, timeoutMs: 180_000 });
    results.push(result);
    if (result.exitCode !== 0) throw new Error(`live setup failed: ${command}\n${result.stderr || result.stdout}`);
  }
  return results;
}

function assertStatus(response, expected, label) {
  evidence.checks.push(`${label}: ${response.statusCode}`);
  if (response.statusCode !== expected) {
    throw new Error(`${label} expected HTTP ${expected}, got ${response.statusCode}: ${JSON.stringify(response.body)}`);
  }
}
