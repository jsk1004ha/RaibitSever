import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller('projects/:projectId/services/:serviceId/deployments')
export class DeploymentsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Req() req: any) {
    return this.raibitServer.listDeployments(projectId, serviceId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post()
  @HttpCode(202)
  create(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.createDeployment(projectId, serviceId, input || {}, req.raibitSubject);
  }
}

@Controller('services/:serviceId/deployments')
export class ServiceDeploymentsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.raibitServer.listDeploymentsForService(serviceId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post()
  @HttpCode(202)
  create(@Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.createDeploymentForService(serviceId, input || {}, req.raibitSubject);
  }
}

@Controller()
export class DeploymentLogsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('logs:read')
  @Get('deployments/:deploymentId/logs')
  logs(@Param('deploymentId') deploymentId: string, @Req() req: any) {
    return this.raibitServer.listDeploymentLogs(deploymentId, req.raibitSubject);
  }

  @RequirePermission('logs:read')
  @Get('deployments/:deploymentId/events')
  events(@Param('deploymentId') deploymentId: string, @Req() req: any) {
    return this.raibitServer.listDeploymentEvents(deploymentId, req.raibitSubject);
  }

  @RequirePermission('logs:read')
  @Get('services/:serviceId/logs')
  runtime(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.raibitServer.listRuntimeLogs(serviceId, req.raibitSubject);
  }
}
