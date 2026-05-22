import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller('resources/:resourceId/console')
export class ResourceConsoleController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('db:connect-limited')
  @Post('query')
  query(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.queryResource(resourceId, input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('browse')
  browse(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.browseResource(resourceId, input || {}, req.raibitSubject);
  }
}
