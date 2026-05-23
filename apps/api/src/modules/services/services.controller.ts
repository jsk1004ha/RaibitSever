import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
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

@Controller('services/:serviceId')
export class ServiceDetailController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  get(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.raibitServer.getService(serviceId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Patch()
  update(@Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.updateService(serviceId, input || {}, req.raibitSubject);
  }

  @RequirePermission('project:delete')
  @Delete()
  @HttpCode(200)
  delete(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.raibitServer.deleteService(serviceId, req.raibitSubject);
  }
}
