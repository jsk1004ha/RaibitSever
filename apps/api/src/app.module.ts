import { Module } from '@nestjs/common';
import { RAIBITSERVERService } from './raibitserver.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { ServicesController } from './modules/services/services.controller';
import { DeploymentsController } from './modules/deployments/deployments.controller';
import { ResourcesController } from './modules/resources/resources.controller';

@Module({
  controllers: [ProjectsController, ServicesController, DeploymentsController, ResourcesController],
  providers: [RAIBITSERVERService],
})
export class AppModule {}
