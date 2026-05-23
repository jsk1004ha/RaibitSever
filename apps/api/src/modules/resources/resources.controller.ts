import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';
import type { ResourceSpec } from '@raibitserver/schemas';

@Controller('projects/:projectId/resources')
export class ResourcesController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  list(@Param('projectId') projectId: string, @Req() req: any) {
    return this.raibitServer.listResources(projectId, req.raibitSubject);
  }

  @RequirePermission('db:create')
  @Post()
  create(@Param('projectId') projectId: string, @Body() resource: ResourceSpec, @Req() req: any) {
    return this.raibitServer.addResource(projectId, resource, req.raibitSubject);
  }
}

@Controller('resources/:resourceId')
export class ResourceLifecycleController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('project:read')
  @Get()
  get(@Param('resourceId') resourceId: string, @Req() req: any) {
    return this.raibitServer.getResource(resourceId, req.raibitSubject);
  }

  @RequirePermission('db:create')
  @Patch()
  update(@Param('resourceId') resourceId: string, @Body() updates: Record<string, any>, @Req() req: any) {
    return this.raibitServer.updateResource(resourceId, updates, req.raibitSubject);
  }

  @RequirePermission('db:delete')
  @Delete()
  delete(@Param('resourceId') resourceId: string, @Req() req: any) {
    return this.raibitServer.deleteResource(resourceId, req.raibitSubject);
  }

  @RequirePermission('db:create')
  @Post('attach')
  attach(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.attachResource(resourceId, input, req.raibitSubject);
  }

  @RequirePermission('db:create')
  @Post('provision')
  provision(@Param('resourceId') resourceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.provisionResource(resourceId, input, req.raibitSubject);
  }
}
