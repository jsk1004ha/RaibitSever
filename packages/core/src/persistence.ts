import { ControlPlaneStore } from './store.ts';
import { deepClone } from './ids.ts';
import { maskSecretValue, maskSecrets } from './secrets.ts';
import { sealSecret } from './secret-vault.ts';
import { browseDbConsole, runDbConsoleQuery } from './db-console.ts';
import { secretEncryptionConfigured } from './config.ts';

export class InMemoryControlPlaneRepository {
  store: ControlPlaneStore;

  constructor(store = new ControlPlaneStore()) {
    this.store = store;
  }

  async createOrganization(input: Record<string, any>) { return this.store.createOrganization(input); }
  async findOrganizationBySlug(slug: string) { return this.store.findOrganizationBySlug(slug); }
  async createUser(input: Record<string, any>) { return this.store.createUser(input); }
  async findUserByEmail(email: string) { return this.store.findUserByEmail(email); }
  async addMember(input: Record<string, any>) { return this.store.addMember(input); }
  async listMembershipsForUser(userId: string) { return this.store.listMembershipsForUser(userId); }
  async createProject(input: Record<string, any>) { return this.store.createProject(input); }
  async createService(input: Record<string, any>) { return this.store.createService(input); }
  async createResource(input: Record<string, any>) { return this.store.createResource(input); }
  async createDeployment(input: Record<string, any>) { return this.store.createDeployment(input); }
  async createSecret(input: Record<string, any>) { return this.store.createSecret(input); }
  async createDeploymentWorkflow(input: Record<string, any>) {
    const deployment = this.store.createDeployment(input.deployment || input);
    const workflowJob = this.store.enqueueWorkflowJob({
      type: input.workflow?.type || 'build-and-deploy',
      targetType: 'deployment',
      targetId: deployment.id,
      payload: { ...(input.workflow?.payload || {}), deploymentId: deployment.id },
    });
    return { deployment, workflowJob };
  }
  async getProject(projectId: string) { return deepClone(this.store.projects.get(projectId) || null); }
  async getService(serviceId: string) { return deepClone(this.store.services.get(serviceId) || null); }
  async getResource(resourceId: string) { return deepClone(this.store.resources.get(resourceId) || null); }
  async getDeployment(deploymentId: string) { return deepClone(this.store.deployments.get(deploymentId) || null); }
  async listServicesForProject(projectId: string) { return deepClone([...this.store.services.values()].filter((service) => String(service.projectId) === String(projectId))); }
  async listResourcesForProject(projectId: string) { return deepClone([...this.store.resources.values()].filter((resource) => String(resource.projectId) === String(projectId))); }
  async listDeploymentsForService(serviceId: string) { return deepClone([...this.store.deployments.values()].filter((deployment) => String(deployment.serviceId) === String(serviceId))); }
  async upsertServiceEnvironment(input: Record<string, any>) { return this.store.upsertServiceEnvironment(input); }
  async importServiceEnvFile(input: Record<string, any>) { return this.store.importServiceEnvFile(input); }
  async listServiceEnvironment(input: Record<string, any>) { return this.store.listServiceEnvironment(input); }
  async createGitHubIntegration(input: Record<string, any>) { return this.store.createGitHubIntegration(input); }
  async listGitHubIntegrations(input: Record<string, any>) { return this.store.listGitHubIntegrations(input); }
  async attachGitHubRepositoryToService(input: Record<string, any>) { return this.store.attachGitHubRepositoryToService(input); }
  async enqueueWorkflowJob(input: Record<string, any>) { return this.store.enqueueWorkflowJob(input); }
  async approveUser(userId: string, input: Record<string, any> = {}) { return this.store.approveUser(userId, input); }
  async rejectUser(userId: string) { return this.store.rejectUser(userId); }
  async setQuota(input: Record<string, any>) { return this.store.setQuota(input); }
  async enforceUserCan(input: Record<string, any>) { return this.store.enforceUserCan(input); }
  async attachResource(input: Record<string, any>) { return this.store.attachResource(input); }
  async appendBuildLog(input: Record<string, any>) { return this.store.appendBuildLog(input); }
  async appendRuntimeLog(input: Record<string, any>) { return this.store.appendRuntimeLog(input); }
  async appendDeploymentEvent(input: Record<string, any>) { return this.store.appendDeploymentEvent(input); }
  async listDeploymentLogs(deploymentId: string) { return this.store.listDeploymentLogs(deploymentId); }
  async listRuntimeLogs(serviceId: string) { return this.store.listRuntimeLogs(serviceId); }
  async listDeploymentEvents(deploymentId: string) { return this.store.listDeploymentEvents(deploymentId); }
  async runResourceConsoleQuery(resourceId: string, query: string, options: Record<string, any> = {}) { return this.store.runResourceConsoleQuery(resourceId, query, options); }
  async browseResourceConsole(resourceId: string, options: Record<string, any> = {}) { return this.store.browseResourceConsole(resourceId, options); }
  async snapshot() { return this.store.snapshot(); }
}

export class PrismaControlPlaneRepository {
  prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  static async connect(options: Record<string, any> = {}) {
    const moduleName = options.clientModule || '@prisma/client';
    const imported = await import(moduleName);
    const PrismaClient = imported.PrismaClient;
    const prisma = new PrismaClient(options.prismaOptions || {});
    if (options.connect !== false) await prisma.$connect();
    return new PrismaControlPlaneRepository(prisma);
  }

  async disconnect() {
    if (this.prisma?.$disconnect) await this.prisma.$disconnect();
  }

  async createOrganization(input: Record<string, any>) {
    return this.prisma.organization.upsert({
      where: { slug: input.slug || slugInput(input.name) },
      update: { name: input.name, plan: input.plan || 'free' },
      create: { name: input.name, slug: input.slug || slugInput(input.name), plan: input.plan || 'free' },
    });
  }

  async findOrganizationBySlug(slug: string) {
    return this.prisma.organization.findUnique({ where: { slug: slugInput(slug) } });
  }

  async createUser(input: Record<string, any>) {
    return this.prisma.user.upsert({
      where: { email: input.email },
      update: { name: input.name, avatarUrl: input.avatarUrl || null, githubId: input.githubId || null, passwordHash: input.passwordHash || undefined, role: input.role || undefined, accountType: input.accountType || undefined, approvalStatus: input.approvalStatus || undefined },
      create: { name: input.name, email: input.email, avatarUrl: input.avatarUrl || null, githubId: input.githubId || null, passwordHash: input.passwordHash || null, role: input.role || 'USER', accountType: input.accountType || 'NON_CLUB', approvalStatus: input.approvalStatus || 'PENDING' },
    });
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: String(email || '').toLowerCase() } });
  }

  async addMember(input: Record<string, any>) {
    return this.prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
      update: { role: input.role || 'developer' },
      create: { organizationId: input.organizationId, userId: input.userId, role: input.role || 'developer' },
    });
  }

  async listMembershipsForUser(userId: string) {
    return this.prisma.membership.findMany({ where: { userId } });
  }

  async createProject(input: Record<string, any>) {
    return this.prisma.project.upsert({
      where: { organizationId_slug: { organizationId: input.organizationId, slug: input.slug || slugInput(input.name) } },
      update: { name: input.name, description: input.description || '', status: input.status || 'active' },
      create: { organizationId: input.organizationId, name: input.name, slug: input.slug || slugInput(input.name), description: input.description || '', status: input.status || 'active' },
    });
  }

  async createService(input: Record<string, any>) {
    return this.prisma.service.upsert({
      where: { projectId_slug: { projectId: input.projectId, slug: input.slug || slugInput(input.name) } },
      update: serviceData(input),
      create: { projectId: input.projectId, name: input.name, slug: input.slug || slugInput(input.name), ...serviceData(input) },
    });
  }

  async createResource(input: Record<string, any>) {
    return this.prisma.resource.upsert({
      where: { projectId_name: { projectId: input.projectId, name: input.name } },
      update: resourceData(input),
      create: { projectId: input.projectId, name: input.name, slug: input.slug || slugInput(input.name), ...resourceData(input) },
    });
  }

  async createDeployment(input: Record<string, any>) {
    return this.prisma.deployment.create({ data: deploymentData(input) });
  }

  async createDeploymentWorkflow(input: Record<string, any>) {
    return this.prisma.$transaction(async (tx: any) => {
      const requestedDeployment = input.deployment || input;
      const service = await tx.service.findUnique({ where: { id: requestedDeployment.serviceId } });
      const deployment = await tx.deployment.create({ data: deploymentData({ ...requestedDeployment, projectId: requestedDeployment.projectId || service?.projectId }) });
      const workflowJob = await tx.workflowJob.create({ data: workflowJobData({
        ...(input.workflow || {}),
        targetType: 'deployment',
        targetId: deployment.id,
        payload: { ...(input.workflow?.payload || {}), deploymentId: deployment.id },
      }) });
      return { deployment, workflowJob };
    });
  }

  async getProject(projectId: string) {
    return this.prisma.project.findUnique({ where: { id: projectId } });
  }

  async getService(serviceId: string) {
    return this.prisma.service.findUnique({ where: { id: serviceId } });
  }

  async getResource(resourceId: string) {
    return this.prisma.resource.findUnique({ where: { id: resourceId } });
  }

  async getDeployment(deploymentId: string) {
    return this.prisma.deployment.findUnique({ where: { id: deploymentId } });
  }

  async listServicesForProject(projectId: string) {
    return this.prisma.service.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async listResourcesForProject(projectId: string) {
    return this.prisma.resource.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }

  async listDeploymentsForService(serviceId: string) {
    return this.prisma.deployment.findMany({ where: { serviceId }, orderBy: { createdAt: 'desc' } });
  }

  async upsertServiceEnvironment(input: Record<string, any>) {
    const { normalizeEnvEntries } = await import('./env-file.ts');
    const rows = [];
    for (const entry of normalizeEnvEntries(input.entries || [], { source: input.source || 'api' })) {
      let secretRef = (entry as any).secretId || null;
      if (entry.isSecret) {
        const secret = await this.prisma.secretValue.upsert({
          where: { scopeType_scopeId_key: { scopeType: 'service', scopeId: input.serviceId, key: entry.key } },
          update: { sealedValue: sealSecret(entry.value), valueMasked: maskSecretValue(entry.value), metadata: maskSecrets({ source: entry.source || input.source || 'api' }) },
          create: { scopeType: 'service', scopeId: input.serviceId, key: entry.key, sealedValue: sealSecret(entry.value), valueMasked: maskSecretValue(entry.value), metadata: maskSecrets({ source: entry.source || input.source || 'api' }) },
        });
        secretRef = secret.id;
      }
      const data = envVariableData({ ...entry, projectId: input.projectId, serviceId: input.serviceId, source: entry.source || input.source || 'api', secretRef });
      const row = await this.prisma.environmentVariable.upsert({
        where: { serviceId_key: { serviceId: input.serviceId, key: data.key } },
        update: data,
        create: data,
      });
      rows.push(row);
    }
    await this.prisma.auditLog.create({ data: { actorUserId: input.actorUserId || 'system', action: 'service.env:upsert', targetType: 'service', targetId: input.serviceId, metadata: maskSecrets({ keys: rows.map((row) => row.key) }) } });
    return { serviceId: input.serviceId, entries: rows.map(maskEnvRow), plainCount: rows.filter((row) => !row.isSecret).length, secretCount: rows.filter((row) => row.isSecret).length };
  }

  async importServiceEnvFile(input: Record<string, any>) {
    const { parseDotEnv } = await import('./env-file.ts');
    const parsed = parseDotEnv(String(input.content || ''), { source: input.source || '.env' });
    const result = await this.upsertServiceEnvironment({ ...input, entries: parsed.entries });
    return { ...result, source: input.source || '.env', parsed: { plainCount: parsed.plainCount, secretCount: parsed.secretCount, errors: parsed.errors } };
  }

  async listServiceEnvironment(input: Record<string, any>) {
    const rows = await this.prisma.environmentVariable.findMany({ where: { serviceId: input.serviceId } });
    return { serviceId: input.serviceId, entries: rows.map(maskEnvRow), plainCount: rows.filter((row) => !row.isSecret).length, secretCount: rows.filter((row) => row.isSecret).length };
  }

  async createGitHubIntegration(input: Record<string, any>) {
    const { githubIntegrationSummary } = await import('./github-integration.ts');
    const summary = githubIntegrationSummary(input);
    let row = await this.prisma.githubIntegration.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId || null,
        accountLogin: summary.accountLogin,
        installationId: summary.installationId ? String(summary.installationId) : null,
        tokenPreview: summary.tokenPreview,
        tokenFingerprint: summary.tokenFingerprint,
        scopes: summary.scopes,
        defaultBranch: input.defaultBranch || 'main',
      },
    });
    if (input.token) {
      const secret = await this.prisma.secretValue.upsert({
        where: { scopeType_scopeId_key: { scopeType: 'github-integration', scopeId: row.id, key: 'GITHUB_TOKEN' } },
        update: { sealedValue: sealSecret(input.token), valueMasked: maskSecretValue(input.token), metadata: maskSecrets({ accountLogin: input.accountLogin }) },
        create: { scopeType: 'github-integration', scopeId: row.id, key: 'GITHUB_TOKEN', sealedValue: sealSecret(input.token), valueMasked: maskSecretValue(input.token), metadata: maskSecrets({ accountLogin: input.accountLogin }) },
      });
      row = await this.prisma.githubIntegration.update({ where: { id: row.id }, data: { tokenSecretId: secret.id } });
    }
    await this.prisma.auditLog.create({ data: { actorUserId: input.userId || 'system', action: 'github:connect', targetType: 'organization', targetId: input.organizationId, metadata: maskSecrets({ integrationId: row.id, accountLogin: row.accountLogin }) } });
    return row;
  }

  async listGitHubIntegrations(input: Record<string, any>) {
    return this.prisma.githubIntegration.findMany({ where: { organizationId: input.organizationId } });
  }

  async attachGitHubRepositoryToService(input: Record<string, any>) {
    const { parseGitHubRepository } = await import('./github-integration.ts');
    const repo = parseGitHubRepository(input.repoUrl);
    const service = await this.prisma.service.update({
      where: { id: input.serviceId },
      data: { sourceType: 'github', repoUrl: repo.repoUrl, branch: input.branch || 'main', desiredState: sanitizeJson({ githubIntegrationId: input.integrationId || null, githubRepository: repo.fullName }) },
    });
    await this.prisma.auditLog.create({ data: { actorUserId: input.actorUserId || 'system', action: 'github:attach-repository', targetType: 'service', targetId: input.serviceId, metadata: { repository: repo.fullName, integrationId: input.integrationId || null } } });
    return { service, github: { integrationId: input.integrationId || null, repository: repo.fullName, repoUrl: repo.repoUrl, branch: input.branch || 'main' } };
  }

  async enqueueWorkflowJob(input: Record<string, any>) {
    return this.prisma.workflowJob.create({ data: workflowJobData(input) });
  }


  async approveUser(userId: string, input: Record<string, any> = {}) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { approvalStatus: 'APPROVED', accountType: input.accountType || 'NON_CLUB', role: input.role || undefined } });
    if ((input.accountType || user.accountType) === 'NON_CLUB') await this.setQuota({ userId, accountType: 'NON_CLUB' });
    await this.prisma.auditLog.create({ data: { actorUserId: input.actorUserId || 'system', action: 'user:approve', targetType: 'user', targetId: userId, metadata: maskSecrets({ accountType: input.accountType || user.accountType }) } });
    return redactUser(user);
  }

  async rejectUser(userId: string, input: Record<string, any> = {}) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { approvalStatus: 'REJECTED' } });
    await this.prisma.auditLog.create({ data: { actorUserId: input.actorUserId || 'system', action: 'user:reject', targetType: 'user', targetId: userId, metadata: {} } });
    return redactUser(user);
  }

  async setQuota(input: Record<string, any>) {
    return this.prisma.quota.upsert({
      where: { id: input.id || `quota_${input.userId}_${input.accountType || 'NON_CLUB'}` },
      update: quotaData(input),
      create: { id: input.id || `quota_${input.userId}_${input.accountType || 'NON_CLUB'}`, userId: input.userId, accountType: input.accountType || 'NON_CLUB', ...quotaData(input) },
    });
  }

  async enforceUserCan(input: Record<string, any>) {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role === 'ADMIN' || user.accountType === 'CLUB_MEMBER') return true;
    if (user.approvalStatus !== 'APPROVED') {
      await this.prisma.auditLog.create({ data: { actorUserId: input.userId, action: 'quota:block', targetType: input.action || 'action', targetId: input.metric || input.action || 'unknown', metadata: { reason: user.approvalStatus || 'PENDING' } } });
      const error = new Error(`user ${input.userId} is ${user.approvalStatus || 'PENDING'} and cannot ${input.action}`);
      (error as any).statusCode = 403;
      throw error;
    }
    return true;
  }

  async appendBuildLog(input: Record<string, any>) {
    return this.prisma.buildLog.create({ data: { deploymentId: input.deploymentId, step: input.step || 'build', line: String(input.line ?? ''), level: input.level || 'info' } });
  }

  async appendRuntimeLog(input: Record<string, any>) {
    return this.prisma.runtimeLog.create({ data: { serviceId: input.serviceId, deploymentId: input.deploymentId || null, podName: input.podName || 'local-pod', containerName: input.containerName || 'app', line: String(input.line ?? ''), level: input.level || 'info' } });
  }

  async appendDeploymentEvent(input: Record<string, any>) {
    return this.prisma.deploymentEvent.create({ data: { deploymentId: input.deploymentId, type: input.type, message: input.message, metadata: maskSecrets(input.metadata || {}) } });
  }

  async listDeploymentLogs(deploymentId: string) { return this.prisma.buildLog.findMany({ where: { deploymentId }, orderBy: { timestamp: 'asc' } }); }
  async listRuntimeLogs(serviceId: string) { return this.prisma.runtimeLog.findMany({ where: { serviceId }, orderBy: { timestamp: 'asc' } }); }
  async listDeploymentEvents(deploymentId: string) { return this.prisma.deploymentEvent.findMany({ where: { deploymentId }, orderBy: { timestamp: 'asc' } }); }

  async runResourceConsoleQuery(resourceId: string, query: string, options: Record<string, any> = {}) {
    const resource = await this.getResource(resourceId);
    if (!resource) {
      const error = new Error(`resource not found: ${resourceId}`);
      (error as any).statusCode = 404;
      throw error;
    }
    const result = await runDbConsoleQuery(resource, query, options);
    await this.prisma.auditLog.create({ data: { actorUserId: options.actorUserId || 'system', action: 'resource.console:query', targetType: 'resource', targetId: resourceId, metadata: maskSecrets({ query, resultRows: (result as any).rowCount || result.rows?.length || 0 }) } });
    return result;
  }

  async browseResourceConsole(resourceId: string, options: Record<string, any> = {}) {
    const resource = await this.getResource(resourceId);
    if (!resource) {
      const error = new Error(`resource not found: ${resourceId}`);
      (error as any).statusCode = 404;
      throw error;
    }
    return browseDbConsole(resource, options);
  }

  async writeDesiredProject(projectSpec: Record<string, any>) {
    const orgInput = projectSpec.organization || { name: projectSpec.organizationSlug || 'default', slug: projectSpec.organizationSlug || 'default', plan: 'free' };
    return this.prisma.$transaction(async (tx: any) => {
      const organization = await tx.organization.upsert({
        where: { slug: orgInput.slug || slugInput(orgInput.name) },
        update: { name: orgInput.name || orgInput.slug, plan: orgInput.plan || 'free' },
        create: { name: orgInput.name || orgInput.slug, slug: orgInput.slug || slugInput(orgInput.name), plan: orgInput.plan || 'free' },
      });
      const projectInput = projectSpec.project || { name: projectSpec.name || projectSpec.slug || 'project', slug: projectSpec.slug || projectSpec.name || 'project' };
      const project = await tx.project.upsert({
        where: { organizationId_slug: { organizationId: organization.id, slug: projectInput.slug || slugInput(projectInput.name) } },
        update: { name: projectInput.name || projectInput.slug, description: projectInput.description || '', status: 'active' },
        create: { organizationId: organization.id, name: projectInput.name || projectInput.slug, slug: projectInput.slug || slugInput(projectInput.name), description: projectInput.description || '', status: 'active' },
      });
      for (const service of projectSpec.services || []) {
        await tx.service.upsert({
          where: { projectId_slug: { projectId: project.id, slug: service.slug || slugInput(service.name) } },
          update: serviceData({ ...service, projectId: project.id }),
          create: { projectId: project.id, name: service.name, slug: service.slug || slugInput(service.name), ...serviceData(service) },
        });
      }
      for (const resource of projectSpec.resources || []) {
        await tx.resource.upsert({
          where: { projectId_name: { projectId: project.id, name: resource.name } },
          update: resourceData({ ...resource, projectId: project.id }),
          create: { projectId: project.id, name: resource.name, ...resourceData(resource) },
        });
      }
      await tx.auditLog.create({ data: { actorUserId: 'system', action: 'desired-state:write', targetType: 'project', targetId: project.id, metadata: maskSecrets(projectSpec) } });
      return { organization, project };
    });
  }

  async snapshot() {
    const [organizations, users, members, projects, services, resources, deployments, auditLogs, usageRecords, workflowJobs, quotas, domains, resourceAttachments, buildLogs, runtimeLogs, deploymentEvents, resourceBackups] = await Promise.all([
      this.prisma.organization.findMany(),
      this.prisma.user.findMany(),
      this.prisma.membership.findMany(),
      this.prisma.project.findMany(),
      this.prisma.service.findMany(),
      this.prisma.resource.findMany(),
      this.prisma.deployment.findMany(),
      this.prisma.auditLog.findMany(),
      this.prisma.usageRecord.findMany(),
      this.prisma.workflowJob.findMany(),
      this.prisma.quota.findMany(),
      this.prisma.domain.findMany(),
      this.prisma.resourceAttachment.findMany(),
      this.prisma.buildLog.findMany(),
      this.prisma.runtimeLog.findMany(),
      this.prisma.deploymentEvent.findMany(),
      this.prisma.resourceBackup.findMany(),
    ]);
    const [environmentVariables, githubIntegrations] = await Promise.all([
      this.prisma.environmentVariable.findMany(),
      this.prisma.githubIntegration.findMany(),
    ]);
    return deepClone({ organizations, users: users.map(redactUser), members, projects, services, resources, deployments, auditLogs, usageRecords, workflowJobs, quotas, domains, resourceAttachments, resourceBackups, buildLogs, runtimeLogs, deploymentEvents, environmentVariables: environmentVariables.map(maskEnvRow), githubIntegrations });
  }
}

export function resolveControlPlaneRepositoryConfig(options: Record<string, any> = {}, env: Record<string, any> = process.env) {
  const rawKind = String(options.kind || env.RAIBITSERVER_PERSISTENCE || '').trim().toLowerCase();
  const production = env.NODE_ENV === 'production';
  const kind = rawKind || (production ? 'prisma' : 'memory');
  if (!['memory', 'prisma'].includes(kind)) throw new Error(`unsupported RAIBITSERVER_PERSISTENCE kind: ${kind}`);
  if (production && kind === 'memory' && env.RAIBITSERVER_ALLOW_MEMORY_PERSISTENCE !== '1') {
    throw new Error('in-memory persistence is disabled in production; set RAIBITSERVER_PERSISTENCE=prisma with DATABASE_URL');
  }
  if (production && kind === 'prisma') {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for production Prisma persistence');
    if (!secretEncryptionConfigured(env)) throw new Error('RAIBITSERVER_SECRET_ENCRYPTION_KEY must be at least 32 characters for production Prisma persistence');
  }
  return { kind, production };
}

export async function createControlPlaneRepository(options: Record<string, any> = {}) {
  const env = options.env || process.env;
  const { kind } = resolveControlPlaneRepositoryConfig(options, env);
  if (kind === 'prisma') {
    return PrismaControlPlaneRepository.connect(options);
  }
  return new InMemoryControlPlaneRepository(options.store);
}

function slugInput(value: any) {
  return String(value || 'item').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function serviceData(input: Record<string, any>) {
  return {
    type: input.type || 'web',
    runtimeType: input.runtimeType || 'container',
    sourceType: input.sourceType || 'github',
    buildMode: input.buildMode || 'AUTO',
    repoUrl: input.repoUrl || null,
    githubRepositoryId: input.githubRepositoryId || null,
    branch: input.branch || null,
    rootDirectory: input.rootDirectory || null,
    buildContext: input.buildContext || null,
    dockerfilePath: input.dockerfilePath || null,
    installCommand: input.installCommand || null,
    buildCommand: input.buildCommand || null,
    startCommand: input.startCommand || null,
    outputDirectory: input.outputDirectory || null,
    image: input.image || null,
    imageUrl: input.imageUrl || input.image || null,
    port: input.port ? Number(input.port) : null,
    status: input.status || 'created',
    desiredSpec: sanitizeJson(input.desiredSpec || input),
    desiredState: sanitizeJson(input),
  };
}

function resourceData(input: Record<string, any>) {
  return {
    slug: input.slug || slugInput(input.name),
    type: input.type || 'database',
    engine: input.engine,
    provider: input.provider || 'kubernetes-operator',
    plan: input.plan || 'shared-small',
    region: input.region || 'local',
    version: input.version || null,
    status: input.status || 'provisioning',
    desiredSpec: sanitizeJson(input.desiredSpec || input),
    desiredState: sanitizeJson(input),
    connectionSecretName: input.connectionSecretName || null,
  };
}

function deploymentData(input: Record<string, any>) {
  if (!input.projectId) throw new Error('projectId is required for deployment persistence');
  return {
    serviceId: input.serviceId,
    projectId: input.projectId,
    commitSha: input.commitSha || input.commitHash || null,
    commitHash: input.commitHash || input.commitSha || null,
    imageUrl: input.imageUrl || input.image || null,
    imageDigest: input.imageDigest || null,
    status: input.status || 'queued',
    deploymentType: input.deploymentType || 'production',
    triggerType: input.triggerType || 'manual',
    branch: input.branch || 'main',
    pullRequestNumber: input.pullRequestNumber ? Number(input.pullRequestNumber) : null,
    previewUrl: input.previewUrl || null,
    errorCode: input.errorCode || null,
    errorMessage: input.errorMessage || null,
  };
}


function workflowJobData(input: Record<string, any>) {
  return {
    type: input.type || 'build-and-deploy',
    status: input.status || 'queued',
    targetType: input.targetType || 'deployment',
    targetId: input.targetId || input.deploymentId || input.serviceId,
    payload: sanitizeJson(input.payload || {}),
    attempts: Number(input.attempts || 0),
    maxAttempts: Number(input.maxAttempts || 3),
    runAfter: input.runAfter ? new Date(input.runAfter) : new Date(),
    lockedBy: input.lockedBy || null,
    lockedAt: input.lockedAt ? new Date(input.lockedAt) : null,
  };
}

function sanitizeJson(value: Record<string, any>) {
  return JSON.parse(JSON.stringify(maskSecrets(value)));
}

function envVariableData(input: Record<string, any>) {
  const isSecret = input.isSecret === true;
  return {
    projectId: input.projectId,
    serviceId: input.serviceId,
    key: input.key,
    value: isSecret ? null : String(input.value ?? ''),
    isSecret,
    valueMasked: input.valueMasked || (isSecret ? '****' : String(input.value ?? '')),
    secretRef: input.secretRef || input.secretId || null,
    source: input.source || 'api',
  };
}

function maskEnvRow(row: Record<string, any>) {
  return {
    key: row.key,
    isSecret: row.isSecret === true,
    value: row.isSecret ? undefined : row.value,
    valueMasked: row.valueMasked || (row.isSecret ? '****' : String(row.value ?? '')),
    source: row.source || 'api',
    updatedAt: row.updatedAt || null,
  };
}

function redactUser(user: Record<string, any>) {
  const { passwordHash, ...rest } = user;
  return rest;
}

function quotaData(input: Record<string, any>) {
  const keys = ['maxProjects','maxServices','maxDeploymentsPerDay','maxPreviewDeployments','maxCpuMillicores','maxMemoryMb','maxDbStorageMb','maxObjectStorageMb','maxBuildMinutesPerMonth','maxRuntimeHoursPerMonth'];
  return Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, Number(input[key])]));
}
