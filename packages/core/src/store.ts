import { deepClone, nowIso, stableId, slugify } from './ids.ts';
import { maskSecretValue, maskSecrets } from './secrets.ts';
import { createWorkflowJobRecord } from './workflows.ts';
import { normalizeEnvEntries, parseDotEnv, maskEnvEntries } from './env-file.ts';
import { githubIntegrationSummary, parseGitHubRepository } from './github-integration.ts';

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

  createUser({ name, email, githubId = null, passwordHash = null }: Record<string, any>) {
    const user = { id: stableId('usr', email || name), name, email: String(email || '').toLowerCase(), githubId, passwordHash, createdAt: nowIso() };
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
    const resource = { id: stableId('res', projectId, name), projectId, type, name, engine, provider, status, plan, region, createdAt: nowIso(), ...rest };
    this.resources.set(resource.id, resource);
    this.audit('system', 'resource:create', 'resource', resource.id, { projectId, engine, provider });
    return deepClone(resource);
  }

  createDeployment({ serviceId, commitHash = null, imageUrl, status = 'queued', deploymentType = 'production', branch = 'main', previewUrl = null }: Record<string, any>) {
    const deployment = { id: stableId('dep', serviceId, commitHash || imageUrl || Date.now()), serviceId, commitHash, imageUrl, status, deploymentType, branch, previewUrl, startedAt: nowIso(), finishedAt: null };
    this.deployments.set(deployment.id, deployment);
    this.audit('system', 'deployment:create', 'deployment', deployment.id, { serviceId, status });
    return deepClone(deployment);
  }

  enqueueWorkflowJob(input: Record<string, any>) {
    const row = createWorkflowJobRecord(input);
    this.workflowJobs.push(row);
    this.audit('system', 'workflow:enqueue', row.targetType, row.targetId, { workflowJobId: row.id, type: row.type, status: row.status });
    return deepClone(row);
  }

  createSecret({ scopeType = 'service', scopeId, key, value, actorUserId = 'system', metadata = {} }: Record<string, any>) {
    const id = stableId('sec', scopeType, scopeId, key);
    const row = { id, scopeType, scopeId, key, value: String(value ?? ''), valueMasked: maskSecretValue(value), metadata: maskSecrets(metadata), createdAt: nowIso(), updatedAt: nowIso() };
    this.secrets.set(id, row);
    this.audit(actorUserId, 'secret:upsert', scopeType, scopeId, { key, secretId: id });
    return publicSecret(row);
  }

  getSecretValue(secretId: string) {
    return this.secrets.get(secretId)?.value || null;
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
      environment[entry.key] = entry.value;
      const id = stableId('env', serviceId, entry.key);
      const row = { id, projectId, serviceId, key: entry.key, value: entry.value, isSecret: entry.isSecret, secretId, valueMasked: entry.valueMasked, source: entry.source || source, updatedAt: nowIso() };
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
    });
  }
}

function publicSecret(row: Record<string, any>) {
  return { id: row.id, scopeType: row.scopeType, scopeId: row.scopeId, key: row.key, valueMasked: row.valueMasked, metadata: row.metadata || {}, createdAt: row.createdAt, updatedAt: row.updatedAt };
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
