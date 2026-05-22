import { ControlPlaneStore } from './store.ts';
import { deepClone, stableId } from './ids.ts';
import { maskSecretValue, maskSecrets } from './secrets.ts';
import { openSecret, sealSecret } from './secret-vault.ts';
import { secretEncryptionConfigured } from './config.ts';
import { runDbConsoleQuery, browseDbConsole } from './db-console.ts';
import { completeWorkflowJobRecord, failWorkflowJobRecord, processNextWorkflowJob } from './workflows.ts';
import { providerOwnedSqlitePath, sanitizeTenantResourceInput } from './resource-sanitizer.ts';

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
  async attachProviderConnectionSecret(input: Record<string, any>) { return this.store.attachProviderConnectionSecret(input); }
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
  async claimNextWorkflowJob(input: Record<string, any> = {}) { return this.store.claimNextWorkflowJob(input); }
  async completeWorkflowJob(jobId: string, result: any = {}, options: Record<string, any> = {}) { return this.store.completeWorkflowJob(jobId, result, options); }
  async failWorkflowJob(jobId: string, error: any, options: Record<string, any> = {}) { return this.store.failWorkflowJob(jobId, error, options); }
  async processNextWorkflowJob(handlers: Record<string, any>, options: Record<string, any> = {}) { return this.store.processNextWorkflowJob(handlers, options); }
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
    const existing = await this.prisma.resource.findUnique({
      where: { projectId_name: { projectId: input.projectId, name: input.name } },
      select: { connectionSecretName: true },
    }).catch(() => null);
    return this.prisma.resource.upsert({
      where: { projectId_name: { projectId: input.projectId, name: input.name } },
      update: resourceData(input, { connectionSecretName: existing?.connectionSecretName || null }),
      create: { projectId: input.projectId, name: input.name, slug: input.slug || slugInput(input.name), ...resourceData(input) },
    });
  }

  async attachProviderConnectionSecret({ resourceId, databaseUrl, connectionUrl, actorUserId = 'provider' }: Record<string, any>) {
    const value = databaseUrl || connectionUrl;
    if (!value) throw new Error('provider connection URL is required');
    const secret = await this.prisma.secretValue.upsert({
      where: { scopeType_scopeId_key: { scopeType: 'resource-provider-connection', scopeId: resourceId, key: 'DATABASE_URL' } },
      update: { sealedValue: sealSecret(value), valueMasked: maskSecretValue(value), metadata: maskSecrets({ providerOwned: true }) },
      create: { scopeType: 'resource-provider-connection', scopeId: resourceId, key: 'DATABASE_URL', sealedValue: sealSecret(value), valueMasked: maskSecretValue(value), metadata: maskSecrets({ providerOwned: true }) },
    });
    const resource = await this.prisma.resource.update({ where: { id: resourceId }, data: { connectionSecretName: secret.id } });
    await this.prisma.auditLog.create({ data: { actorUserId, action: 'resource.provider-connection:attach', targetType: 'resource', targetId: resourceId, metadata: maskSecrets({ connectionSecretName: secret.id }) } });
    return resource;
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

  async claimNextWorkflowJob(options: Record<string, any> = {}) {
    const now = new Date(options.now || Date.now());
    const leaseMs = Number(options.leaseMs ?? (Number(options.leaseSeconds || 300) * 1000));
    const expiredBefore = new Date(now.getTime() - leaseMs);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const job = await this.prisma.workflowJob.findFirst({
        where: {
          status: 'queued',
          runAfter: { lte: now },
          OR: [{ lockedAt: null }, { lockedAt: { lte: expiredBefore } }],
        },
        orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
      });
      if (!job) return null;
      const updated = await this.prisma.workflowJob.updateMany({
        where: {
          id: job.id,
          status: 'queued',
          runAfter: { lte: now },
          OR: [{ lockedAt: null }, { lockedAt: { lte: expiredBefore } }],
        },
        data: {
          status: 'running',
          attempts: { increment: 1 },
          lockedBy: options.workerId || options.worker || 'workflow-worker',
          lockedAt: now,
        },
      });
      if (updated.count === 1) return this.prisma.workflowJob.findUnique({ where: { id: job.id } });
    }
    return null;
  }

  async completeWorkflowJob(jobId: string, result: any = {}, options: Record<string, any> = {}) {
    const current = await this.prisma.workflowJob.findUnique({ where: { id: jobId } });
    if (!current) throw new Error(`workflow job not found: ${jobId}`);
    const next = options.record || completeWorkflowJobRecord(current, result, options);
    return this.prisma.workflowJob.update({
      where: { id: jobId },
      data: prismaWorkflowJobUpdateData(next),
    });
  }

  async failWorkflowJob(jobId: string, error: any, options: Record<string, any> = {}) {
    const current = await this.prisma.workflowJob.findUnique({ where: { id: jobId } });
    if (!current) throw new Error(`workflow job not found: ${jobId}`);
    const next = options.record || failWorkflowJobRecord(current, error, options);
    return this.prisma.workflowJob.update({
      where: { id: jobId },
      data: prismaWorkflowJobUpdateData(next),
    });
  }

  async processNextWorkflowJob(handlers: Record<string, any>, options: Record<string, any> = {}) {
    return processNextWorkflowJob(this, handlers, options);
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
    const quota = await this.prisma.quota.findFirst({ where: { userId: input.userId, accountType: user.accountType || 'NON_CLUB' } })
      || await this.setQuota({ userId: input.userId, accountType: user.accountType || 'NON_CLUB' });
    if (input.metric && quota[input.metric] !== undefined) {
      const current = (await this.quotaUsageForUser(input.userId))[input.metric] || 0;
      const requested = current + Number(input.increment || 0);
      if (requested > Number(quota[input.metric])) {
        await this.prisma.auditLog.create({ data: { actorUserId: input.userId, action: 'quota:block', targetType: input.action || 'action', targetId: input.metric, metadata: { current, increment: Number(input.increment || 0), limit: quota[input.metric] } } });
        const error = new Error(`quota exceeded: ${input.metric} (${requested}/${quota[input.metric]})`);
        (error as any).statusCode = 403;
        throw error;
      }
    }
    return true;
  }

  async quotaUsageForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({ where: { userId }, select: { organizationId: true } });
    const organizationIds = memberships.map((membership: Record<string, any>) => membership.organizationId);
    if (organizationIds.length === 0) return {};
    const projects = await this.prisma.project.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } });
    const projectIds = projects.map((project: Record<string, any>) => project.id);
    if (projectIds.length === 0) {
      return { maxProjects: 0, maxServices: 0, maxDeploymentsPerDay: 0, maxPreviewDeployments: 0, maxDbStorageMb: 0, maxObjectStorageMb: 0 };
    }
    const serviceIds = (await this.prisma.service.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } })).map((service: Record<string, any>) => service.id);
    const resources = await this.prisma.resource.findMany({ where: { projectId: { in: projectIds } }, select: { type: true, engine: true, desiredSpec: true, desiredState: true } });
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    const deployments = serviceIds.length === 0 ? [] : await this.prisma.deployment.findMany({ where: { serviceId: { in: serviceIds }, createdAt: { gte: start, lt: end } }, select: { deploymentType: true } });
    return {
      maxProjects: projects.length,
      maxServices: serviceIds.length,
      maxDeploymentsPerDay: deployments.length,
      maxPreviewDeployments: deployments.filter((deployment: Record<string, any>) => deployment.deploymentType === 'preview').length,
      maxDbStorageMb: resources.filter((resource: Record<string, any>) => resourceQuotaMetric(resource) === 'maxDbStorageMb').reduce((sum: number, resource: Record<string, any>) => sum + resourceStorageMb(resource), 0),
      maxObjectStorageMb: resources.filter((resource: Record<string, any>) => resourceQuotaMetric(resource) === 'maxObjectStorageMb').reduce((sum: number, resource: Record<string, any>) => sum + resourceStorageMb(resource), 0),
    };
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
    const result = await runDbConsoleQuery(await this.resourceForConsole(resource), query, options);
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
    return browseDbConsole(await this.resourceForConsole(resource), options);
  }

  async resourceForConsole(resource: Record<string, any>) {
    if (!resource.connectionSecretName) return resource;
    const secret = await this.prisma.secretValue.findUnique({ where: { id: resource.connectionSecretName } });
    if (!isProviderConnectionSecret(secret, resource.id)) return resource;
    if (!secret?.sealedValue) return resource;
    return { ...resource, providerConnection: { databaseUrl: openSecret(secret.sealedValue) } };
  }

  async writeDesiredProject(projectSpec: Record<string, any>) {
    const orgInput = projectSpec.organization || null;
    const requestedOrganizationId = projectSpec.organizationId || projectSpec.orgId || null;
    return this.prisma.$transaction(async (tx: any) => {
      const organization = await resolveDesiredOrganization(tx, orgInput, requestedOrganizationId, projectSpec.organizationSlug);
      const projectInput = projectSpec.project || { name: projectSpec.name || projectSpec.slug || 'project', slug: projectSpec.slug || projectSpec.name || 'project', description: projectSpec.description || '' };
      const projectSlug = projectInput.slug || slugInput(projectInput.name);
      const project = await tx.project.upsert({
        where: { organizationId_slug: { organizationId: organization.id, slug: projectSlug } },
        update: { name: projectInput.name || projectSlug, description: projectInput.description || '', status: projectInput.status || 'active' },
        create: { organizationId: organization.id, name: projectInput.name || projectSlug, slug: projectSlug, description: projectInput.description || '', status: projectInput.status || 'active' },
      });
      const services = [];
      for (const service of projectSpec.services || []) {
        services.push(await tx.service.upsert({
          where: { projectId_slug: { projectId: project.id, slug: service.slug || slugInput(service.name) } },
          update: serviceData({ ...service, projectId: project.id }),
          create: { projectId: project.id, name: service.name, slug: service.slug || slugInput(service.name), ...serviceData({ ...service, projectId: project.id }) },
        }));
      }
      const resources = [];
      for (const resource of projectSpec.resources || []) {
        const existing = typeof tx.resource.findUnique === 'function'
          ? await tx.resource.findUnique({
            where: { projectId_name: { projectId: project.id, name: resource.name } },
            select: { connectionSecretName: true },
          }).catch(() => null)
          : null;
        resources.push(await tx.resource.upsert({
          where: { projectId_name: { projectId: project.id, name: resource.name } },
          update: resourceData({ ...resource, projectId: project.id }, { connectionSecretName: existing?.connectionSecretName || null }),
          create: { projectId: project.id, name: resource.name, ...resourceData({ ...resource, projectId: project.id }) },
        }));
      }
      await tx.auditLog.create({ data: { actorUserId: 'system', action: 'desired-state:write', targetType: 'project', targetId: project.id, metadata: maskSecrets(projectSpec) } });
      return { organization, project, services, resources };
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

async function resolveDesiredOrganization(tx: any, orgInput: Record<string, any> | null, requestedOrganizationId: any, organizationSlug: any) {
  if (requestedOrganizationId) {
    const byId = await tx.organization.findUnique({ where: { id: String(requestedOrganizationId) } });
    if (byId) return byId;
    const bySlug = await tx.organization.findUnique({ where: { slug: slugInput(requestedOrganizationId) } });
    if (bySlug) return bySlug;
    const error = new Error(`organization not found: ${requestedOrganizationId}`);
    (error as any).statusCode = 404;
    throw error;
  }
  const desired = orgInput || { name: organizationSlug || 'default', slug: organizationSlug || 'default', plan: 'free' };
  return tx.organization.upsert({
    where: { slug: desired.slug || slugInput(desired.name) },
    update: { name: desired.name || desired.slug, plan: desired.plan || 'free' },
    create: { name: desired.name || desired.slug, slug: desired.slug || slugInput(desired.name), plan: desired.plan || 'free' },
  });
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

function resourceData(input: Record<string, any>, options: Record<string, any> = {}) {
  const safe = sanitizeTenantResourceInput(input);
  const sqlitePath = String(safe.engine || '').toLowerCase() === 'sqlite' ? providerOwnedSqlitePath(stableId('res', safe.projectId, safe.name)) : null;
  const desiredSpec = sqlitePath ? { ...(safe.desiredSpec || {}), sqlitePath } : (safe.desiredSpec || safe);
  const desiredState = sqlitePath ? { ...safe, desiredSpec, sqlitePath } : safe;
  return {
    slug: safe.slug || slugInput(safe.name),
    type: safe.type || 'database',
    engine: safe.engine,
    provider: safe.provider || 'kubernetes-operator',
    plan: safe.plan || 'shared-small',
    region: safe.region || 'local',
    version: safe.version || null,
    status: safe.status || 'provisioning',
    desiredSpec: sanitizeJson(desiredSpec),
    desiredState: sanitizeJson(desiredState),
    connectionSecretName: options.connectionSecretName || undefined,
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

function prismaWorkflowJobUpdateData(input: Record<string, any>) {
  return {
    status: input.status,
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

function isProviderConnectionSecret(secret: any, resourceId: string) {
  return secret
    && secret.scopeType === 'resource-provider-connection'
    && String(secret.scopeId) === String(resourceId)
    && secret.key === 'DATABASE_URL';
}

function resourceQuotaMetric(resource: Record<string, any>) {
  return String(resource?.type || '').toLowerCase() === 'storage' || String(resource?.engine || '').toLowerCase().includes('object') ? 'maxObjectStorageMb' : 'maxDbStorageMb';
}

function resourceStorageMb(resource: Record<string, any>) {
  const spec = { ...(resource.desiredSpec || {}), ...(resource.desiredState || {}), ...resource };
  if (spec.storageMb !== undefined) return Number(spec.storageMb || 0);
  if (spec.storageGb !== undefined) return Number(spec.storageGb || 0) * 1024;
  return 1;
}

function quotaData(input: Record<string, any>) {
  const keys = ['maxProjects','maxServices','maxDeploymentsPerDay','maxPreviewDeployments','maxCpuMillicores','maxMemoryMb','maxDbStorageMb','maxObjectStorageMb','maxBuildMinutesPerMonth','maxRuntimeHoursPerMonth'];
  return Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, Number(input[key])]));
}
