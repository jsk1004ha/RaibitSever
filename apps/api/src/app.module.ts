import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RAIBITSERVERService } from './raibitserver.service';
import { ProjectsController } from './modules/projects/projects.controller';
import { ServiceDetailController, ServicesController } from './modules/services/services.controller';
import { DeploymentLogsController, DeploymentsController, ServiceDeploymentsController } from './modules/deployments/deployments.controller';
import { ResourcesController } from './modules/resources/resources.controller';
import { ResourceConsoleController } from './modules/resources/resource-console.controller';
import { AuthController } from './modules/auth/auth.controller';
import { EnvironmentController } from './modules/environment/environment.controller';
import { GitHubIntegrationController } from './modules/integrations/github.controller';
import { AdminController } from './modules/admin.controller';
import { UsageController } from './modules/usage.controller';
import { RbacGuard } from './auth/rbac.guard';

@Module({
  controllers: [AuthController, ProjectsController, ServicesController, ServiceDetailController, DeploymentsController, ServiceDeploymentsController, DeploymentLogsController, ResourcesController, ResourceConsoleController, EnvironmentController, GitHubIntegrationController, AdminController, UsageController],
  providers: [RAIBITSERVERService, { provide: APP_GUARD, useClass: RbacGuard }],
})
export class AppModule {}
