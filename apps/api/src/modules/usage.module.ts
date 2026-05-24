import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../control-plane.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [UsageController],
  providers: [UsageService],
})
export class UsageModule {}
