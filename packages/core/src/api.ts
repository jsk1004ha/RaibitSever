import { RAIBITSERVERControlPlane } from './control-plane.ts';
import { maskSecrets } from './secrets.ts';
import { authorizeRequest, requireAction, requireScope, signJwtHs256, subjectFromRequest } from './auth.ts';
import { organizationScopeFromProjectInput } from './scope.ts';
import { createSessionToken, hashPassword, normalizeEmail, personalOrganizationSlug, verifyPassword } from './identity.ts';
import { runtimeConfigStatus } from './config.ts';

export function createApiHandler(controlPlane = new RAIBITSERVERControlPlane(), options: Record<string, any> = {}) {
  const auth = options.auth || authConfigFromEnv();
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const method = req.method || 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok', service: 'raibitserver-control-plane', auth: auth.mode || 'jwt' });
      }
      if (method === 'GET' && url.pathname === '/catalog') {
        return send(res, 200, { resources: controlPlane.catalog() });
      }
      if (method === 'GET' && url.pathname === '/config/runtime') {
        authorizeRequest(req, 'audit:read', auth);
        return send(res, 200, { keys: runtimeConfigStatus(process.env) });
      }
      if (method === 'POST' && url.pathname === '/auth/signup') {
        const body = await readJson(req);
        if (!auth.jwtSecret) return send(res, 500, { error: 'jwt_secret_not_configured' });
        const email = normalizeEmail(body.email);
        if (controlPlane.store.findUserByEmail(email)) return send(res, 409, { error: 'user_already_exists' });
        const organizationSlug = body.organizationSlug || body.orgSlug || personalOrganizationSlug(email);
        if (controlPlane.store.findOrganizationBySlug(organizationSlug)) return send(res, 409, { error: 'organization_slug_already_exists' });
        const organization = controlPlane.store.createOrganization({ name: body.organizationName || organizationSlug, slug: organizationSlug, plan: body.plan || 'free' });
        const user = controlPlane.store.createUser({ name: body.name || email, email, passwordHash: hashPassword(body.password) });
        const membership = controlPlane.store.addMember({ organizationId: organization.id, userId: user.id, role: 'owner' });
        const token = createSessionToken({ ...user, email }, [membership], auth.jwtSecret, { issuer: auth.issuer || 'raibitserver', expiresInSeconds: body.expiresInSeconds || 3600 });
        return send(res, 201, { user, organization, membership, token });
      }
      if (method === 'POST' && url.pathname === '/auth/login') {
        const body = await readJson(req);
        if (!auth.jwtSecret) return send(res, 500, { error: 'jwt_secret_not_configured' });
        const user = controlPlane.store.findUserByEmail(normalizeEmail(body.email));
        if (!user || !verifyPassword(body.password, user.passwordHash)) return send(res, 401, { error: 'invalid_credentials' });
        const memberships = controlPlane.store.listMembershipsForUser(user.id);
        const token = createSessionToken(user, memberships, auth.jwtSecret, { issuer: auth.issuer || 'raibitserver', expiresInSeconds: body.expiresInSeconds || 3600 });
        const { passwordHash, ...publicUser } = user;
        return send(res, 200, { user: publicUser, memberships, token });
      }
      if (method === 'POST' && url.pathname === '/auth/dev-token') {
        const body = await readJson(req);
        if (!auth.jwtSecret) return send(res, 400, { error: 'jwt_secret_not_configured' });
        if (!auth.allowDevToken) authorizeRequest(req, 'team:invite', auth);
        const token = signJwtHs256({ sub: body.sub || 'dev-user', role: body.role || 'developer', organizationId: body.organizationId || null, projectIds: body.projectIds || null, global: body.global === true }, auth.jwtSecret, { expiresInSeconds: body.expiresInSeconds || 3600, issuer: auth.issuer || 'raibitserver' });
        return send(res, 201, { token });
      }
      if (method === 'GET' && url.pathname === '/snapshot') {
        authorizeRequest(req, 'audit:read', auth);
        return send(res, 200, maskSecrets(controlPlane.store.snapshot()));
      }
      if (method === 'POST' && url.pathname === '/plan/build') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.planBuild(body.service || body, body.files || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/source') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.planSourceCheckout(body.service || body, body.options || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/build-execution') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.planBuildExecution(body.service || body, body.files || {}, body.options || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/registry-push') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.planRegistryPush(body.image));
      }
      if (method === 'POST' && url.pathname === '/plan/kubernetes-apply') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.planKubernetesApply(projectSpecFromBody(body), body.filesByService || {}, body.options || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/provisioning') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.planProvisioning(projectSpecFromBody(body)));
      }
      if (method === 'POST' && url.pathname === '/plan/compose') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.importCompose(body.compose || body.text || '', body.options || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/manifests') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.compileManifests(projectSpecFromBody(body), body.filesByService || {}));
      }
      if (method === 'POST' && url.pathname === '/validate') {
        authorizeRequest(req, 'project:read', auth);
        const body = await readJson(req);
        return send(res, 200, controlPlane.validateProject(projectSpecFromBody(body)));
      }
      if (method === 'POST' && url.pathname === '/guard/query') {
        const body = await readJson(req);
        const subject = authorizeRequest(req, body.options?.confirmed ? 'db:query' : 'db:connect', auth, body.options?.scope || {});
        return send(res, 200, controlPlane.guardQuery(body.query, { role: subject.role, ...(body.options || {}) }));
      }
      if (method === 'POST' && url.pathname === '/organizations') {
        authorizeRequest(req, 'team:invite', auth);
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createOrganization(body));
      }
      if (method === 'GET' && url.pathname === '/projects') {
        const subject = authorizeAction(req, 'project:read', auth);
        const projects = [...controlPlane.store.projects.values()].filter((project) => subject.global === true || subject.authMode === 'disabled' || matchesSubjectOrganization(subject, project.organizationId));
        return send(res, 200, { projects });
      }
      if (method === 'POST' && url.pathname === '/projects') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'project:create', auth);
        const organizationId = organizationScopeFromProjectInput(body, subject);
        requireScope(subject, { organizationId });
        return send(res, 201, controlPlane.store.createProject({ ...body, organizationId }));
      }
      if (method === 'POST' && url.pathname === '/services') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'deploy:run', auth);
        await assertProjectAccess(controlPlane.store, body.projectId, subject);
        return send(res, 201, controlPlane.store.createService(body));
      }
      if (method === 'POST' && url.pathname === '/resources') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'db:create', auth);
        await assertProjectAccess(controlPlane.store, body.projectId, subject);
        return send(res, 201, controlPlane.store.createResource(body));
      }
      const envMatch = url.pathname.match(/^\/projects\/([^/]+)\/services\/([^/]+)\/env$/);
      if (envMatch && method === 'GET') {
        const subject = authorizeAction(req, 'env:read', auth);
        const [projectId, serviceId] = envMatch.slice(1).map(decodeURIComponent);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        return send(res, 200, controlPlane.store.listServiceEnvironment({ projectId, serviceId }));
      }
      if (envMatch && method === 'POST') {
        const subject = authorizeAction(req, 'env:write-limited', auth);
        const [projectId, serviceId] = envMatch.slice(1).map(decodeURIComponent);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        const body = await readJson(req);
        return send(res, 200, controlPlane.store.upsertServiceEnvironment({ projectId, serviceId, entries: body.entries || body.environment || body, actorUserId: subject.id, source: body.source || 'api' }));
      }
      const envFileMatch = url.pathname.match(/^\/projects\/([^/]+)\/services\/([^/]+)\/env-file$/);
      if (envFileMatch && method === 'POST') {
        const subject = authorizeAction(req, 'env:write-limited', auth);
        const [projectId, serviceId] = envFileMatch.slice(1).map(decodeURIComponent);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        const body = await readJson(req);
        return send(res, 200, controlPlane.store.importServiceEnvFile({ projectId, serviceId, content: body.content || body.text || '', actorUserId: subject.id, source: body.filename || '.env' }));
      }
      if (method === 'POST' && url.pathname === '/integrations/github') {
        const subject = authorizeAction(req, 'team:invite', auth);
        const body = await readJson(req);
        const organizationId = body.organizationId || subject.organizationId;
        requireScope(subject, { organizationId });
        return send(res, 201, controlPlane.store.createGitHubIntegration({ ...body, organizationId, userId: subject.id }));
      }
      if (method === 'GET' && url.pathname === '/integrations/github') {
        const subject = authorizeAction(req, 'project:read', auth);
        const organizationId = url.searchParams.get('organizationId') || subject.organizationId;
        requireScope(subject, { organizationId });
        return send(res, 200, { integrations: controlPlane.store.listGitHubIntegrations({ organizationId }) });
      }
      const githubServiceMatch = url.pathname.match(/^\/projects\/([^/]+)\/services\/([^/]+)\/github$/);
      if (githubServiceMatch && method === 'POST') {
        const subject = authorizeAction(req, 'deploy:run', auth);
        const [projectId, serviceId] = githubServiceMatch.slice(1).map(decodeURIComponent);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        const body = await readJson(req);
        return send(res, 200, controlPlane.store.attachGitHubRepositoryToService({ projectId, serviceId, integrationId: body.integrationId, repoUrl: body.repoUrl || body.repository, branch: body.branch || 'main', actorUserId: subject.id }));
      }

      return send(res, 404, { error: 'not_found', path: url.pathname });
    } catch (error) {
      return send(res, error.statusCode || 500, { error: error.message || 'internal_error' });
    }
  };
}

function matchesSubjectOrganization(subject: Record<string, any>, organizationId: any) {
  const expected = String(organizationId);
  if (subject.organizationId && String(subject.organizationId) === expected) return true;
  if (Array.isArray(subject.organizationIds) && subject.organizationIds.map(String).includes(expected)) return true;
  return false;
}

function authorizeAction(req: any, action: string, auth: Record<string, any>) {
  const subject = subjectFromRequest(req, auth);
  requireAction(subject, action);
  return subject;
}

async function assertServiceAccess(store: any, projectId: string, serviceId: string, subject: Record<string, any>) {
  const service = store.services.get(serviceId);
  if (!service) {
    const error = new Error(`service not found: ${serviceId}`);
    (error as any).statusCode = 404;
    throw error;
  }
  if (String(service.projectId) !== String(projectId)) {
    const error = new Error('service does not belong to project');
    (error as any).statusCode = 403;
    throw error;
  }
  await assertProjectAccess(store, projectId, subject);
}

async function assertProjectAccess(store: any, projectId: string, subject: Record<string, any>) {
  if (subject.global === true || subject.authMode === 'disabled') return true;
  let projectScopeError: any = null;
  try {
    requireScope(subject, { projectId });
    return true;
  } catch (error) {
    projectScopeError = error;
    // Organization-scoped subjects can operate on projects inside their org.
  }
  if (!subject.organizationId && !Array.isArray(subject.organizationIds)) throw projectScopeError;
  const project = store.projects.get(projectId);
  if (!project) {
    const error = new Error(`project not found: ${projectId}`);
    (error as any).statusCode = 404;
    throw error;
  }
  requireScope(subject, { organizationId: project.organizationId });
  return true;
}

function authConfigFromEnv() {
  const jwtSecret = process.env.RAIBITSERVER_AUTH_JWT_SECRET || '';
  const disabled = process.env.RAIBITSERVER_AUTH_DISABLED === '1';
  return {
    mode: disabled ? 'disabled' : 'jwt',
    allowDisabled: disabled,
    jwtSecret,
    issuer: process.env.RAIBITSERVER_AUTH_ISSUER || 'raibitserver',
    allowDevHeaders: process.env.RAIBITSERVER_AUTH_DEV_HEADERS === '1',
    allowDevToken: process.env.RAIBITSERVER_AUTH_DEV_TOKEN === '1',
    defaultRole: process.env.RAIBITSERVER_ROLE || 'owner',
  };
}

function projectSpecFromBody(body) {
  if (body.projectSpec) return body.projectSpec;
  if (body.services || body.resources || body.organization) return body;
  return body.project || body;
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function send(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
