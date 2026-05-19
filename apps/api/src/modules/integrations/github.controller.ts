import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller()
export class GitHubIntegrationController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @RequirePermission('team:invite')
  @Post('integrations/github')
  connect(@Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.connectGitHub(input, req.raibitSubject);
  }

  @RequirePermission('project:read')
  @Get('integrations/github')
  list(@Query('organizationId') organizationId: string, @Req() req: any) {
    return this.raibitServer.listGitHub(organizationId || req.raibitSubject.organizationId, req.raibitSubject);
  }

  @RequirePermission('deploy:run')
  @Post('projects/:projectId/services/:serviceId/github')
  attach(@Param('projectId') projectId: string, @Param('serviceId') serviceId: string, @Body() input: Record<string, any>, @Req() req: any) {
    return this.raibitServer.attachGitHub(projectId, serviceId, input, req.raibitSubject);
  }
}
