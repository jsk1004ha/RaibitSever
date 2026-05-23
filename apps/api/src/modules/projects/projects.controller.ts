import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ProjectSpec } from '@raibitserver/schemas';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  async list(@Req() req: any) {
    return { projects: await this.raibitServer.listProjects(req.raibitSubject) };
  }

  @RequirePermission('project:create')
  @Post()
  create(@Body() project: ProjectSpec, @Req() req: any) {
    return this.raibitServer.createProject(project, req.raibitSubject);
  }

  @RequirePermission('project:read')
  @Get(':projectId')
  get(@Param('projectId') projectId: string, @Req() req: any) {
    return this.raibitServer.getProject(projectId, req.raibitSubject);
  }

  @RequirePermission('project:create')
  @Patch(':projectId')
  update(@Param('projectId') projectId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.updateProject(projectId, input || {}, req.raibitSubject);
  }

  @RequirePermission('project:delete')
  @Delete(':projectId')
  @HttpCode(200)
  delete(@Param('projectId') projectId: string, @Req() req: any) {
    return this.raibitServer.deleteProject(projectId, req.raibitSubject);
  }
}
