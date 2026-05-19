import { deepClone, nowIso, stableId, slugify } from './ids.ts';
import { maskSecretValue, maskSecrets } from './secrets.ts';
import { createWorkflowJobRecord } from './workflows.ts';
import { normalizeEnvEntries, parseDotEnv, maskEnvEntries } from './env-file.ts';
import { githubIntegrationSummary, parseGitHubRepository } from './github-integration.ts';
import { openSecret, publicSecretRecord, sealSecret, secureRandomSecret } from './secret-vault.ts';
import { runDbConsoleQuery, browseDbConsole } from './db-console.ts';

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
    const resource = { id: stableId('res', projectId, name), projectId, type, name, slug: slugify(name), engine, provider, status, plan, region, createdAt: nowIso(), ...rest };
    this.resources.set(resource.id, resource);
    this.audit('system', 'resource:create', 'resource', resource.id, { projectId, engine, provider });
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

  createDeployment({ serviceId, commitHash = null, imageUrl, status = 'queued', deploymentType = 'production', branch = 'main', previewUrl = null }: Record<string, any>) {
    const service = this.services.get(serviceId);
    const deployment = { id: stableId('dep', serviceId, commitHash || imageUrl || Date.now()), serviceId, projectId: service?.projectId || null, commitHash, commitSha: commitHash, imageUrl, status, deploymentType, branch, previewUrl, triggerType: 'manual', startedAt: nowIso(), createdAt: nowIso(), updatedAt: nowIso(), finishedAt: null };
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
    const integration = integrationId ? this.githubIntegrations.get(integrationId) : null;
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
    if (metric && quota[metric] !== undefined && increment > Number(quota[metric])) throw forbidden(`quota exceeded: ${metric}`);
    return true;
  }

  async runResourceConsoleQuery(resourceId: string, query: string, options: Record<string, any> = {}) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    const result = await runDbConsoleQuery(resource, query, options);
    this.audit(options.actorUserId || 'system', 'resource.console:query', 'resource', resourceId, { query, resultRows: (result as any).rowCount || result.rows?.length || 0 });
    return result;
  }

  async browseResourceConsole(resourceId: string, options: Record<string, any> = {}) {
    const resource = this.resources.get(resourceId);
    if (!resource) throw notFound(`resource not found: ${resourceId}`);
    return browseDbConsole(resource, options);
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
      buildLogs: this.buildLogs,
      runtimeLogs: this.runtimeLogs,
      deploymentEvents: this.deploymentEvents,
      quotas: [...this.quotas.values()],
      resourceAttachments: this.resourceAttachments,
    });
  }
}

function publicSecret(row: Record<string, any>) {
  return publicSecretRecord(row);
}

function redactUser(user: Record<string, any>) {
  const { passwordHash, ...rest } = user;
  return rest;
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
