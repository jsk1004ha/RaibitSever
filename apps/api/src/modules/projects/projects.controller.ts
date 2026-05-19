import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ProjectSpec } from '@raibitserver/schemas';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Req() req: any) {
    return this.raibitServer.listProjects(req.raibitSubject);
  }

  @RequirePermission('project:create')
  @Post()
  create(@Body() project: ProjectSpec, @Req() req: any) {
    return this.raibitServer.createProject(project, req.raibitSubject);
  }
}
