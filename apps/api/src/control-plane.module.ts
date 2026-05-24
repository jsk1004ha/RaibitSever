import { Global, Module } from '@nestjs/common';
import { RAIBITSERVERService } from './raibitserver.service';

@Global()
@Module({
  providers: [RAIBITSERVERService],
  exports: [RAIBITSERVERService],
})
export class ControlPlaneModule {}
