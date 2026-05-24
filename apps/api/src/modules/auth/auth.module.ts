import { Module } from '@nestjs/common';
import { ControlPlaneModule } from '../../control-plane.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [ControlPlaneModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
