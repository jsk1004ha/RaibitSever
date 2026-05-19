import { Body, Controller, Param, Post } from '@nestjs/common';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ResourceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/resources')
export class ResourcesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @Post()
  create(@Param('projectId') projectId: string, @Body() resource: ResourceSpec) {
    return this.raibitServer.addResource(projectId, resource);
  }
}
