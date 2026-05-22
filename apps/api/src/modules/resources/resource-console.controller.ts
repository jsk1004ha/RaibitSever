import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller('resources/:resourceId/console')
export class ResourceConsoleController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('db:connect-limited')
  @Get('schema')
  schema(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.resourceConsoleView(resourceId, 'schema', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('tables')
  tables(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.resourceConsoleView(resourceId, 'tables', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('collections')
  collections(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.resourceConsoleView(resourceId, 'collections', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('keys')
  keys(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.resourceConsoleView(resourceId, 'keys', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('query')
  query(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.queryResource(resourceId, input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('command')
  command(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.commandResource(resourceId, input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('browse')
  browse(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.browseResource(resourceId, input || {}, req.raibitSubject);
  }
}
