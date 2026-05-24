import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../../control-plane.module';
import { ServiceDetailController, ServicesController } from './services.controller';
import { ServicesService } from './services.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [ServicesController, ServiceDetailController],
  providers: [ServicesService],
})
export class ServicesModule {}
