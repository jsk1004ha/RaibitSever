import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ServiceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/services')
export class ServicesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('projectId') projectId: string, @Req() req: any) {
    return this.raibitServer.listServices(projectId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post()
  create(@Param('projectId') projectId: string, @Body() service: ServiceSpec, @Req() req: any) {
    return this.raibitServer.addService(projectId, service, req.raibitSubject);
  }
}
