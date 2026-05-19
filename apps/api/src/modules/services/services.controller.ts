import { Body, Controller, Param, Post } from '@nestjs/common';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ServiceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/services')
export class ServicesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @Post()
  create(@Param('projectId') projectId: string, @Body() service: ServiceSpec) {
    return this.raibitServer.addService(projectId, service);
  }
}
