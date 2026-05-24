import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../../control-plane.module';
import { ResourceConsoleController } from './resource-console.controller';
import { ResourceLifecycleController, ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [ResourcesController, ResourceLifecycleController, ResourceConsoleController],
  providers: [ResourcesService],
})
export class ResourcesModule {}
