import { ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import type { ProjectSpec, ServiceSpec, ResourceSpec } from '@raibitserver/schemas';
import { createControlPlaneRepository, createSessionToken, hashPassword, normalizeEmail, organizationScopeFromProjectInput, personalOrganizationSlug, requireScope, validateServiceSecurity, verifyPassword, type InMemoryControlPlaneRepository, type PrismaControlPlaneRepository } from '@raibitserver/core';

/**
 * NestJS-facing desired-state service.
 *
 * Production rule: the API stores desired state in PostgreSQL via Prisma and
 * enqueues durable workflow jobs; Go services reconcile Kubernetes/build/resource
 * actual state asynchronously. Local/dev can keep the same in-memory repository
 * instance for deterministic tests without split-brain state.
 */
@Injectable()
export class RAIBITSERVERService implements OnModuleDestroy {
  private readonly repositoryPromise: Promise<InMemoryControlPlaneRepository | PrismaControlPlaneRepository>;

  constructor() {
    this.repositoryPromise = createControlPlaneRepository({ kind: process.env.RAIBITSERVER_PERSISTENCE || 'memory' });
  }

  async onModuleDestroy() {
    const repository = await this.repositoryPromise;
    if ('disconnect' in repository) await repository.disconnect();
  }

  async signup(input: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    const jwtSecret = jwtSecretOrThrow();
    const email = normalizeEmail(input.email);
    const existing = repository.findUserByEmail ? await repository.findUserByEmail(email) : repository.store.findUserByEmail(email);
    if (existing) throw new ForbiddenException('user already exists');
    const organizationSlug = input.organizationSlug || personalOrganizationSlug(email);
    const existingOrganization = repository.findOrganizationBySlug ? await repository.findOrganizationBySlug(organizationSlug) : repository.store.findOrganizationBySlug(organizationSlug);
    if (existingOrganization) throw new ForbiddenException('organization slug already exists');
    const organization = await repository.createOrganization({ name: input.organizationName || organizationSlug, slug: organizationSlug, plan: input.plan || 'free' });
    const adminEmails = String(process.env.ADMIN_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
    const user = await repository.createUser({
      name: input.name || email,
      email,
      passwordHash: hashPassword(input.password),
      role: adminEmails.includes(email) ? 'ADMIN' : 'USER',
      accountType: adminEmails.includes(email) ? (input.accountType || (input.plan === 'club' ? 'CLUB_MEMBER' : 'NON_CLUB')) : 'NON_CLUB',
      approvalStatus: adminEmails.includes(email) ? (input.approvalStatus || 'APPROVED') : 'PENDING',
    });
    const membership = await repository.addMember({ organizationId: organization.id, userId: user.id, role: 'owner' });
    const token = createSessionToken({ ...user, email }, [membership], jwtSecret, { issuer: process.env.RAIBITSERVER_AUTH_ISSUER || 'raibitserver', expiresInSeconds: input.expiresInSeconds || 3600 });
    return { user, organization, membership, token };
  }

  async login(input: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    const jwtSecret = jwtSecretOrThrow();
    const user = repository.findUserByEmail ? await repository.findUserByEmail(normalizeEmail(input.email)) : repository.store.findUserByEmail(normalizeEmail(input.email));
    if (!user || !verifyPassword(input.password, user.passwordHash)) throw new ForbiddenException('invalid credentials');
    const memberships = repository.listMembershipsForUser ? await repository.listMembershipsForUser(user.id) : repository.store.listMembershipsForUser(user.id);
    const token = createSessionToken(user, memberships, jwtSecret, { issuer: process.env.RAIBITSERVER_AUTH_ISSUER || 'raibitserver', expiresInSeconds: input.expiresInSeconds || 3600 });
    const { passwordHash, ...publicUser } = user;
    return { user: publicUser, memberships, token };
  }

  async createProject(project: ProjectSpec, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    const projectInput = project as any;
    const organizationId = organizationScopeFromProjectInput(projectInput, subject);
    enforceScope(subject, { organizationId });
    if (repository.enforceUserCan) await repository.enforceUserCan({ userId: subject.id, action: 'project:create', metric: 'maxProjects', increment: 1 });
    if (repository.writeDesiredProject) return repository.writeDesiredProject(projectInput);
    const organization = repository.store.organizations.get(organizationId)
      ? repository.store.organizations.get(organizationId)
      : await repository.createOrganization({ name: organizationId, slug: organizationId, plan: projectInput.organization?.plan || 'free' });
    const row = await repository.createProject({ organizationId: organization.id || organizationId, name: project.name, slug: project.slug, description: project.description || '' });
    for (const service of project.services || []) await repository.createService({ ...service, projectId: row.id });
    for (const resource of project.resources || []) await repository.createResource({ ...resource, projectId: row.id });
    return row;
  }

  async listProjects(subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    const snapshot = await repository.snapshot();
    if (isGlobalSubject(subject)) return snapshot.projects;
    const organizationIds = new Set([subject.organizationId, ...(subject.organizationIds || [])].filter(Boolean).map(String));
    if (!organizationIds.size) return [];
    return snapshot.projects.filter((project: Record<string, any>) => organizationIds.has(String(project.organizationId)));
  }

  async addService(projectId: string, service: ServiceSpec, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    if (repository.enforceUserCan) await repository.enforceUserCan({ userId: subject.id, action: 'service:create', metric: 'maxServices', increment: 1 });
    return repository.createService({ ...service, projectId });
  }

  async addResource(projectId: string, resource: ResourceSpec, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    if (repository.enforceUserCan) await repository.enforceUserCan({ userId: subject.id, action: 'resource:create', metric: String((resource as any).type || '').toLowerCase() === 'storage' ? 'maxObjectStorageMb' : 'maxDbStorageMb', increment: Number((resource as any).storageMb || (resource as any).storageGb || 1) });
    return repository.createResource({ ...resource, projectId });
  }

  async createDeployment(projectId: string, serviceId: string, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    const service = await repository.getService(serviceId);
    if (!service) throw new NotFoundException(`service not found: ${serviceId}`);
    if (String(service.projectId) !== String(projectId)) throw new ForbiddenException('service does not belong to project');
    if (repository.enforceUserCan) await repository.enforceUserCan({ userId: subject.id, action: 'deployment:create', metric: 'maxDeploymentsPerDay', increment: 1 });
    const security = validateServiceSecurity(service.desiredState || service.desiredSpec || service);
    if (!security.ok) throw new ForbiddenException(`deployment blocked by security policy: ${security.findings.filter((finding: any) => finding.level === 'block').map((finding: any) => finding.code).join(', ')}`);
    const { deployment, workflowJob } = await repository.createDeploymentWorkflow({
      deployment: { serviceId, projectId, status: 'queued', deploymentType: 'production' },
      workflow: { type: 'build-and-deploy', payload: { projectId, serviceId } },
    });
    return {
      ...deployment,
      projectId,
      desiredStateWritten: true,
      workflowJob,
    };
  }

  async listEnvironment(projectId: string, serviceId: string, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    await assertServiceInProject(repository, projectId, serviceId);
    return repository.listServiceEnvironment({ projectId, serviceId });
  }

  async upsertEnvironment(projectId: string, serviceId: string, input: Record<string, any>, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    await assertServiceInProject(repository, projectId, serviceId);
    return repository.upsertServiceEnvironment({ projectId, serviceId, entries: input.entries || input.environment || input, actorUserId: subject.id, source: input.source || 'api' });
  }

  async importEnvironmentFile(projectId: string, serviceId: string, input: Record<string, any>, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    await assertServiceInProject(repository, projectId, serviceId);
    return repository.importServiceEnvFile({ projectId, serviceId, content: input.content || input.text || '', actorUserId: subject.id, source: input.filename || '.env' });
  }


  async currentUser(subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    const snapshot = await repository.snapshot();
    const user = snapshot.users.find((candidate: Record<string, any>) => String(candidate.id) === String(subject.id)) || null;
    const memberships = repository.listMembershipsForUser ? await repository.listMembershipsForUser(subject.id) : [];
    return { user, subject, memberships };
  }

  async approveUser(userId: string, input: Record<string, any>, subject: Record<string, any>) {
    assertAdmin(subject);
    const repository: any = await this.repositoryPromise;
    return repository.approveUser(userId, { ...input, actorUserId: subject.id });
  }

  async rejectUser(userId: string, subject: Record<string, any>) {
    assertAdmin(subject);
    const repository: any = await this.repositoryPromise;
    return repository.rejectUser(userId, { actorUserId: subject.id });
  }

  async setUserQuota(userId: string, input: Record<string, any>, subject: Record<string, any>) {
    assertAdmin(subject);
    const repository: any = await this.repositoryPromise;
    return repository.setQuota({ ...input, userId });
  }

  async connectGitHub(input: Record<string, any>, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    const organizationId = input.organizationId || subject.organizationId;
    enforceScope(subject, { organizationId });
    return repository.createGitHubIntegration({ ...input, organizationId, userId: subject.id });
  }

  async listGitHub(organizationId: string, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    enforceScope(subject, { organizationId });
    return { integrations: await repository.listGitHubIntegrations({ organizationId }) };
  }

  async attachGitHub(projectId: string, serviceId: string, input: Record<string, any>, subject: Record<string, any>) {
    const repository: any = await this.repositoryPromise;
    await assertProjectAccess(repository, projectId, subject);
    await assertServiceInProject(repository, projectId, serviceId);
    return repository.attachGitHubRepositoryToService({ projectId, serviceId, integrationId: input.integrationId, repoUrl: input.repoUrl || input.repository, branch: input.branch || 'main', actorUserId: subject.id });
  }
}

async function assertProjectAccess(repository: any, projectId: string, subject: Record<string, any>) {
  if (isGlobalSubject(subject)) return;
  let projectScopeError: any = null;
  try {
    requireScope(subject, { projectId });
    return;
  } catch (error) {
    projectScopeError = error;
    // Organization-scoped subjects may operate on projects in their organization.
  }
  if (!subject.organizationId && !Array.isArray(subject.organizationIds)) {
    throw new ForbiddenException(projectScopeError instanceof Error ? projectScopeError.message : 'subject scope does not allow this operation');
  }
  const snapshot = await repository.snapshot();
  const project = snapshot.projects.find((candidate: Record<string, any>) => String(candidate.id) === String(projectId));
  if (!project) throw new NotFoundException(`project not found: ${projectId}`);
  enforceScope(subject, { organizationId: project.organizationId });
}

async function assertServiceInProject(repository: any, projectId: string, serviceId: string) {
  const service = await repository.getService(serviceId);
  if (!service) throw new NotFoundException(`service not found: ${serviceId}`);
  if (String(service.projectId) !== String(projectId)) throw new ForbiddenException('service does not belong to project');
  return service;
}

function enforceScope(subject: Record<string, any>, scope: Record<string, any>) {
  try {
    requireScope(subject, scope);
  } catch (error) {
    throw new ForbiddenException(error instanceof Error ? error.message : 'subject scope does not allow this operation');
  }
}

function isGlobalSubject(subject: Record<string, any>) {
  return subject?.global === true || subject?.authMode === 'disabled';
}

function assertAdmin(subject: Record<string, any>) {
  if (subject?.global === true || subject?.role === 'owner' || subject?.userRole === 'ADMIN' || subject?.claims?.userRole === 'ADMIN') return;
  throw new ForbiddenException('admin required');
}

function jwtSecretOrThrow() {
  const secret = process.env.RAIBITSERVER_AUTH_JWT_SECRET;
  if (!secret) throw new Error('RAIBITSERVER_AUTH_JWT_SECRET is required');
  return secret;
}
