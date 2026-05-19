import { Body, Controller, Get, Post } from '@nestjs/common';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ProjectSpec } from '@raibitserver/schemas';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @Get()
  list() {
    return this.raibitServer.listProjects();
  }

  @Post()
  create(@Body() project: ProjectSpec) {
    return this.raibitServer.createProject(project);
  }
}
