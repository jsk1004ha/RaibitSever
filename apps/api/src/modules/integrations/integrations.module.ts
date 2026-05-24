import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../../control-plane.module';
import { GitHubIntegrationController } from './github.controller';
import { GitHubIntegrationService } from './github.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [GitHubIntegrationController],
  providers: [GitHubIntegrationService],
})
export class IntegrationsModule {}
