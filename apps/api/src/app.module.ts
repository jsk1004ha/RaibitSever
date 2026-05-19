import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RAIBITSERVERService } from './raibitserver.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { ServicesController } from './modules/services/services.controller';
import { DeploymentsController } from './modules/deployments/deployments.controller';
import { ResourcesController } from './modules/resources/resources.controller';
import { AuthController } from './modules/auth/auth.controller';
import { EnvironmentController } from './modules/environment/environment.controller';
import { GitHubIntegrationController } from './modules/integrations/github.controller';
import { AdminController } from './modules/admin.controller';
import { RbacGuard } from './auth/rbac.guard';

@Module({
  controllers: [AuthController, ProjectsController, ServicesController, DeploymentsController, ResourcesController, EnvironmentController, GitHubIntegrationController, AdminController],
  providers: [RAIBITSERVERService, { provide: APP_GUARD, useClass: RbacGuard }],
})
export class AppModule {}
