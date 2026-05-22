import { deepClone, nowIso, stableId, slugify } from './ids.ts';
import { maskSecretValue, maskSecrets } from './secrets.ts';
import { claimNextWorkflowJobFromList, completeWorkflowJobRecord, createWorkflowJobRecord, failWorkflowJobRecord, processNextWorkflowJob } from './workflows.ts';
import { normalizeEnvEntries, parseDotEnv, maskEnvEntries } from './env-file.ts';
import { githubIntegrationSummary, githubWebhookActionPlan, githubWebhookOutboundPlan, parseGitHubRepository, verifyGitHubWebhookSignature } from './github-integration.ts';
import { openSecret, publicSecretRecord, sealSecret, secureRandomSecret } from './secret-vault.ts';
import { runDbConsoleQuery, browseDbConsole, resourceConsoleView } from './db-console.ts';
import { provisionPostgresProvider } from './resource-providers.ts';
import { providerOwnedSqlitePath, sanitizeTenantResourceInput } from './resource-sanitizer.ts';

export class ControlPlaneStore {
  organizations: Map<string, any>;
  users: Map<string, any>;
  members: any[];
  projects: Map<string, any>;
  services: Map<string, any>;
  deployments: Map<string, any>;
  resources: Map<string, any>;
  domains: Map<string, any>;
  usageRecords: any[];
  auditLogs: any[];
  workflowJobs: any[];
  secrets: Map<string, any>;
  environmentVariables: Map<string, any>;
  githubIntegrations: Map<string, any>;
  webhookEvents: Map<string, any>;
  buildLogs: any[];
  runtimeLogs: any[];
  deploymentEvents: any[];
  quotas: Map<string, any>;
  resourceAttachments: any[];

  constructor() {
    this.organizations = new Map();
    this.users = new Map();
    this.members = [];
    this.projects = new Map();
    this.services = new Map();
    this.deployments = new Map();
    this.resources = new Map();
    this.domains = new Map();
    this.usageRecords = [];
    this.auditLogs = [];
    this.workflowJobs = [];
    this.secrets = new Map();
    this.environmentVariables = new Map();
    this.githubIntegrations = new Map();
    this.webhookEvents = new Map();
    this.buildLogs = [];
    this.runtimeLogs = [];
    this.deploymentEvents = [];
    this.quotas = new Map();
    this.resourceAttachments = [];
  }

  createOrganization({ name, slug, plan = 'free' }: Record<string, any>) {
    const org = { id: stableId('org', slug || name), name, slug: slugify(slug || name), plan, createdAt: nowIso() };
    this.organizations.set(org.id, org);
    this.audit('system', 'organization:create', 'organization', org.id, { slug: org.slug, plan });
    return deepClone(org);
  }

  findOrganizationBySlug(slug: string) {
    const normalized = slugify(slug);
    const organization = [...this.organizations.values()].find((candidate) => candidate.slug === normalized);
    return organization ? deepClone(organization) : null;
  }

  createUser({ name, email, githubId = null, passwordHash = null, role = 'USER', accountType = 'NON_CLUB', approvalStatus = 'PENDING', avatarUrl = null }: Record<string, any>) {
    const user = { id: stableId('usr', email || name), name, email: String(email || '').toLowerCase(), avatarUrl, githubId, passwordHash, role, accountType, approvalStatus, createdAt: nowIso(), updatedAt: nowIso() };
    this.users.set(user.id, user);
    return deepClone(redactUser(user));
  }

  findUserByEmail(email: string) {
    const normalized = String(email || '').toLowerCase();
    const user = [...this.users.values()].find((candidate) => candidate.email === normalized);
    return user ? deepClone(user) : null;
  }

  addMember({ organizationId, userId, role = 'developer' }: Record<string, any>) {
    const existing = this.members.find((member) => member.organizationId === organizationId && member.userId === userId);
    if (existing) {
      existing.role = role || existing.role;
      return deepClone(existing);
    }
    const member = { organizationId, userId, role, createdAt: nowIso() };
    this.members.push(member);
    this.audit(userId, 'organization.member:add', 'organization', organizationId, { role });
    return deepClone(member);
  }

  listMembershipsForUser(userId: string) {
    return deepClone(this.members.filter((member) => String(member.userId) === String(userId)));
  }

  createProject({ organizationId, name, slug, description = '', status = 'active' }: Record<string, any>) {
    const project = { id: stableId('prj', organizationId, slug || name), organizationId, name, slug: slugify(slug || name), description, status, createdAt: nowIso() };
    this.projects.set(project.id, project);
    this.audit('system', 'project:create', 'project', project.id, { organizationId, slug: project.slug });
    return deepClone(project);
  }

  createService({ projectId, name, type = 'web', runtimeType = 'container', sourceType = 'github', ...rest }: Record<string, any>) {
    const service = {
      id: stableId('svc', projectId, name),
      projectId,
      name,
      slug: slugify(name),
      type,
      runtimeType,
      sourceType,
      status: 'created',
      createdAt: nowIso(),
      ...rest,
    };
    this.services.set(service.id, service);
    this.audit('system', 'service:create', 'service', service.id, { projectId, type });
    return deepClone(service);
  }

  updateService(serviceId: string, updates: Record<string, any>) {
    const current = this.services.get(serviceId);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: nowIso() };
    this.services.set(serviceId, next);
    this.audit('system', 'service:update', 'service', serviceId, maskSecrets(updates));
    return deepClone(next);
  }

  createResource({ projectId, name, type = 'database', engine, provider = 'kubernetes-operator', plan = 'shared-small', region = 'local', status = 'provisioning', ...rest }: Record<string, any>) {
    const safe = sanitizeTenantResourceInput({ projectId, name, type, engine, provider, plan, region, status, ...rest });
    const id = stableId('res', safe.projectId, safe.name);
    const sqlitePath = String(safe.engine || '').toLowerCase() === 'sqlite' ? providerOwnedSqlitePath(id) : null;
    const desiredSpec = sqlitePath ? { ...(safe.desiredSpec || {}), sqlitePath } : safe.desiredSpec;
    const resource = { id, projectId: safe.projectId, type: safe.type || 'database', name: safe.name, slug: slugify(safe.name), engine: safe.engine, provider: safe.provider || 'kubernetes-operator', status: safe.status || 'provisioning', plan: safe.plan || 'shared-small', region: safe.region || 'local', createdAt: nowIso(), ...safe, desiredSpec, sqlitePath: sqlitePath || undefined };
    this.resources.set(resource.id, resource);
    this.audit('system', 'resource:create', 'resource', resource.id, { projectId: resource.projectId, engine: resource.engine, provider: resource.provider });
    return deepClone(resource);
  }

  attachResource({ resourceId, serviceId, envPrefix = null, injectedEnv = {} }: Record<string, any>) {
    const resource = this.resources.get(resourceId);
    const service = this.services.get(serviceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    if (!service) throw notFound(`service not found: ${serviceId}`);
    if (resource.projectId !== service.projectId) throw forbidden('resource and service must be in the same project');
    const row = { id: stableId('attach', resourceId, serviceId), resourceId, serviceId, envPrefix, injectedEnv: maskSecrets(injectedEnv), createdAt: nowIso() };
    this.resourceAttachments.push(row);
    this.audit('system', 'resource:attach', 'service', serviceId, { resourceId, envPrefix });
    return deepClone(row);
  }

  createDeployment({ serviceId, commitHash = null, commitSha = null, imageUrl, imageDigest = null, status = 'queued', deploymentType = 'production', branch = 'main', previewUrl = null, triggerType = 'manual', pullRequestNumber = null, errorCode = null, errorMessage = null }: Record<string, any>) {
    const service = this.services.get(serviceId);
    const sha = commitSha || commitHash || null;
    const deployment = { id: stableId('dep', serviceId, sha || imageUrl || Date.now()), serviceId, projectId: service?.projectId || null, commitHash: commitHash || sha, commitSha: sha, imageUrl, imageDigest, status, deploymentType, branch, previewUrl, triggerType, pullRequestNumber: pullRequestNumber ? Number(pullRequestNumber) : null, errorCode, errorMessage, startedAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso(), finishedAt: null };
    this.deployments.set(deployment.id, deployment);
    this.audit('system', 'deployment:create', 'deployment', deployment.id, { serviceId, status });
    this.appendDeploymentEvent({ deploymentId: deployment.id, type: 'deployment.queued', message: `Deployment queued for ${serviceId}` });
    return deepClone(deployment);
  }

  appendBuildLog({ deploymentId, step = 'build', line, level = 'info' }: Record<string, any>) {
    const row = { id: stableId('blog', deploymentId, this.buildLogs.length), deploymentId, step, line: String(line ?? ''), level, timestamp: nowIso() };
    this.buildLogs.push(row);
    return deepClone(row);
  }

  appendRuntimeLog({ serviceId, deploymentId = null, podName = 'local-pod', containerName = 'app', line, level = 'info' }: Record<string, any>) {
    const row = { id: stableId('rlog', serviceId, this.runtimeLogs.length), serviceId, deploymentId, podName, containerName, line: String(line ?? ''), level, timestamp: nowIso() };
    this.runtimeLogs.push(row);
    return deepClone(row);
  }

  appendDeploymentEvent({ deploymentId, type, message, metadata = {} }: Record<string, any>) {
    const row = { id: stableId('devevt', deploymentId, this.deploymentEvents.length), deploymentId, type, message, metadata: maskSecrets(metadata), timestamp: nowIso() };
    this.deploymentEvents.push(row);
    return deepClone(row);
  }

  listDeploymentLogs(deploymentId: string) {
    return deepClone(this.buildLogs.filter((row) => row.deploymentId === deploymentId));
  }

  listRuntimeLogs(serviceId: string) {
    return deepClone(this.runtimeLogs.filter((row) => row.serviceId === serviceId));
  }

  listDeploymentEvents(deploymentId: string) {
    return deepClone(this.deploymentEvents.filter((row) => row.deploymentId === deploymentId));
  }

  enqueueWorkflowJob(input: Record<string, any>) {
    const row = createWorkflowJobRecord(input);
    this.workflowJobs.push(row);
    this.audit('system', 'workflow:enqueue', row.targetType, row.targetId, { workflowJobId: row.id, type: row.type, status: row.status });
    return deepClone(row);
  }

  claimNextWorkflowJob(options: Record<string, any> = {}) {
    const claimed = claimNextWorkflowJobFromList(this.workflowJobs, options);
    if (claimed) this.audit(options.workerId || options.worker || 'workflow-worker', 'workflow:claim', claimed.targetType, claimed.targetId, { workflowJobId: claimed.id, type: claimed.type, attempt: claimed.attempts });
    return claimed;
  }

  completeWorkflowJob(jobId: string, result: any = {}, options: Record<string, any> = {}) {
    const current = this.workflowJobs.find((job) => String(job.id) === String(jobId));
    if (!current) throw notFound(`workflow job not found: ${jobId}`);
    const next = options.record || completeWorkflowJobRecord(current, result, options);
    this.replaceWorkflowJob(next);
    this.audit(options.workerId || options.worker || 'workflow-worker', 'workflow:complete', next.targetType, next.targetId, { workflowJobId: next.id, type: next.type, status: next.status });
    return deepClone(next);
  }

  failWorkflowJob(jobId: string, error: any, options: Record<string, any> = {}) {
    const current = this.workflowJobs.find((job) => String(job.id) === String(jobId));
    if (!current) throw notFound(`workflow job not found: ${jobId}`);
    const next = options.record || failWorkflowJobRecord(current, error, options);
    this.replaceWorkflowJob(next);
    this.audit(options.workerId || options.worker || 'workflow-worker', 'workflow:fail', next.targetType, next.targetId, { workflowJobId: next.id, type: next.type, status: next.status, retryAt: next.runAfter });
    return deepClone(next);
  }

  async processNextWorkflowJob(handlers: Record<string, any>, options: Record<string, any> = {}) {
    return processNextWorkflowJob(this, handlers, options);
  }

  createSecret({ scopeType = 'service', scopeId, key, value, actorUserId = 'system', metadata = {} }: Record<string, any>) {
    const existing = [...this.secrets.values()].find((secret) => secret.scopeType === scopeType && secret.scopeId === scopeId && secret.key === key);
    const id = existing?.id || `sec_${secureRandomSecret(18)}`;
    const row = { id, scopeType, scopeId, key, sealedValue: sealSecret(value), valueMasked: maskSecretValue(value), metadata: maskSecrets(metadata), createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso() };
    this.secrets.set(id, row);
    this.audit(actorUserId, 'secret:upsert', scopeType, scopeId, { key, secretId: id });
    return publicSecret(row);
  }

  getSecretValue(secretId: string) {
    const secret = this.secrets.get(secretId);
    return secret?.sealedValue ? openSecret(secret.sealedValue) : null;
  }


  async provisionResourceProvider({ resourceId, actorUserId = 'provider', ...options }: Record<string, any>) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    const engine = String(resource.engine || '').toLowerCase();
    if (engine !== 'postgresql' && engine !== 'postgres') throw new Error(`direct provider is not implemented for ${engine}`);
    const result = await provisionPostgresProvider(resource, options);
    const attached = this.attachProviderConnectionSecret({ resourceId, databaseUrl: result.databaseUrl, actorUserId });
    const next = { ...attached, status: 'ready', provider: result.provider, desiredState: { ...(attached.desiredState || {}), providerResult: result.plan }, updatedAt: nowIso() };
    this.resources.set(resourceId, next);
    this.audit(actorUserId, 'resource.provider:provision', 'resource', resourceId, { engine, provider: result.provider, dryRun: result.dryRun, databaseUrl: result.databaseUrlMasked });
    return { resource: deepClone(next), result: maskSecrets({ ...result, databaseUrl: undefined }) };
  }

  attachProviderConnectionSecret({ resourceId, databaseUrl, connectionUrl, actorUserId = 'provider' }: Record<string, any>) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    const value = databaseUrl || connectionUrl;
    if (!value) throw new Error('provider connection URL is required');
    const secret = this.createSecret({ scopeType: 'resource-provider-connection', scopeId: resourceId, key: 'DATABASE_URL', value, actorUserId });
    const next = { ...resource, connectionSecretName: secret.id, updatedAt: nowIso() };
    this.resources.set(resourceId, next);
    this.audit(actorUserId, 'resource.provider-connection:attach', 'resource', resourceId, { connectionSecretName: secret.id });
    return deepClone(next);
  }

  upsertServiceEnvironment({ projectId, serviceId, entries, actorUserId = 'system', source = 'api' }: Record<string, any>) {
    const service = this.services.get(serviceId);
    if (!service) throw notFound(`service not found: ${serviceId}`);
    if (String(service.projectId) !== String(projectId)) throw forbidden('service does not belong to project');
    const normalizedEntries = normalizeEnvEntries(entries, { source });
    const environment = { ...(service.environment || {}) };
    const publicRows = [];
    for (const entry of normalizedEntries) {
      let secretId = null;
      if (entry.isSecret) {
        const secret = this.createSecret({ scopeType: 'service', scopeId: serviceId, key: entry.key, value: entry.value, actorUserId, metadata: { source: entry.source } });
        secretId = secret.id;
      }
      environment[entry.key] = entry.isSecret ? `secret:${secretId}` : entry.value;
      const id = stableId('env', serviceId, entry.key);
      const row = { id, projectId, serviceId, key: entry.key, value: entry.isSecret ? null : entry.value, isSecret: entry.isSecret, secretId, valueMasked: entry.valueMasked, source: entry.source || source, updatedAt: nowIso() };
      this.environmentVariables.set(id, row);
      publicRows.push(row);
    }
    this.updateService(serviceId, { environment });
    this.audit(actorUserId, 'service.env:upsert', 'service', serviceId, { keys: normalizedEntries.map((entry) => entry.key), source });
    return { serviceId, entries: maskEnvEntries(publicRows), plainCount: publicRows.filter((row) => !row.isSecret).length, secretCount: publicRows.filter((row) => row.isSecret).length };
  }

  importServiceEnvFile({ projectId, serviceId, content, actorUserId = 'system', source = '.env' }: Record<string, any>) {
    const parsed = parseDotEnv(String(content || ''), { source });
    const result = this.upsertServiceEnvironment({ projectId, serviceId, entries: parsed.entries, actorUserId, source });
    return { ...result, source, parsed: { plainCount: parsed.plainCount, secretCount: parsed.secretCount, errors: parsed.errors } };
  }

  listServiceEnvironment({ projectId, serviceId }: Record<string, any>) {
    const service = this.services.get(serviceId);
    if (!service) throw notFound(`service not found: ${serviceId}`);
    if (String(service.projectId) !== String(projectId)) throw forbidden('service does not belong to project');
    const rows = [...this.environmentVariables.values()].filter((row) => String(row.serviceId) === String(serviceId));
    return { serviceId, entries: maskEnvEntries(rows), plainCount: rows.filter((row) => !row.isSecret).length, secretCount: rows.filter((row) => row.isSecret).length };
  }

  createGitHubIntegration({ organizationId, userId = null, accountLogin, installationId = null, token = null, scopes = ['repo:read'], defaultBranch = 'main' }: Record<string, any>) {
    if (!organizationId) throw new Error('organizationId is required for GitHub integration');
    const summary = githubIntegrationSummary({ accountLogin, installationId, token, scopes });
    const id = stableId('ghi', organizationId, summary.accountLogin || installationId || summary.tokenFingerprint || Date.now());
    let tokenSecretId = null;
    if (token) {
      const secret = this.createSecret({ scopeType: 'github-integration', scopeId: id, key: 'GITHUB_TOKEN', value: token, actorUserId: userId || 'system' });
      tokenSecretId = secret.id;
    }
    const row = { id, organizationId, userId, ...summary, tokenSecretId, defaultBranch, createdAt: nowIso(), updatedAt: nowIso() };
    this.githubIntegrations.set(id, row);
    this.audit(userId || 'system', 'github:connect', 'organization', organizationId, { integrationId: id, accountLogin: summary.accountLogin, installationId });
    return deepClone(row);
  }

  listGitHubIntegrations({ organizationId }: Record<string, any>) {
    return deepClone([...this.githubIntegrations.values()].filter((row) => String(row.organizationId) === String(organizationId)));
  }

  attachGitHubRepositoryToService({ projectId, serviceId, integrationId, repoUrl, branch = 'main', actorUserId = 'system' }: Record<string, any>) {
    const service = this.services.get(serviceId);
    if (!service) throw notFound(`service not found: ${serviceId}`);
    if (String(service.projectId) !== String(projectId)) throw forbidden('service does not belong to project');
    const project = this.projects.get(projectId);
    if (!project) throw notFound(`project not found: ${projectId}`);
    const integration = integrationId ? this.githubIntegrations.get(integrationId) : null;
    if (integration && String(integration.organizationId) !== String(project.organizationId)) throw forbidden('GitHub integration does not belong to project organization');
    const repo = parseGitHubRepository(repoUrl);
    const updated = this.updateService(serviceId, {
      sourceType: 'github',
      repoUrl: repo.repoUrl,
      branch,
      githubIntegrationId: integration?.id || integrationId || null,
      githubRepository: repo.fullName,
    });
    this.audit(actorUserId, 'github:attach-repository', 'service', serviceId, { integrationId: integration?.id || integrationId || null, repository: repo.fullName, branch });
    return { service: updated, github: { integrationId: integration?.id || integrationId || null, repository: repo.fullName, repoUrl: repo.repoUrl, branch } };
  }

  listGitHubInstallations({ organizationId }: Record<string, any>) {
    const integrations = this.listGitHubIntegrations({ organizationId });
    const installations = integrations
      .filter((integration: Record<string, any>) => integration.installationId)
      .map((integration: Record<string, any>) => {
        const repositories = this.githubRepositoriesForIntegration(integration.id);
        return { id: String(integration.installationId), installationId: String(integration.installationId), integrationId: integration.id, accountLogin: integration.accountLogin, organizationId: integration.organizationId, repositoryCount: repositories.length };
      });
    return { installations };
  }

  listGitHubInstallationRepositories({ installationId, organizationId = null, organizationIds = null }: Record<string, any>) {
    const allowedOrganizationIds = organizationScopeSet({ organizationId, organizationIds });
    const integrations = [...this.githubIntegrations.values()]
      .filter((integration) => String(integration.installationId) === String(installationId))
      .filter((integration) => allowedOrganizationIds.size === 0 || allowedOrganizationIds.has(String(integration.organizationId)));
    const repositories = uniqueRepositories(integrations.flatMap((integration) => this.githubRepositoriesForIntegration(integration.id)));
    return { installationId: String(installationId), repositories };
  }

  importGitHubRepository({ projectId, integrationId = null, repository, repoUrl, branch = 'main', serviceName = null, actorUserId = 'system' }: Record<string, any>) {
    const project = this.projects.get(projectId);
    if (!project) throw notFound(`project not found: ${projectId}`);
    const repo = parseGitHubRepository(repoUrl || repository);
    const integration = integrationId ? this.githubIntegrations.get(integrationId) : null;
    if (integration && String(integration.organizationId) !== String(project.organizationId)) throw forbidden('GitHub integration does not belong to project organization');
    const service = this.createService({
      projectId,
      name: serviceName || repo.repo,
      type: 'web',
      runtimeType: 'container',
      sourceType: 'github',
      repoUrl: repo.repoUrl,
      branch,
      githubIntegrationId: integration?.id || integrationId || null,
      githubRepository: repo.fullName,
      desiredState: { github: { repository: repo.fullName, integrationId: integration?.id || integrationId || null, imported: true } },
    });
    this.audit(actorUserId, 'github:import-repository', 'project', projectId, { repository: repo.fullName, integrationId: integration?.id || integrationId || null });
    return { service, github: { integrationId: integration?.id || integrationId || null, repository: repo.fullName, repoUrl: repo.repoUrl, branch } };
  }

  syncGitHubRepository({ repositoryId, repository, actorUserId = 'system', organizationId = null, organizationIds = null }: Record<string, any>) {
    const normalized = normalizeRepositoryId(repository || repositoryId);
    const services = this.servicesForGitHubRepository(normalized, { organizationId, organizationIds });
    const workflowJob = this.enqueueWorkflowJob({ type: 'github-repository-sync', targetType: 'github-repository', targetId: normalized, payload: { repository: normalized, serviceIds: services.map((service) => service.id) } });
    this.audit(actorUserId, 'github:repository-sync', 'github-repository', normalized, { serviceIds: services.map((service) => service.id) });
    return { repository: normalized, services: deepClone(services), workflowJob };
  }

  handleGitHubWebhook({ event, deliveryId, signature, body, payload, secret = process.env.RAIBITSERVER_GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '' }: Record<string, any>) {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(payload || {});
    if (secret && !verifyGitHubWebhookSignature(rawBody, signature, secret)) throw unauthorized('invalid GitHub webhook signature');
    const id = String(deliveryId || stableId('ghdel', event, rawBody));
    if (this.webhookEvents.has(id)) return { accepted: true, duplicate: true, deliveryId: id, actions: [] };
    const actionPlan = githubWebhookActionPlan(event, payload || {});
    const row = { id: stableId('whe', 'github', id), provider: 'github', eventType: String(event || 'unknown'), deliveryId: id, payload: maskSecrets(payload || {}), handled: true, createdAt: nowIso() };
    this.webhookEvents.set(id, row);
    const services = this.servicesForGitHubRepository(actionPlan.repository);
    const actions: any[] = [];
    for (const service of services) {
      if (actionPlan.kind === 'production-deploy') {
        const deployment = this.createDeployment({ serviceId: service.id, commitSha: actionPlan.commitSha, status: 'queued', deploymentType: 'production', triggerType: 'github_push', branch: actionPlan.branch });
        const workflowJob = this.enqueueWorkflowJob({ type: 'build-and-deploy', targetType: 'deployment', targetId: deployment.id, payload: { serviceId: service.id, projectId: service.projectId, deploymentId: deployment.id, repository: actionPlan.repository, commitSha: actionPlan.commitSha, branch: actionPlan.branch, source: 'github-webhook' } });
        actions.push({ type: 'production-deployment-enqueued', serviceId: service.id, deploymentId: deployment.id, workflowJobId: workflowJob.id });
      } else if (actionPlan.kind === 'preview-deploy') {
        const deployment = this.createDeployment({ serviceId: service.id, commitSha: actionPlan.commitSha, status: 'queued', deploymentType: 'preview', triggerType: 'github_pull_request', branch: actionPlan.branch, pullRequestNumber: actionPlan.pullRequestNumber, previewUrl: previewUrlFor(service, actionPlan.pullRequestNumber) });
        const workflowJob = this.enqueueWorkflowJob({ type: 'preview-deploy', targetType: 'deployment', targetId: deployment.id, payload: { serviceId: service.id, projectId: service.projectId, deploymentId: deployment.id, repository: actionPlan.repository, pullRequestNumber: actionPlan.pullRequestNumber, commitSha: actionPlan.commitSha, branch: actionPlan.branch, source: 'github-webhook' } });
        actions.push({ type: 'preview-deployment-enqueued', serviceId: service.id, deploymentId: deployment.id, workflowJobId: workflowJob.id, pullRequestNumber: actionPlan.pullRequestNumber });
      } else if (actionPlan.kind === 'preview-cleanup') {
        const workflowJob = this.enqueueWorkflowJob({ type: 'preview-cleanup', targetType: 'service', targetId: service.id, payload: { serviceId: service.id, projectId: service.projectId, repository: actionPlan.repository, pullRequestNumber: actionPlan.pullRequestNumber, branch: actionPlan.branch, source: 'github-webhook' } });
        const deployments = [...this.deployments.values()].filter((deployment) => deployment.serviceId === service.id && deployment.deploymentType === 'preview' && Number(deployment.pullRequestNumber) === Number(actionPlan.pullRequestNumber));
        for (const deployment of deployments) {
          this.deployments.set(deployment.id, { ...deployment, status: 'PREVIEW_CLEANUP_REQUESTED', updatedAt: nowIso() });
          this.appendDeploymentEvent({ deploymentId: deployment.id, type: 'preview.cleanup.requested', message: `Preview cleanup requested for PR #${actionPlan.pullRequestNumber}`, metadata: { repository: actionPlan.repository } });
        }
        actions.push({ type: 'preview-cleanup-enqueued', serviceId: service.id, workflowJobId: workflowJob.id, pullRequestNumber: actionPlan.pullRequestNumber, deploymentIds: deployments.map((deployment) => deployment.id) });
      }
    }
    const outbound = githubWebhookOutboundPlan(actionPlan, actions);
    this.audit('github-webhook', 'github:webhook', 'github-delivery', id, { event, repository: actionPlan.repository, action: actionPlan.action, actions: actions.map((action) => action.type) });
    return { accepted: true, duplicate: false, deliveryId: id, event, action: actionPlan.action, repository: actionPlan.repository, matchedServiceCount: services.length, actions, outbound };
  }

  githubRepositoriesForIntegration(integrationId: string) {
    return [...this.services.values()]
      .filter((service) => String(service.githubIntegrationId || service.desiredState?.github?.integrationId || '') === String(integrationId))
      .map((service) => repositorySummaryFromService(service))
      .filter(Boolean);
  }

  servicesForGitHubRepository(repository: any, scope: Record<string, any> = {}) {
    const normalized = normalizeRepositoryId(repository);
    const allowedOrganizationIds = organizationScopeSet(scope);
    return [...this.services.values()]
      .filter((service) => normalizeRepositoryId(service.githubRepository || service.desiredState?.github?.repository || service.repoUrl || '') === normalized)
      .filter((service) => {
        if (allowedOrganizationIds.size === 0) return true;
        const project = this.projects.get(service.projectId);
        return project ? allowedOrganizationIds.has(String(project.organizationId)) : false;
      });
  }

  attachDomain({ projectId, serviceId, domain, verified = false, tlsStatus = 'pending' }: Record<string, any>) {
    const row = { id: stableId('dom', domain), projectId, serviceId, domain, verified, tlsStatus, createdAt: nowIso() };
    this.domains.set(row.id, row);
    return deepClone(row);
  }

  recordUsage(record: Record<string, any>) {
    const row = { id: stableId('use', record.organizationId, record.metric, Date.now()), ...record, recordedAt: record.recordedAt || nowIso() };
    this.usageRecords.push(row);
    return deepClone(row);
  }

  setQuota({ userId, accountType = 'NON_CLUB', ...limits }: Record<string, any>) {
    const id = stableId('quota', userId, accountType);
    const row = { id, userId, accountType, maxProjects: 1, maxServices: 2, maxDeploymentsPerDay: 3, maxPreviewDeployments: 1, maxCpuMillicores: 500, maxMemoryMb: 512, maxDbStorageMb: 512, maxObjectStorageMb: 1024, maxBuildMinutesPerMonth: 60, maxRuntimeHoursPerMonth: 120, ...limits, createdAt: this.quotas.get(id)?.createdAt || nowIso(), updatedAt: nowIso() };
    this.quotas.set(id, row);
    this.audit('system', 'quota:set', 'user', userId, { accountType, limits });
    return deepClone(row);
  }

  approveUser(userId: string, { accountType = 'NON_CLUB', role = null }: Record<string, any> = {}) {
    const user = this.users.get(userId);
    if (!user) throw notFound(`user not found: ${userId}`);
    user.approvalStatus = 'APPROVED';
    user.accountType = accountType;
    if (role) user.role = role;
    user.updatedAt = nowIso();
    if (accountType === 'NON_CLUB') this.setQuota({ userId, accountType });
    this.audit('system', 'user:approve', 'user', userId, { accountType });
    return redactUser(deepClone(user));
  }

  rejectUser(userId: string) {
    const user = this.users.get(userId);
    if (!user) throw notFound(`user not found: ${userId}`);
    user.approvalStatus = 'REJECTED';
    user.updatedAt = nowIso();
    this.audit('system', 'user:reject', 'user', userId, {});
    return redactUser(deepClone(user));
  }

  enforceUserCan({ userId, action, metric = null, increment = 1 }: Record<string, any>) {
    const user = this.users.get(userId);
    if (!user) return true;
    if (user.role === 'ADMIN' || user.accountType === 'CLUB_MEMBER') return true;
    if (user.approvalStatus !== 'APPROVED') throw forbidden(`user ${userId} is ${user.approvalStatus || 'PENDING'} and cannot ${action}`);
    const quota = [...this.quotas.values()].find((row) => row.userId === userId) || this.setQuota({ userId, accountType: user.accountType || 'NON_CLUB' });
    if (metric && quota[metric] !== undefined) {
      const current = this.quotaUsageForUser(userId)[metric] || 0;
      const requested = current + Number(increment || 0);
      if (requested > Number(quota[metric])) throw forbidden(`quota exceeded: ${metric} (${requested}/${quota[metric]})`);
    }
    return true;
  }

  quotaUsageForUser(userId: string) {
    const organizationIds = new Set(this.members.filter((member) => String(member.userId) === String(userId)).map((member) => String(member.organizationId)));
    const projects = [...this.projects.values()].filter((project) => organizationIds.has(String(project.organizationId)));
    const projectIds = new Set(projects.map((project) => String(project.id)));
    const services = [...this.services.values()].filter((service) => projectIds.has(String(service.projectId)));
    const serviceIds = new Set(services.map((service) => String(service.id)));
    const resources = [...this.resources.values()].filter((resource) => projectIds.has(String(resource.projectId)));
    const deployments = [...this.deployments.values()].filter((deployment) => serviceIds.has(String(deployment.serviceId)) && isSameUtcDay(deployment.createdAt || deployment.startedAt, nowIso()));
    const scopedUsage = this.usageRecords.filter((record) => String(record.userId || '') === String(userId) || organizationIds.has(String(record.organizationId)) || projectIds.has(String(record.projectId)) || serviceIds.has(String(record.serviceId)) || resources.some((resource) => String(resource.id) === String(record.resourceId)));
    const allDeployments = [...this.deployments.values()].filter((deployment) => serviceIds.has(String(deployment.serviceId)));
    return {
      maxProjects: projects.length,
      maxServices: services.length,
      maxDeploymentsPerDay: deployments.length,
      maxPreviewDeployments: deployments.filter((deployment) => deployment.deploymentType === 'preview').length,
      maxDbStorageMb: resources.filter((resource) => resourceQuotaMetric(resource) === 'maxDbStorageMb').reduce((sum, resource) => sum + resourceStorageMb(resource), 0),
      maxObjectStorageMb: resources.filter((resource) => resourceQuotaMetric(resource) === 'maxObjectStorageMb').reduce((sum, resource) => sum + resourceStorageMb(resource), 0),
      maxBuildMinutesPerMonth: usageMetricSum(scopedUsage, ['build-minutes', 'build_minutes', 'buildMinutes', 'maxBuildMinutesPerMonth']) + allDeployments.reduce((sum, deployment) => sum + deploymentBuildMinutes(deployment), 0),
      maxRuntimeHoursPerMonth: usageMetricSum(scopedUsage, ['runtime-hours', 'runtime_hours', 'runtimeHours', 'app-runtime-hours', 'maxRuntimeHoursPerMonth']) + allDeployments.reduce((sum, deployment) => sum + deploymentRuntimeHours(deployment), 0),
      maxCpuMillicores: services.reduce((sum, service) => sum + serviceCpuMillicores(service), 0),
      maxMemoryMb: services.reduce((sum, service) => sum + serviceMemoryMb(service), 0),
    };
  }

  async runResourceConsoleQuery(resourceId: string, query: string, options: Record<string, any> = {}) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    const result = await runDbConsoleQuery(this.resourceForConsole(resource), query, options);
    this.audit(options.actorUserId || 'system', 'resource.console:query', 'resource', resourceId, { query, resultRows: (result as any).rowCount || result.rows?.length || 0 });
    return result;
  }

  async runResourceConsoleCommand(resourceId: string, command: string, options: Record<string, any> = {}) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    const result = await runDbConsoleQuery(this.resourceForConsole(resource), command, { ...options, providerCommand: true });
    this.audit(options.actorUserId || 'system', 'resource.console:command', 'resource', resourceId, { command, mode: (result as any).mode, rowCount: (result as any).rowCount || result.rows?.length || 0 });
    return result;
  }

  async browseResourceConsole(resourceId: string, options: Record<string, any> = {}) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    return browseDbConsole(this.resourceForConsole(resource), options);
  }

  async resourceConsoleView(resourceId: string, view: string, options: Record<string, any> = {}) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    return resourceConsoleView(this.resourceForConsole(resource), view, options);
  }

  resourceForConsole(resource: Record<string, any>) {
    if (!resource.connectionSecretName) return resource;
    const secret = this.secrets.get(resource.connectionSecretName);
    if (!isProviderConnectionSecret(secret, resource.id)) return resource;
    const databaseUrl = secret.sealedValue ? openSecret(secret.sealedValue) : null;
    if (!databaseUrl) return resource;
    return { ...resource, providerConnection: { databaseUrl } };
  }

  audit(actorUserId: any, action: string, targetType: string, targetId: any, metadata: Record<string, any> = {}) {
    const row = { id: stableId('aud', action, targetId, Date.now(), this.auditLogs.length), actorUserId, action, targetType, targetId, metadata: maskSecrets(metadata), createdAt: nowIso() };
    this.auditLogs.push(row);
    return deepClone(row);
  }

  snapshot() {
    return deepClone({
      organizations: [...this.organizations.values()],
      users: [...this.users.values()].map(redactUser),
      members: this.members,
      projects: [...this.projects.values()],
      services: [...this.services.values()],
      deployments: [...this.deployments.values()],
      resources: [...this.resources.values()],
      domains: [...this.domains.values()],
      usageRecords: this.usageRecords,
      auditLogs: this.auditLogs,
      workflowJobs: this.workflowJobs,
      secrets: [...this.secrets.values()].map(publicSecret),
      environmentVariables: maskEnvEntries([...this.environmentVariables.values()]),
      githubIntegrations: [...this.githubIntegrations.values()],
      webhookEvents: [...this.webhookEvents.values()],
      buildLogs: this.buildLogs,
      runtimeLogs: this.runtimeLogs,
      deploymentEvents: this.deploymentEvents,
      quotas: [...this.quotas.values()],
      resourceAttachments: this.resourceAttachments,
    });
  }

  private replaceWorkflowJob(next: Record<string, any>) {
    const index = this.workflowJobs.findIndex((job) => String(job.id) === String(next.id));
    if (index === -1) throw notFound(`workflow job not found: ${next.id}`);
    this.workflowJobs[index] = next;
    return next;
  }
}

function publicSecret(row: Record<string, any>) {
  return publicSecretRecord(row);
}

function isProviderConnectionSecret(secret: any, resourceId: string) {
  return secret
    && secret.scopeType === 'resource-provider-connection'
    && String(secret.scopeId) === String(resourceId)
    && secret.key === 'DATABASE_URL';
}

function redactUser(user: Record<string, any>) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function resourceQuotaMetric(resource: Record<string, any>) {
  return String(resource?.type || '').toLowerCase() === 'storage' || String(resource?.engine || '').toLowerCase().includes('object') ? 'maxObjectStorageMb' : 'maxDbStorageMb';
}

function resourceStorageMb(resource: Record<string, any>) {
  if (resource.storageMb !== undefined) return Number(resource.storageMb || 0);
  if (resource.storageGb !== undefined) return Number(resource.storageGb || 0) * 1024;
  return 1;
}

function usageMetricSum(records: Array<Record<string, any>>, aliases: string[]) {
  const names = new Set(aliases.map((alias) => alias.toLowerCase()));
  return records
    .filter((record) => names.has(String(record.metric || '').toLowerCase()))
    .reduce((sum, record) => sum + Number(record.value || 0), 0);
}

function deploymentBuildMinutes(deployment: Record<string, any>) {
  const start = dateMs(deployment.buildStartedAt || deployment.startedAt);
  const end = dateMs(deployment.buildFinishedAt || deployment.finishedAt);
  return start && end && end > start ? (end - start) / 60_000 : 0;
}

function deploymentRuntimeHours(deployment: Record<string, any>) {
  const start = dateMs(deployment.deployedAt);
  const end = dateMs(deployment.finishedAt) || Date.now();
  return start && end > start ? (end - start) / 3_600_000 : 0;
}

function serviceCpuMillicores(service: Record<string, any>) {
  const spec = service.desiredSpec || service.desiredState || service;
  return parseCpuMillicores(spec.cpu || spec.cpuRequest || spec.resources?.requests?.cpu || spec.resources?.limits?.cpu);
}

function serviceMemoryMb(service: Record<string, any>) {
  const spec = service.desiredSpec || service.desiredState || service;
  return parseMemoryMb(spec.memory || spec.memoryMb || spec.memoryRequest || spec.resources?.requests?.memory || spec.resources?.limits?.memory);
}

function parseCpuMillicores(value: any) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim();
  if (text.endsWith('m')) return Number(text.slice(0, -1)) || 0;
  const number = Number(text);
  return Number.isFinite(number) ? number * 1000 : 0;
}

function parseMemoryMb(value: any) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim().toLowerCase();
  const number = Number(text.replace(/[a-z]+$/, ''));
  if (!Number.isFinite(number)) return 0;
  if (text.endsWith('gi') || text.endsWith('gib')) return number * 1024;
  if (text.endsWith('gb')) return number * 1000;
  if (text.endsWith('ki') || text.endsWith('kib')) return number / 1024;
  if (text.endsWith('kb')) return number / 1000;
  return number;
}

function dateMs(value: any) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isSameUtcDay(left: any, right: any) {
  const a = new Date(left);
  const b = new Date(right);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function notFound(message: string) {
  const error = new Error(message);
  (error as any).statusCode = 404;
  return error;
}

function forbidden(message: string) {
  const error = new Error(message);
  (error as any).statusCode = 403;
  return error;
}

function unauthorized(message: string) {
  const error = new Error(message);
  (error as any).statusCode = 401;
  return error;
}

function normalizeRepositoryId(value: any) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return parseGitHubRepository(text).fullName.toLowerCase();
  } catch {
    return text.toLowerCase().replace(/^github:/, '');
  }
}

function organizationScopeSet(scope: Record<string, any> = {}) {
  const ids = [
    scope.organizationId,
    ...(Array.isArray(scope.organizationIds) ? scope.organizationIds : []),
  ].filter((value) => value !== null && value !== undefined && String(value).trim());
  return new Set(ids.map((value) => String(value)));
}

function repositorySummaryFromService(service: Record<string, any>) {
  const repository = normalizeRepositoryId(service.githubRepository || service.desiredState?.github?.repository || service.repoUrl || '');
  if (!repository) return null;
  const parsed = parseGitHubRepository(repository);
  return { id: stableId('ghr', parsed.fullName), fullName: parsed.fullName, repoUrl: parsed.repoUrl, defaultBranch: service.branch || 'main', serviceIds: [service.id] };
}

function uniqueRepositories(repositories: Array<Record<string, any> | null>) {
  const byName = new Map();
  for (const repository of repositories) {
    if (!repository) continue;
    const key = normalizeRepositoryId(repository.fullName || repository.repoUrl);
    const existing = byName.get(key);
    byName.set(key, existing ? { ...existing, serviceIds: [...new Set([...(existing.serviceIds || []), ...(repository.serviceIds || [])])] } : repository);
  }
  return [...byName.values()];
}

function previewUrlFor(service: Record<string, any>, pullRequestNumber: any) {
  const project = String(service.projectId || 'project').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const name = String(service.slug || service.name || service.id).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `https://pr-${Number(pullRequestNumber || 0)}--${name}--${project}.preview.raibitserver.app`;
}
