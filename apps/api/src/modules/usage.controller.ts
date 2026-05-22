import { Controller, Get, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator';
import { RAIBITSERVERService } from '../raibitserver.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('metrics:read')
  @Get('me')
  me(@Req() req: any) {
    return this.raibitServer.usageMe(req.raibitSubject);
  }
}
