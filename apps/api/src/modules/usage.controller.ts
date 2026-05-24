import { Controller, Get, Req } from '@nestjs/common';
import { RequirePermission } from '../auth/permissions.decorator';
import { UsageService } from './usage.service';

@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @RequirePermission('metrics:read')
  @Get('me')
  me(@Req() req: any) {
    return this.usageService.usageMe(req.raibitSubject);
  }
}
