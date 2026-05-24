import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../../control-plane.module';
import { DeploymentLogsController, DeploymentsController, ServiceDeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [DeploymentsController, ServiceDeploymentsController, DeploymentLogsController],
  providers: [DeploymentsService],
})
export class DeploymentsModule {}
