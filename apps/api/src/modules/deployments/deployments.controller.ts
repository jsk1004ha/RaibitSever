import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller('projects/:projectId/services/:serviceId/deployments')
export class DeploymentsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('deploy:run')
  @Post()
  @HttpCode(202)
  create(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Req() req: any) {
    return this.raibitServer.createDeployment(projectId, serviceId, req.raibitSubject);
  }
}
