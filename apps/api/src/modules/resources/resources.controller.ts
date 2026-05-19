import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ResourceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/resources')
export class ResourcesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('db:create')
  @Post()
  create(@Param('projectId') projectId: string, @Body() resource: ResourceSpec, @Req() req: any) {
    return this.raibitServer.addResource(projectId, resource, req.raibitSubject);
  }
}
