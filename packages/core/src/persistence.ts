import { ControlPlaneStore } from './store.ts';
import { deepClone } from './ids.ts';
import { maskSecrets } from './secrets.ts';

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
  async getService(serviceId: string) { return this.store.services.get(serviceId) || null; }
  async upsertServiceEnvironment(input: Record<string, any>) { return this.store.upsertServiceEnvironment(input); }
  async importServiceEnvFile(input: Record<string, any>) { return this.store.importServiceEnvFile(input); }
  async listServiceEnvironment(input: Record<string, any>) { return this.store.listServiceEnvironment(input); }
  async createGitHubIntegration(input: Record<string, any>) { return this.store.createGitHubIntegration(input); }
  async listGitHubIntegrations(input: Record<string, any>) { return this.store.listGitHubIntegrations(input); }
  async attachGitHubRepositoryToService(input: Record<string, any>) { return this.store.attachGitHubRepositoryToService(input); }
  async enqueueWorkflowJob(input: Record<string, any>) { return this.store.enqueueWorkflowJob(input); }
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
      update: { name: input.name, githubId: input.githubId || null, passwordHash: input.passwordHash || undefined },
      create: { name: input.name, email: input.email, githubId: input.githubId || null, passwordHash: input.passwordHash || null },
    });
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: String(email || '').toLowerCase() } });
  }

  async addMember(input: Record<string, any>) {
    return this.prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
      update: { role: input.role || 'developer' },
      create: { organizationId: input.organizationId, userId: input.userId, role: input.role || 'developer' },
    });
  }

  async listMembershipsForUser(userId: string) {
    return this.prisma.organizationMember.findMany({ where: { userId } });
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
      create: { projectId: input.projectId, name: input.name, ...resourceData(input) },
    });
  }

  async createDeployment(input: Record<string, any>) {
    return this.prisma.deployment.create({ data: deploymentData(input) });
  }

  async createDeploymentWorkflow(input: Record<string, any>) {
    return this.prisma.$transaction(async (tx: any) => {
      const deployment = await tx.deployment.create({ data: deploymentData(input.deployment || input) });
      const workflowJob = await tx.workflowJob.create({ data: workflowJobData({
        ...(input.workflow || {}),
        targetType: 'deployment',
        targetId: deployment.id,
        payload: { ...(input.workflow?.payload || {}), deploymentId: deployment.id },
      }) });
      return { deployment, workflowJob };
    });
  }

  async getService(serviceId: string) {
    return this.prisma.service.findUnique({ where: { id: serviceId } });
  }

  async upsertServiceEnvironment(input: Record<string, any>) {
    const rows = [];
    for (const entry of input.entries || []) {
      const data = envVariableData({ ...entry, projectId: input.projectId, serviceId: input.serviceId, source: entry.source || input.source || 'api' });
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
    const row = await this.prisma.githubIntegration.create({
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
    const [organizations, users, members, projects, services, resources, deployments, auditLogs, usageRecords, workflowJobs] = await Promise.all([
      this.prisma.organization.findMany(),
      this.prisma.user.findMany(),
      this.prisma.organizationMember.findMany(),
      this.prisma.project.findMany(),
      this.prisma.service.findMany(),
      this.prisma.resource.findMany(),
      this.prisma.deployment.findMany(),
      this.prisma.auditLog.findMany(),
      this.prisma.usageRecord.findMany(),
      this.prisma.workflowJob.findMany(),
    ]);
    const [environmentVariables, githubIntegrations] = await Promise.all([
      this.prisma.environmentVariable.findMany(),
      this.prisma.githubIntegration.findMany(),
    ]);
    return deepClone({ organizations, users: users.map(redactUser), members, projects, services, resources, deployments, auditLogs, usageRecords, workflowJobs, environmentVariables: environmentVariables.map(maskEnvRow), githubIntegrations });
  }
}

export async function createControlPlaneRepository(options: Record<string, any> = {}) {
  if ((options.kind || process.env.RAIBITSERVER_PERSISTENCE) === 'prisma') {
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
    buildMode: input.buildMode || null,
    repoUrl: input.repoUrl || null,
    branch: input.branch || null,
    imageUrl: input.imageUrl || input.image || null,
    port: input.port ? Number(input.port) : null,
    status: input.status || 'created',
    desiredState: sanitizeJson(input),
  };
}

function resourceData(input: Record<string, any>) {
  return {
    type: input.type || 'database',
    engine: input.engine,
    provider: input.provider || 'kubernetes-operator',
    plan: input.plan || 'shared-small',
    region: input.region || 'local',
    status: input.status || 'provisioning',
    desiredState: sanitizeJson(input),
  };
}

function deploymentData(input: Record<string, any>) {
  return {
    serviceId: input.serviceId,
    commitHash: input.commitHash || input.commitSha || null,
    imageUrl: input.imageUrl || input.image || null,
    status: input.status || 'queued',
    deploymentType: input.deploymentType || 'production',
    branch: input.branch || 'main',
    previewUrl: input.previewUrl || null,
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
