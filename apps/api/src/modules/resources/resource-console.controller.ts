import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { ResourcesService } from './resources.service';

@Controller('resources/:resourceId/console')
export class ResourceConsoleController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @RequirePermission('db:connect-limited')
  @Get('schema')
  schema(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.resourceConsoleView(resourceId, 'schema', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('tables')
  tables(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.resourceConsoleView(resourceId, 'tables', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('tables/:table')
  tableRows(@Param('resourceId') resourceId: string, @Param('table') table: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.resourceConsoleView(resourceId, 'table', { ...(input || {}), table }, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('collections')
  collections(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.resourceConsoleView(resourceId, 'collections', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Get('keys')
  keys(@Param('resourceId') resourceId: string, @Query() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.resourceConsoleView(resourceId, 'keys', input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('query')
  query(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.queryResource(resourceId, input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('command')
  command(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.commandResource(resourceId, input || {}, req.raibitSubject);
  }

  @RequirePermission('db:connect-limited')
  @Post('browse')
  browse(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.resourcesService.browseResource(resourceId, input || {}, req.raibitSubject);
  }
}
