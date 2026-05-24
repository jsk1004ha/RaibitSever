import { Injectable } from '@nestjs/common';
import type { ProjectSpec } from '@raibitserver/schemas';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly controlPlane: RAIBITSERVERService) {}

  listProjects(subject: Record<string, any>) { return this.controlPlane.listProjects(subject); }
  createProject(project: ProjectSpec, subject: Record<string, any>) { return this.controlPlane.createProject(project, subject); }
  getProject(projectId: string, subject: Record<string, any>) { return this.controlPlane.getProject(projectId, subject); }
  updateProject(projectId: string, input: Record<string, any>, subject: Record<string, any>) { return this.controlPlane.updateProject(projectId, input, subject); }
  deleteProject(projectId: string, subject: Record<string, any>) { return this.controlPlane.deleteProject(projectId, subject); }
}
