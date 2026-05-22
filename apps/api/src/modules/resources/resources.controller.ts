import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ResourceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/resources')
export class ResourcesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('projectId') projectId: string, @Req() req: any) {
    return this.raibitServer.listResources(projectId, req.raibitSubject);
  }

  @RequirePermission('db:create')
  @Post()
  create(@Param('projectId') projectId: string, @Body() resource: ResourceSpec, @Req() req: any) {
    return this.raibitServer.addResource(projectId, resource, req.raibitSubject);
  }
}
