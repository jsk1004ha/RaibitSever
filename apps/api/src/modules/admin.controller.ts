import { Body, Controller, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator';
import { RAIBITSERVERService } from '../raibitserver.service';

@Controller('admin/users')
export class AdminController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('audit:read')
  @Post(':userId/approve')
  approve(@Param('userId') userId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.approveUser(userId, input || {}, req.raibitSubject);
  }

  @RequirePermission('audit:read')
  @Post(':userId/reject')
  reject(@Param('userId') userId: string, @Req() req: any) {
    return this.raibitServer.rejectUser(userId, req.raibitSubject);
  }

  @RequirePermission('audit:read')
  @Patch(':userId/quota')
  quota(@Param('userId') userId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.setUserQuota(userId, input || {}, req.raibitSubject);
  }
}
