import { RAIBITSERVERControlPlane } from './control-plane.ts';
import { isSecretKey, maskSecrets } from './secrets.ts';
import { authorizeRequest, requireAction, requireScope, signJwtHs256, subjectFromRequest } from './auth.ts';
import { organizationScopeFromProjectInput } from './scope.ts';
import { createSessionToken, hashPassword, normalizeEmail, personalOrganizationSlug, shouldPromoteFirstLogin, signupPolicyForAccount, verifyPassword } from './identity.ts';
import { runtimeConfigStatus } from './config.ts';
import { normalizeEnvEntries, parseDotEnv } from './env-file.ts';
import { can } from './rbac.ts';
import { validateServiceSecurity } from './security.ts';
import { deterministicGitHubCallbackAllowed, githubOAuthLoginPlan } from './github-integration.ts';

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
        const passwordHash = hashPassword(body.password);
        const organizationSlug = body.organizationSlug || body.orgSlug || personalOrganizationSlug(email);
        if (controlPlane.store.findOrganizationBySlug(organizationSlug)) return send(res, 409, { error: 'organization_slug_already_exists' });
        const organization = controlPlane.store.createOrganization({ name: body.organizationName || organizationSlug, slug: organizationSlug, plan: body.plan || 'free' });
        const policy = signupPolicyForAccount(body, email, { firstUser: controlPlane.store.users.size === 0 });
        const user = controlPlane.store.createUser({ name: body.name || email, email, passwordHash, role: policy.role, accountType: policy.accountType, approvalStatus: policy.approvalStatus });
        const membership = controlPlane.store.addMember({ organizationId: organization.id, userId: user.id, role: 'owner' });
        const token = createSessionToken({ ...user, email }, [membership], auth.jwtSecret, { issuer: auth.issuer || 'raibitserver', expiresInSeconds: body.expiresInSeconds || 3600 });
        return send(res, 201, { user, organization, membership, token });
      }
      if (method === 'POST' && url.pathname === '/auth/login') {
        const body = await readJson(req);
        if (!auth.jwtSecret) return send(res, 500, { error: 'jwt_secret_not_configured' });
        let user = controlPlane.store.findUserByEmail(normalizeEmail(body.email));
        if (!user || !verifyPassword(body.password, user.passwordHash)) return send(res, 401, { error: 'invalid_credentials' });
        if (shouldPromoteFirstLogin(user, [...controlPlane.store.users.values()])) {
          user = controlPlane.store.approveUser(user.id, { accountType: 'CLUB_MEMBER', role: 'ADMIN' });
        }
        const memberships = controlPlane.store.listMembershipsForUser(user.id);
        const token = createSessionToken(user, memberships, auth.jwtSecret, { issuer: auth.issuer || 'raibitserver', expiresInSeconds: body.expiresInSeconds || 3600 });
        const { passwordHash: _passwordHash, ...publicUser } = user;
        return send(res, 200, { user: publicUser, memberships, token });
      }
      if (method === 'GET' && url.pathname === '/auth/github/login') {
        return send(res, 200, githubOAuthLoginPlan(Object.fromEntries(url.searchParams.entries())));
      }
      if (method === 'GET' && url.pathname === '/auth/github/callback') {
        const input = Object.fromEntries(url.searchParams.entries());
        const emailInput = input.email || input.githubEmail || input.userEmail || null;
        if (!emailInput) return send(res, 200, { provider: 'github', received: true, codePresent: Boolean(url.searchParams.get('code')), state: url.searchParams.get('state'), mode: 'deterministic-local-callback', linked: false });
        if (!deterministicGitHubCallbackAllowed(input)) return send(res, 403, { error: 'deterministic_github_callback_disabled' });
        if (!auth.jwtSecret) return send(res, 500, { error: 'jwt_secret_not_configured' });
        const email = normalizeEmail(emailInput);
        const githubId = input.githubId || input.id || input.github_id || null;
        const githubLogin = input.login || input.username || null;
        let user = controlPlane.store.findUserByEmail(email);
        const githubOwner = githubId ? controlPlane.store.findUserByGitHubId(githubId) : null;
        if (githubOwner && (!user || String(githubOwner.id) !== String(user.id))) return send(res, 409, { error: 'github_account_already_linked' });
        let created = false;
        let organization = null;
        if (user) {
          user = controlPlane.store.linkGitHubUser(user.id, { githubId, githubLogin, avatarUrl: input.avatarUrl || input.avatar_url || null, name: input.name || user.name, actorUserId: user.id });
        } else {
          const organizationSlug = input.organizationSlug || personalOrganizationSlug(email);
          if (controlPlane.store.findOrganizationBySlug(organizationSlug)) return send(res, 409, { error: 'organization_slug_already_exists' });
          organization = controlPlane.store.createOrganization({ name: input.organizationName || organizationSlug, slug: organizationSlug, plan: input.plan || 'free' });
          const policy = signupPolicyForAccount(input, email, { firstUser: controlPlane.store.users.size === 0 });
          user = controlPlane.store.createUser({ name: input.name || githubLogin || email, email, githubId, avatarUrl: input.avatarUrl || input.avatar_url || null, role: policy.role, accountType: policy.accountType, approvalStatus: policy.approvalStatus });
          controlPlane.store.addMember({ organizationId: organization.id, userId: user.id, role: 'owner' });
          created = true;
        }
        const memberships = controlPlane.store.listMembershipsForUser(user.id);
        const token = createSessionToken({ ...user, email }, memberships, auth.jwtSecret, { issuer: auth.issuer || 'raibitserver', expiresInSeconds: input.expiresInSeconds || 3600 });
        return send(res, 200, { provider: 'github', received: true, codePresent: Boolean(url.searchParams.get('code')), state: url.searchParams.get('state'), mode: 'deterministic-local-callback', linked: true, created, user: publicUser(user), organization, memberships, token });
      }
      if (method === 'GET' && url.pathname === '/auth/me') {
        const subject = subjectFromRequest(req, auth);
        const user = controlPlane.store.users.get(subject.id) || null;
        const memberships = user ? controlPlane.store.listMembershipsForUser(user.id) : [];
        return send(res, 200, { user: user ? publicUser(user) : null, subject, memberships });
      }
      if (method === 'POST' && url.pathname === '/auth/logout') {
        subjectFromRequest(req, auth);
        return send(res, 200, { ok: true });
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
      if (method === 'GET' && url.pathname === '/organizations') {
        const subject = authorizeAction(req, 'project:read', auth);
        const organizations = [...controlPlane.store.organizations.values()].filter((org) => subject.global === true || subject.authMode === 'disabled' || matchesSubjectOrganization(subject, org.id));
        return send(res, 200, { organizations });
      }
      if (method === 'POST' && url.pathname === '/organizations') {
        authorizeRequest(req, 'team:invite', auth);
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createOrganization(body));
      }
      const organizationProjectsMatch = url.pathname.match(/^\/organizations\/([^/]+)\/projects$/);
      if (organizationProjectsMatch && method === 'GET') {
        const subject = authorizeAction(req, 'project:read', auth);
        const organizationId = decodeURIComponent(organizationProjectsMatch[1]);
        requireScope(subject, { organizationId });
        return send(res, 200, { projects: [...controlPlane.store.projects.values()].filter((project) => String(project.organizationId) === String(organizationId)) });
      }
      if (organizationProjectsMatch && method === 'POST') {
        const subject = authorizeAction(req, 'project:create', auth);
        const organizationId = decodeURIComponent(organizationProjectsMatch[1]);
        requireScope(subject, { organizationId });
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'project:create', metric: 'maxProjects', increment: 1 });
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createProject({ ...body, organizationId }));
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
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'project:create', metric: 'maxProjects', increment: 1 });
        return send(res, 201, controlPlane.store.createProject({ ...body, organizationId }));
      }
      const projectServicesMatch = url.pathname.match(/^\/projects\/([^/]+)\/services$/);
      if (projectServicesMatch && method === 'GET') {
        const subject = authorizeAction(req, 'project:read', auth);
        const projectId = decodeURIComponent(projectServicesMatch[1]);
        await assertProjectAccess(controlPlane.store, projectId, subject);
        return send(res, 200, { services: [...controlPlane.store.services.values()].filter((service) => String(service.projectId) === String(projectId)) });
      }
      if (projectServicesMatch && method === 'POST') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'deploy:run', auth);
        const projectId = decodeURIComponent(projectServicesMatch[1]);
        await assertProjectAccess(controlPlane.store, projectId, subject);
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'service:create', metric: 'maxServices', increment: 1 });
        return send(res, 201, controlPlane.store.createService({ ...body, projectId }));
      }
      if (method === 'POST' && url.pathname === '/services') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'deploy:run', auth);
        await assertProjectAccess(controlPlane.store, body.projectId, subject);
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'service:create', metric: 'maxServices', increment: 1 });
        return send(res, 201, controlPlane.store.createService(body));
      }
      const projectResourcesMatch = url.pathname.match(/^\/projects\/([^/]+)\/resources$/);
      if (projectResourcesMatch && method === 'GET') {
        const subject = authorizeAction(req, 'project:read', auth);
        const projectId = decodeURIComponent(projectResourcesMatch[1]);
        await assertProjectAccess(controlPlane.store, projectId, subject);
        return send(res, 200, { resources: [...controlPlane.store.resources.values()].filter((resource) => String(resource.projectId) === String(projectId)) });
      }
      if (projectResourcesMatch && method === 'POST') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'db:create', auth);
        const projectId = decodeURIComponent(projectResourcesMatch[1]);
        await assertProjectAccess(controlPlane.store, projectId, subject);
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'resource:create', metric: resourceQuotaMetric(body), increment: Number(body.storageMb || body.storageGb || 1) });
        return send(res, 201, controlPlane.store.createResource({ ...body, projectId }));
      }
      if (method === 'POST' && url.pathname === '/resources') {
        const body = await readJson(req);
        const subject = authorizeAction(req, 'db:create', auth);
        await assertProjectAccess(controlPlane.store, body.projectId, subject);
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'resource:create', metric: resourceQuotaMetric(body), increment: Number(body.storageMb || body.storageGb || 1) });
        return send(res, 201, controlPlane.store.createResource(body));
      }
      const serviceDeploymentsMatch = url.pathname.match(/^\/services\/([^/]+)\/deployments$/);
      if (serviceDeploymentsMatch && method === 'POST') {
        const serviceId = decodeURIComponent(serviceDeploymentsMatch[1]);
        const service = controlPlane.store.services.get(serviceId);
        if (!service) return send(res, 404, { error: 'service_not_found' });
        const body = await readJson(req);
        const deploymentType = body.deploymentType || body.type || 'production';
        const subject = authorizeAction(req, 'deploy:run', auth);
        await assertProjectAccess(controlPlane.store, service.projectId, subject);
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'deployment:create', metric: 'maxDeploymentsPerDay', increment: 1 });
        if (deploymentType === 'preview') controlPlane.store.enforceUserCan({ userId: subject.id, action: 'deployment:create', metric: 'maxPreviewDeployments', increment: 1 });
        const security = validateServiceSecurity(service.desiredState || service.desiredSpec || service);
        if (!security.ok) return send(res, 403, { error: 'security_policy_violation', findings: security.findings });
        const deployment = controlPlane.store.createDeployment({ ...body, serviceId, deploymentType });
        const workflowJob = controlPlane.store.enqueueWorkflowJob({ type: deploymentType === 'preview' ? 'preview-deploy' : 'build-and-deploy', targetType: 'deployment', targetId: deployment.id, payload: { serviceId, projectId: service.projectId, deploymentId: deployment.id } });
        return send(res, 202, { ...deployment, workflowJob });
      }
      const projectServiceDeploymentsMatch = url.pathname.match(/^\/projects\/([^/]+)\/services\/([^/]+)\/deployments$/);
      if (projectServiceDeploymentsMatch && method === 'POST') {
        const [projectId, serviceId] = projectServiceDeploymentsMatch.slice(1).map(decodeURIComponent);
        const body = await readJson(req);
        const deploymentType = body.deploymentType || body.type || 'production';
        const subject = authorizeAction(req, 'deploy:run', auth);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        controlPlane.store.enforceUserCan({ userId: subject.id, action: 'deployment:create', metric: 'maxDeploymentsPerDay', increment: 1 });
        if (deploymentType === 'preview') controlPlane.store.enforceUserCan({ userId: subject.id, action: 'deployment:create', metric: 'maxPreviewDeployments', increment: 1 });
        const service = controlPlane.store.services.get(serviceId);
        const security = validateServiceSecurity(service?.desiredState || service?.desiredSpec || service || {});
        if (!security.ok) return send(res, 403, { error: 'security_policy_violation', findings: security.findings });
        const deployment = controlPlane.store.createDeployment({ ...body, serviceId, deploymentType });
        const workflowJob = controlPlane.store.enqueueWorkflowJob({ type: deploymentType === 'preview' ? 'preview-deploy' : 'build-and-deploy', targetType: 'deployment', targetId: deployment.id, payload: { serviceId, projectId, deploymentId: deployment.id } });
        return send(res, 202, { ...deployment, workflowJob });
      }
      const deploymentLogsMatch = url.pathname.match(/^\/deployments\/([^/]+)\/(logs|events)$/);
      if (deploymentLogsMatch && method === 'GET') {
        authorizeAction(req, 'logs:read', auth);
        const [deploymentId, kind] = deploymentLogsMatch.slice(1).map(decodeURIComponent);
        return send(res, 200, kind === 'logs' ? { logs: controlPlane.store.listDeploymentLogs(deploymentId) } : { events: controlPlane.store.listDeploymentEvents(deploymentId) });
      }
      const runtimeLogsMatch = url.pathname.match(/^\/services\/([^/]+)\/logs$/);
      if (runtimeLogsMatch && method === 'GET') {
        authorizeAction(req, 'logs:read', auth);
        return send(res, 200, { logs: controlPlane.store.listRuntimeLogs(decodeURIComponent(runtimeLogsMatch[1])) });
      }
      const resourceConsoleGetMatch = url.pathname.match(/^\/resources\/([^/]+)\/console\/(schema|tables|collections|keys)$/);
      if (resourceConsoleGetMatch && method === 'GET') {
        const subject = authorizeAction(req, 'db:connect-limited', auth);
        const [resourceId, view] = resourceConsoleGetMatch.slice(1).map(decodeURIComponent);
        const resource = controlPlane.store.resources.get(resourceId);
        if (!resource) return send(res, 404, { error: 'resource_not_found' });
        await assertProjectAccess(controlPlane.store, resource.projectId, subject);
        return send(res, 200, await controlPlane.store.resourceConsoleView(resourceId, view, { ...Object.fromEntries(url.searchParams.entries()), role: subject.role, actorUserId: subject.id }));
      }
      const resourceConsoleQueryMatch = url.pathname.match(/^\/resources\/([^/]+)\/console\/(query|browse|command)$/);
      if (resourceConsoleQueryMatch && method === 'POST') {
        const subject = authorizeAction(req, 'db:connect-limited', auth);
        const [resourceId, action] = resourceConsoleQueryMatch.slice(1).map(decodeURIComponent);
        const body = await readJson(req);
        const resource = controlPlane.store.resources.get(resourceId);
        if (!resource) return send(res, 404, { error: 'resource_not_found' });
        await assertProjectAccess(controlPlane.store, resource.projectId, subject);
        if (action === 'query') return send(res, 200, await controlPlane.store.runResourceConsoleQuery(resourceId, body.query, { ...body, role: subject.role, actorUserId: subject.id }));
        if (action === 'command') return send(res, 200, await controlPlane.store.runResourceConsoleCommand(resourceId, body.command || body.query, { ...body, role: subject.role, actorUserId: subject.id }));
        return send(res, 200, await controlPlane.store.browseResourceConsole(resourceId, body));
      }
      const adminApproveMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/(approve|reject)$/);
      if (adminApproveMatch && method === 'POST') {
        const subject = authorizeAction(req, 'audit:read', auth);
        if (subject.userRole !== 'ADMIN' && subject.global !== true) return send(res, 403, { error: 'admin_required' });
        const [userId, action] = adminApproveMatch.slice(1).map(decodeURIComponent);
        const body = await readJson(req);
        return send(res, 200, action === 'approve' ? controlPlane.store.approveUser(userId, { ...body, actorUserId: subject.id }) : controlPlane.store.rejectUser(userId, { actorUserId: subject.id }));
      }
      const adminQuotaMatch = url.pathname.match(/^\/admin\/users\/([^/]+)\/quota$/);
      if (adminQuotaMatch && (method === 'PATCH' || method === 'POST')) {
        const subject = authorizeAction(req, 'audit:read', auth);
        if (subject.userRole !== 'ADMIN' && subject.global !== true) return send(res, 403, { error: 'admin_required' });
        const body = await readJson(req);
        return send(res, 200, controlPlane.store.setQuota({ ...body, userId: decodeURIComponent(adminQuotaMatch[1]) }));
      }
      if (method === 'GET' && url.pathname === '/usage/me') {
        const subject = authorizeAction(req, 'metrics:read', auth);
        const usage = controlPlane.store.usageRecords.filter((row) => String(row.userId) === String(subject.id));
        const unlimited = subject.userRole === 'ADMIN' || subject.accountType === 'CLUB_MEMBER';
        const quota = unlimited ? null : [...controlPlane.store.quotas.values()].find((row) => String(row.userId) === String(subject.id));
        return send(res, 200, { accountType: subject.accountType, approvalStatus: subject.approvalStatus, unlimited, quota: quota || null, usage });
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
        const entries = normalizeEnvEntries(body.entries || body.environment || body, { source: body.source || 'api' });
        enforceEnvironmentWrite(subject, entries);
        return send(res, 200, controlPlane.store.upsertServiceEnvironment({ projectId, serviceId, entries, actorUserId: subject.id, source: body.source || 'api' }));
      }
      const envFileMatch = url.pathname.match(/^\/projects\/([^/]+)\/services\/([^/]+)\/env-file$/);
      if (envFileMatch && method === 'POST') {
        const subject = authorizeAction(req, 'env:write-limited', auth);
        const [projectId, serviceId] = envFileMatch.slice(1).map(decodeURIComponent);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        const body = await readJson(req);
        const source = body.filename || '.env';
        const parsed = parseDotEnv(String(body.content || body.text || ''), { source });
        enforceEnvironmentWrite(subject, parsed.entries);
        const result = controlPlane.store.upsertServiceEnvironment({ projectId, serviceId, entries: parsed.entries, actorUserId: subject.id, source });
        return send(res, 200, { ...result, source, parsed: { plainCount: parsed.plainCount, secretCount: parsed.secretCount, errors: parsed.errors } });
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
      if (method === 'GET' && url.pathname === '/github/installations') {
        const subject = authorizeAction(req, 'project:read', auth);
        const organizationId = url.searchParams.get('organizationId') || subject.organizationId;
        requireScope(subject, { organizationId });
        return send(res, 200, controlPlane.store.listGitHubInstallations({ organizationId }));
      }
      const githubServiceMatch = url.pathname.match(/^\/projects\/([^/]+)\/services\/([^/]+)\/github$/);
      if (githubServiceMatch && method === 'POST') {
        const subject = authorizeAction(req, 'deploy:run', auth);
        const [projectId, serviceId] = githubServiceMatch.slice(1).map(decodeURIComponent);
        await assertServiceAccess(controlPlane.store, projectId, serviceId, subject);
        const body = await readJson(req);
        return send(res, 200, controlPlane.store.attachGitHubRepositoryToService({ projectId, serviceId, integrationId: body.integrationId, repoUrl: body.repoUrl || body.repository, branch: body.branch || 'main', actorUserId: subject.id }));
      }
      const githubInstallationRepositoriesMatch = url.pathname.match(/^\/github\/installations\/([^/]+)\/repositories$/);
      if (githubInstallationRepositoriesMatch && method === 'GET') {
        const subject = authorizeAction(req, 'project:read', auth);
        return send(res, 200, controlPlane.store.listGitHubInstallationRepositories({ installationId: decodeURIComponent(githubInstallationRepositoriesMatch[1]), organizationId: subject.organizationId, organizationIds: subject.organizationIds }));
      }
      if (method === 'POST' && url.pathname === '/github/webhooks') {
        const bodyText = await readRaw(req);
        const payload = bodyText.trim() ? JSON.parse(bodyText) : {};
        return send(res, 202, controlPlane.store.handleGitHubWebhook({
          event: req.headers['x-github-event'],
          deliveryId: req.headers['x-github-delivery'],
          signature: req.headers['x-hub-signature-256'],
          body: bodyText,
          payload,
        }));
      }
      if (method === 'POST' && url.pathname === '/github/repositories/import') {
        const subject = authorizeAction(req, 'deploy:run', auth);
        const body = await readJson(req);
        await assertProjectAccess(controlPlane.store, body.projectId, subject);
        return send(res, 201, controlPlane.store.importGitHubRepository({ ...body, actorUserId: subject.id }));
      }
      const githubRepositorySyncMatch = url.pathname.match(/^\/github\/repositories\/([^/]+)\/sync$/);
      if (githubRepositorySyncMatch && method === 'POST') {
        const subject = authorizeAction(req, 'deploy:run', auth);
        const body = await readJson(req);
        return send(res, 202, controlPlane.store.syncGitHubRepository({ ...body, repositoryId: decodeURIComponent(githubRepositorySyncMatch[1]), actorUserId: subject.id, organizationId: subject.organizationId, organizationIds: subject.organizationIds }));
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
  if (subject.global === true || subject.authMode === 'disabled') {
    const project = store.projects.get(projectId);
    if (!project) {
      const error = new Error(`project not found: ${projectId}`);
      (error as any).statusCode = 404;
      throw error;
    }
    return project;
  }
  let projectScopeError: any = null;
  try {
    requireScope(subject, { projectId });
    const scopedProject = store.projects.get(projectId);
    if (!scopedProject) {
      const error = new Error(`project not found: ${projectId}`);
      (error as any).statusCode = 404;
      throw error;
    }
    return scopedProject;
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
  return project;
}

function enforceEnvironmentWrite(subject: Record<string, any>, entries: Array<Record<string, any>>) {
  if (can(subject.role, 'env:write')) return true;
  const secretKeys = entries.filter((entry) => entry.isSecret === true || isSecretKey(entry.key)).map((entry) => entry.key);
  if (secretKeys.length) {
    const error = new Error(`role ${subject.role} requires env:write to modify secret environment keys: ${secretKeys.join(', ')}`);
    (error as any).statusCode = 403;
    throw error;
  }
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


function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function resourceQuotaMetric(resource) {
  return String(resource?.type || '').toLowerCase() === 'storage' || String(resource?.engine || '').toLowerCase().includes('object') ? 'maxObjectStorageMb' : 'maxDbStorageMb';
}

function projectSpecFromBody(body) {
  if (body.projectSpec) return body.projectSpec;
  if (body.services || body.resources || body.organization) return body;
  return body.project || body;
}

export async function readJson(req) {
  const text = await readRaw(req);
  if (!text.trim()) return {};
  const contentType = String(req.headers?.['content-type'] || req.headers?.['Content-Type'] || '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text).entries());
  return JSON.parse(text);
}

export async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function send(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
