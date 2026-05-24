import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { DeploymentsService } from './deployments.service';

@Controller('projects/:projectId/services/:serviceId/deployments')
export class DeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Req() req: any) {
    return this.deploymentsService.listDeployments(projectId, serviceId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post()
  @HttpCode(202)
  create(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.deploymentsService.createDeployment(projectId, serviceId, input || {}, req.raibitSubject);
  }
}

@Controller('services/:serviceId/deployments')
export class ServiceDeploymentsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.deploymentsService.listDeploymentsForService(serviceId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post()
  @HttpCode(202)
  create(@Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.deploymentsService.createDeploymentForService(serviceId, input || {}, req.raibitSubject);
  }
}

@Controller()
export class DeploymentLogsController {
  constructor(private readonly deploymentsService: DeploymentsService) {}

  @RequirePermission('project:read')
  @Get('deployments/:deploymentId')
  get(@Param('deploymentId') deploymentId: string, @Req() req: any) {
    return this.deploymentsService.getDeployment(deploymentId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Patch('deployments/:deploymentId/status')
  statusPatch(@Param('deploymentId') deploymentId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.deploymentsService.updateDeploymentStatus(deploymentId, input || {}, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post('deployments/:deploymentId/status')
  statusPost(@Param('deploymentId') deploymentId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.deploymentsService.updateDeploymentStatus(deploymentId, input || {}, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post('deployments/:deploymentId/cancel')
  @HttpCode(202)
  cancel(@Param('deploymentId') deploymentId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.deploymentsService.cancelDeployment(deploymentId, input || {}, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post('deployments/:deploymentId/rollback')
  @HttpCode(202)
  rollback(@Param('deploymentId') deploymentId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.deploymentsService.rollbackDeployment(deploymentId, input || {}, req.raibitSubject);
  }

  @RequirePermission('logs:read')
  @Get('deployments/:deploymentId/logs')
  logs(@Param('deploymentId') deploymentId: string, @Req() req: any) {
    return this.deploymentsService.listDeploymentLogs(deploymentId, req.raibitSubject);
  }

  @RequirePermission('logs:read')
  @Get('deployments/:deploymentId/events')
  events(@Param('deploymentId') deploymentId: string, @Req() req: any) {
    return this.deploymentsService.listDeploymentEvents(deploymentId, req.raibitSubject);
  }

  @RequirePermission('logs:read')
  @Get('services/:serviceId/logs')
  runtime(@Param('serviceId') serviceId: string, @Req() req: any) {
    return this.deploymentsService.listRuntimeLogs(serviceId, req.raibitSubject);
  }
}
