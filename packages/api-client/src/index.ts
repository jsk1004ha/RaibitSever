import type { DeploymentListResponse, DeploymentRequest, DeploymentSpec, ProjectListResponse, ProjectSpec, ResourceListResponse, ResourceSpec, ServiceListResponse, ServiceSpec } from '@raibitserver/schemas';

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

  listProjects(organizationId?: string): Promise<ProjectListResponse | ProjectSpec[]> {
    return this.request(organizationId ? `/organizations/${encodeURIComponent(organizationId)}/projects` : '/projects');
  }

  createProject(project: Partial<ProjectSpec> & Record<string, unknown>, organizationId?: string): Promise<ProjectSpec> {
    const path = organizationId ? `/organizations/${encodeURIComponent(organizationId)}/projects` : '/projects';
    return this.request(path, { method: 'POST', body: project });
  }

  createService(projectId: string, service: Partial<ServiceSpec> & Record<string, unknown>): Promise<ServiceSpec> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services`, { method: 'POST', body: service });
  }

  listServices(projectId: string): Promise<ServiceListResponse> { return this.request(`/projects/${encodeURIComponent(projectId)}/services`); }

  createResource(projectId: string, resource: Partial<ResourceSpec> & Record<string, unknown>): Promise<ResourceSpec> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/resources`, { method: 'POST', body: resource });
  }

  listResources(projectId: string): Promise<ResourceListResponse> { return this.request(`/projects/${encodeURIComponent(projectId)}/resources`); }

  createDeployment(projectId: string, serviceId: string, request?: DeploymentRequest): Promise<DeploymentSpec>;
  createDeployment(serviceId: string, request?: DeploymentRequest): Promise<DeploymentSpec>;
  createDeployment(projectIdOrServiceId: string, serviceIdOrRequest: string | DeploymentRequest = {}, request: DeploymentRequest = {}): Promise<DeploymentSpec> {
    if (typeof serviceIdOrRequest === 'string') {
      return this.request(`/projects/${encodeURIComponent(projectIdOrServiceId)}/services/${encodeURIComponent(serviceIdOrRequest)}/deployments`, { method: 'POST', body: request });
    }
    return this.request(`/services/${encodeURIComponent(projectIdOrServiceId)}/deployments`, { method: 'POST', body: serviceIdOrRequest });
  }

  listDeployments(projectId: string, serviceId: string): Promise<DeploymentListResponse>;
  listDeployments(serviceId: string): Promise<DeploymentListResponse>;
  listDeployments(projectIdOrServiceId: string, serviceId?: string): Promise<DeploymentListResponse> {
    const path = serviceId
      ? `/projects/${encodeURIComponent(projectIdOrServiceId)}/services/${encodeURIComponent(serviceId)}/deployments`
      : `/services/${encodeURIComponent(projectIdOrServiceId)}/deployments`;
    return this.request(path);
  }

  listDeploymentLogs(deploymentId: string): Promise<Record<string, unknown>> { return this.request(`/deployments/${encodeURIComponent(deploymentId)}/logs`); }
  listDeploymentEvents(deploymentId: string): Promise<Record<string, unknown>> { return this.request(`/deployments/${encodeURIComponent(deploymentId)}/events`); }
  listRuntimeLogs(serviceId: string): Promise<Record<string, unknown>> { return this.request(`/services/${encodeURIComponent(serviceId)}/logs`); }

  uploadEnvFile(projectId: string, serviceId: string, filename: string, content: string): Promise<Record<string, unknown>> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/env-file`, { method: 'POST', body: { filename, content } });
  }

  listEnvironment(projectId: string, serviceId: string): Promise<Record<string, unknown>> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/env`);
  }

  upsertEnvironment(projectId: string, serviceId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/env`, { method: 'POST', body: input });
  }

  connectGitHub(input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request('/integrations/github', { method: 'POST', body: input }); }
  listGitHub(organizationId?: string): Promise<Record<string, unknown>> { return this.request(organizationId ? `/integrations/github?organizationId=${encodeURIComponent(organizationId)}` : '/integrations/github'); }
  attachGitHub(projectId: string, serviceId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/github`, { method: 'POST', body: input });
  }
  queryResource(resourceId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> { return this.request(`/resources/${encodeURIComponent(resourceId)}/console/query`, { method: 'POST', body: input }); }
  browseResource(resourceId: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> { return this.request(`/resources/${encodeURIComponent(resourceId)}/console/browse`, { method: 'POST', body: input }); }
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
