export type DashboardApiContext = {
  baseUrl: string;
  token?: string;
  headers: Record<string, string>;
};

export function dashboardApiContext(): DashboardApiContext {
  const baseUrl = (process.env.RAIBITSERVER_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
  const token = process.env.RAIBITSERVER_DASHBOARD_TOKEN || process.env.RAIBITSERVER_TOKEN;
  return { baseUrl, token, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

export function apiAction(path: string, context = dashboardApiContext()) {
  return `${context.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function getJson(path: string, fallback: any = null, context = dashboardApiContext()) {
  try {
    const response = await fetch(apiAction(path, context), { headers: context.headers, cache: 'no-store' });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) return { ok: false, status: response.status, error: body?.error || response.statusText, body: fallback };
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error), body: fallback };
  }
}

export async function postJson(path: string, body: any = {}, fallback: any = null, context = dashboardApiContext()) {
  try {
    const response = await fetch(apiAction(path, context), {
      method: 'POST',
      headers: { ...context.headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) return { ok: false, status: response.status, error: payload?.error || response.statusText, body: fallback };
    return { ok: true, status: response.status, body: payload };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error), body: fallback };
  }
}

export async function loadDashboardOverview(context = dashboardApiContext()) {
  const [health, me, projects, usage, github, installations] = await Promise.all([
    getJson('/health', { status: 'offline' }, context),
    context.token ? getJson('/auth/me', { user: null, subject: null }, context) : Promise.resolve({ ok: true, body: { user: null, subject: null } }),
    context.token ? getJson('/projects', { projects: [] }, context) : Promise.resolve({ ok: true, body: { projects: [] } }),
    context.token ? getJson('/usage/me', { usage: [], quota: null }, context) : Promise.resolve({ ok: true, body: { usage: [], quota: null } }),
    context.token ? getJson('/integrations/github', { integrations: [] }, context) : Promise.resolve({ ok: true, body: { integrations: [] } }),
    context.token ? getJson('/github/installations', { installations: [] }, context) : Promise.resolve({ ok: true, body: { installations: [] } }),
  ]);
  return { context, health, me, projects: projects.body?.projects || [], usage: usage.body, github: github.body, installations: installations.body?.installations || [] };
}

export async function loadProjectConsole(projectId: string, context = dashboardApiContext()) {
  const [projects, servicesResult, resourcesResult] = await Promise.all([
    getJson('/projects', { projects: [] }, context),
    getJson(`/projects/${encodeURIComponent(projectId)}/services`, { services: [] }, context),
    getJson(`/projects/${encodeURIComponent(projectId)}/resources`, { resources: [] }, context),
  ]);
  const project = (projects.body?.projects || []).find((candidate: any) => String(candidate.id) === String(projectId)) || { id: projectId, name: projectId, slug: projectId };
  const services = servicesResult.body?.services || [];
  const resources = resourcesResult.body?.resources || [];
  const deploymentsByService = await Promise.all(services.map(async (service: any) => {
    const deployments = await getJson(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(service.id)}/deployments`, { deployments: [] }, context);
    return { service, deployments: deployments.body?.deployments || [] };
  }));
  const deployments = deploymentsByService.flatMap((row) => row.deployments.map((deployment: any) => ({ ...deployment, serviceName: row.service.name || row.service.slug })));
  const [buildLogResults, deploymentEventResults, runtimeLogResults] = await Promise.all([
    Promise.all(deployments.map(async (deployment: any) => ({ deploymentId: deployment.id, serviceName: deployment.serviceName, result: await getJson(`/deployments/${encodeURIComponent(deployment.id)}/logs`, { logs: [] }, context) }))),
    Promise.all(deployments.map(async (deployment: any) => ({ deploymentId: deployment.id, serviceName: deployment.serviceName, result: await getJson(`/deployments/${encodeURIComponent(deployment.id)}/events`, { events: [] }, context) }))),
    Promise.all(services.map(async (service: any) => ({ serviceId: service.id, serviceName: service.name || service.slug, result: await getJson(`/services/${encodeURIComponent(service.id)}/logs`, { logs: [] }, context) }))),
  ]);
  const buildLogs = buildLogResults.flatMap((row) => (row.result.body?.logs || []).map((log: any) => ({ ...log, deploymentId: row.deploymentId, serviceName: row.serviceName })));
  const deploymentEvents = deploymentEventResults.flatMap((row) => (row.result.body?.events || []).map((event: any) => ({ ...event, deploymentId: row.deploymentId, serviceName: row.serviceName })));
  const runtimeLogs = runtimeLogResults.flatMap((row) => (row.result.body?.logs || []).map((log: any) => ({ ...log, serviceId: row.serviceId, serviceName: row.serviceName })));
  const resourceConsoles = await Promise.all(resources.map(async (resource: any) => {
    const [schema, browse] = await Promise.all([
      getJson(`/resources/${encodeURIComponent(resource.id)}/console/schema`, { schema: {} }, context),
      postJson(`/resources/${encodeURIComponent(resource.id)}/console/browse`, {}, { warning: 'browse unavailable' }, context),
    ]);
    return { resource, schema: schema.body, browse: browse.body };
  }));
  return { context, project, services, resources, deployments, previewDeployments: deployments.filter((deployment: any) => String(deployment.deploymentType || '').toLowerCase() === 'preview'), buildLogs, deploymentEvents, runtimeLogs, resourceConsoles };
}


export async function loadResourceConsole(resourceId: string, context = dashboardApiContext()) {
  const [resource, schema, tables, collections, keys, browse] = await Promise.all([
    getJson(`/resources/${encodeURIComponent(resourceId)}`, { id: resourceId }, context),
    getJson(`/resources/${encodeURIComponent(resourceId)}/console/schema`, { schema: {} }, context),
    getJson(`/resources/${encodeURIComponent(resourceId)}/console/tables`, { tables: [] }, context),
    getJson(`/resources/${encodeURIComponent(resourceId)}/console/collections`, { collections: [] }, context),
    getJson(`/resources/${encodeURIComponent(resourceId)}/console/keys`, { keys: [] }, context),
    postJson(`/resources/${encodeURIComponent(resourceId)}/console/browse`, {}, {}, context),
  ]);
  return { context, resource: resource.body, schema: schema.body, tables: tables.body, collections: collections.body, keys: keys.body, browse: browse.body };
}

export async function loadAdminConsole(context = dashboardApiContext()) {
  const [snapshot, usage] = await Promise.all([
    getJson('/snapshot', { users: [], quotas: [], auditLogs: [] }, context),
    getJson('/usage/me', { usage: [], quota: null }, context),
  ]);
  const users = snapshot.body?.users || [];
  return { context, users, pendingUsers: users.filter((user: any) => String(user.approvalStatus || '').toUpperCase() === 'PENDING'), quotas: snapshot.body?.quotas || [], auditLogs: snapshot.body?.auditLogs || [], usage: usage.body };
}

export async function loadGitHubConsole(context = dashboardApiContext()) {
  const [integrations, installations, projects] = await Promise.all([
    getJson('/integrations/github', { integrations: [] }, context),
    getJson('/github/installations', { installations: [] }, context),
    getJson('/projects', { projects: [] }, context),
  ]);
  return { context, integrations: integrations.body?.integrations || [], installations: installations.body?.installations || [], projects: projects.body?.projects || [] };
}
