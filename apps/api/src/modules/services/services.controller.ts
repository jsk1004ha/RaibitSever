import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ServiceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/services')
export class ServicesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('deploy:run')
  @Post()
  create(@Param('projectId') projectId: string, @Body() service: ServiceSpec, @Req() req: any) {
    return this.raibitServer.addService(projectId, service, req.raibitSubject);
  }
}
