import type { DeploymentRequest, ProjectSpec, ResourceSpec, ServiceSpec } from '@raibitserver/schemas';

export class RAIBITSERVERClient {
  readonly baseUrl: string;

  constructor(options: { baseUrl: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  listProjects(): Promise<ProjectSpec[]> {
    return this.request('/projects');
  }

  createProject(project: ProjectSpec): Promise<ProjectSpec> {
    return this.request('/projects', { method: 'POST', body: project });
  }

  createService(projectId: string, service: ServiceSpec): Promise<ServiceSpec> {
    return this.request(`/projects/${projectId}/services`, { method: 'POST', body: service });
  }

  createResource(projectId: string, resource: ResourceSpec): Promise<ResourceSpec> {
    return this.request(`/projects/${projectId}/resources`, { method: 'POST', body: resource });
  }

  createDeployment(request: DeploymentRequest): Promise<{ id: string; status: string }> {
    return this.request(`/projects/${request.projectId}/services/${request.serviceId}/deployments`, {
      method: 'POST',
      body: request,
    });
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method || 'GET',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw new Error(`RAIBITSERVER API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}
