import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { EnvironmentService } from './environment.service';

@Controller('projects/:projectId/services/:serviceId')
export class EnvironmentController {
  constructor(private readonly environmentService: EnvironmentService) {}

  @RequirePermission('env:read')
  @Get('env')
  list(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Req() req: any) {
    return this.environmentService.listEnvironment(projectId, serviceId, req.raibitSubject);
  }

  @RequirePermission('env:write-limited')
  @Post('env')
  upsert(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.environmentService.upsertEnvironment(projectId, serviceId, input, req.raibitSubject);
  }

  @RequirePermission('env:write-limited')
  @Post('env-file')
  upload(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.environmentService.importEnvironmentFile(projectId, serviceId, input, req.raibitSubject);
  }
}
