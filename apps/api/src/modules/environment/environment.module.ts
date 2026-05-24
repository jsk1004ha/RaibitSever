import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../../control-plane.module';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from './environment.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [EnvironmentController],
  providers: [EnvironmentService],
})
export class EnvironmentModule {}
