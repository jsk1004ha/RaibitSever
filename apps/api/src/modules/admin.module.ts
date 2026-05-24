import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../control-plane.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
