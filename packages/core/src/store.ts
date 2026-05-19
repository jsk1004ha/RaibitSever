import { deepClone, nowIso, stableId, slugify } from './ids.ts';
import { maskSecrets } from './secrets.ts';

export class ControlPlaneStore {
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
  }

  createOrganization({ name, slug, plan = 'free' }) {
    const org = { id: stableId('org', slug || name), name, slug: slugify(slug || name), plan, createdAt: nowIso() };
    this.organizations.set(org.id, org);
    this.audit('system', 'organization:create', 'organization', org.id, { slug: org.slug, plan });
    return deepClone(org);
  }

  createUser({ name, email, githubId = null }) {
    const user = { id: stableId('usr', email || name), name, email, githubId, createdAt: nowIso() };
    this.users.set(user.id, user);
    return deepClone(user);
  }

  addMember({ organizationId, userId, role = 'developer' }) {
    const member = { organizationId, userId, role, createdAt: nowIso() };
    this.members.push(member);
    this.audit(userId, 'organization.member:add', 'organization', organizationId, { role });
    return deepClone(member);
  }

  createProject({ organizationId, name, slug, description = '', status = 'active' }) {
    const project = { id: stableId('prj', organizationId, slug || name), organizationId, name, slug: slugify(slug || name), description, status, createdAt: nowIso() };
    this.projects.set(project.id, project);
    this.audit('system', 'project:create', 'project', project.id, { organizationId, slug: project.slug });
    return deepClone(project);
  }

  createService({ projectId, name, type = 'web', runtimeType = 'container', sourceType = 'github', ...rest }) {
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

  createResource({ projectId, name, type = 'database', engine, provider = 'kubernetes-operator', plan = 'shared-small', region = 'local', status = 'provisioning', ...rest }) {
    const resource = { id: stableId('res', projectId, name), projectId, type, name, engine, provider, status, plan, region, createdAt: nowIso(), ...rest };
    this.resources.set(resource.id, resource);
    this.audit('system', 'resource:create', 'resource', resource.id, { projectId, engine, provider });
    return deepClone(resource);
  }

  createDeployment({ serviceId, commitHash = null, imageUrl, status = 'queued', deploymentType = 'production', branch = 'main', previewUrl = null }) {
    const deployment = { id: stableId('dep', serviceId, commitHash || imageUrl || Date.now()), serviceId, commitHash, imageUrl, status, deploymentType, branch, previewUrl, startedAt: nowIso(), finishedAt: null };
    this.deployments.set(deployment.id, deployment);
    this.audit('system', 'deployment:create', 'deployment', deployment.id, { serviceId, status });
    return deepClone(deployment);
  }

  attachDomain({ projectId, serviceId, domain, verified = false, tlsStatus = 'pending' }) {
    const row = { id: stableId('dom', domain), projectId, serviceId, domain, verified, tlsStatus, createdAt: nowIso() };
    this.domains.set(row.id, row);
    return deepClone(row);
  }

  recordUsage(record) {
    const row = { id: stableId('use', record.organizationId, record.metric, Date.now()), ...record, recordedAt: record.recordedAt || nowIso() };
    this.usageRecords.push(row);
    return deepClone(row);
  }

  audit(actorUserId, action, targetType, targetId, metadata = {}) {
    const row = { id: stableId('aud', action, targetId, Date.now(), this.auditLogs.length), actorUserId, action, targetType, targetId, metadata: maskSecrets(metadata), createdAt: nowIso() };
    this.auditLogs.push(row);
    return deepClone(row);
  }

  snapshot() {
    return deepClone({
      organizations: [...this.organizations.values()],
      users: [...this.users.values()],
      members: this.members,
      projects: [...this.projects.values()],
      services: [...this.services.values()],
      deployments: [...this.deployments.values()],
      resources: [...this.resources.values()],
      domains: [...this.domains.values()],
      usageRecords: this.usageRecords,
      auditLogs: this.auditLogs,
    });
  }
}
