import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { RAIBITSERVERService } from '../../raibitserver.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly raibitServer: RAIBITSERVERService) {}

  @Post('signup')
  signup(@Body() input: Record<string, any>) {
    return this.raibitServer.signup(input);
  }

  @Post('login')
  login(@Body() input: Record<string, any>) {
    return this.raibitServer.login(input);
  }

  @Get('github/login')
  githubLogin(@Query() input: Record<string, any>) {
    return this.raibitServer.githubLogin(input || {});
  }

  @Get('github/callback')
  githubCallback(@Query() input: Record<string, any>) {
    return this.raibitServer.githubCallback(input || {});
  }

  @RequirePermission('project:read')
  @Get('me')
  me(@Req() req: any) {
    return this.raibitServer.currentUser(req.raibitSubject);
  }

  @RequirePermission('project:read')
  @Post('logout')
  @HttpCode(200)
  logout() {
    return { ok: true };
  }
}
