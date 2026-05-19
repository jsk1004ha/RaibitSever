import { Controller, Param, Post } from '@nestjs/common';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller('projects/:projectId/services/:serviceId/deployments')
export class DeploymentsController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @Post()
  create(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string) {
    return this.raibitServer.createDeployment(projectId, serviceId);
  }
}
