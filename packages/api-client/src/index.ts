import type { DeploymentRequest, ProjectSpec, ResourceSpec, ServiceSpec } from '@raibitserver/schemas';

export class RAIBITSERVERClient {
  readonly baseUrl: string;
  readonly token?: string;

  constructor(options: { baseUrl: string; token?: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  withToken(token: string) {
    return new RAIBITSERVERClient({ baseUrl: this.baseUrl, token });
  }

  health(): Promise<Record<string, unknown>> { return this.request('/health'); }
  me(): Promise<Record<string, unknown>> { return this.request('/auth/me'); }
  signup(input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request('/auth/signup', { method: 'POST', body: input }); }
  login(input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request('/auth/login', { method: 'POST', body: input }); }
  logout(): Promise<Record<string, unknown>> { return this.request('/auth/logout', { method: 'POST' }); }

  listOrganizations(): Promise<Record<string, unknown>> { return this.request('/organizations'); }
  createOrganization(input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request('/organizations', { method: 'POST', body: input }); }

  listProjects(organizationId?: string): Promise<ProjectSpec[] | Record<string, unknown>> {
    return this.request(organizationId ? `/organizations/${encodeURIComponent(organizationId)}/projects` : '/projects');
  }

  createProject(project: Partial<ProjectSpec> & Record<string, unknown>, organizationId?: string): Promise<ProjectSpec> {
    const path = organizationId ? `/organizations/${encodeURIComponent(organizationId)}/projects` : '/projects';
    return this.request(path, { method: 'POST', body: project });
  }

  createService(projectId: string, service: Partial<ServiceSpec> & Record<string, unknown>): Promise<ServiceSpec> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services`, { method: 'POST', body: service });
  }

  listServices(projectId: string): Promise<Record<string, unknown>> { return this.request(`/projects/${encodeURIComponent(projectId)}/services`); }

  createResource(projectId: string, resource: Partial<ResourceSpec> & Record<string, unknown>): Promise<ResourceSpec> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/resources`, { method: 'POST', body: resource });
  }

  listResources(projectId: string): Promise<Record<string, unknown>> { return this.request(`/projects/${encodeURIComponent(projectId)}/resources`); }

  createDeployment(serviceId: string, request: DeploymentRequest = {}): Promise<{ id: string; status: string }> {
    return this.request(`/services/${encodeURIComponent(serviceId)}/deployments`, { method: 'POST', body: request });
  }

  listDeploymentLogs(deploymentId: string): Promise<Record<string, unknown>> { return this.request(`/deployments/${encodeURIComponent(deploymentId)}/logs`); }
  listRuntimeLogs(serviceId: string): Promise<Record<string, unknown>> { return this.request(`/services/${encodeURIComponent(serviceId)}/logs`); }

  uploadEnvFile(projectId: string, serviceId: string, filename: string, content: string): Promise<Record<string, unknown>> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/env-file`, { method: 'POST', body: { filename, content } });
  }

  connectGitHub(input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request('/integrations/github', { method: 'POST', body: input }); }
  queryResource(resourceId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request(`/resources/${encodeURIComponent(resourceId)}/console/query`, { method: 'POST', body: input }); }
  usageMe(): Promise<Record<string, unknown>> { return this.request('/usage/me'); }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method || 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`RAIBITSERVER API ${response.status}: ${body?.error || text}`);
    return body as T;
  }
}
