import { Injectable } from '@nestjs/common';
import type { ProjectSpec, ServiceSpec, ResourceSpec } from '@raibitserver/schemas';

/**
 * NestJS-facing desired-state service.
 *
 * Production rule: the API stores desired state in PostgreSQL and enqueues workflows;
 * Go services reconcile Kubernetes/build/resource actual state asynchronously.
 */
@Injectable()
export class RAIBITSERVERService {
  private readonly projects = new Map<string, ProjectSpec>();

  createProject(project: ProjectSpec) {
    this.projects.set(project.id, project);
    return project;
  }

  listProjects() {
    return [...this.projects.values()];
  }

  addService(projectId: string, service: ServiceSpec) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    project.services.push(service);
    return service;
  }

  addResource(projectId: string, resource: ResourceSpec) {
    const project = this.projects.get(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    project.resources.push(resource);
    return resource;
  }

  createDeployment(projectId: string, serviceId: string) {
    return {
      id: `dep_${Date.now()}`,
      projectId,
      serviceId,
      status: 'queued',
      desiredStateWritten: true,
      nextActor: 'go-builder-and-orchestrator',
    };
  }
}
