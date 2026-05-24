import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { RequirePermission } from '../../auth/permissions.decorator';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() input: Record<string, any>) {
    return this.authService.signup(input);
  }

  @Post('login')
  login(@Body() input: Record<string, any>) {
    return this.authService.login(input);
  }

  @Get('github/login')
  githubLogin(@Query() input: Record<string, any>) {
    return this.authService.githubLogin(input || {});
  }

  @Get('github/callback')
  githubCallback(@Query() input: Record<string, any>) {
    return this.authService.githubCallback(input || {});
  }

  @RequirePermission('project:read')
  @Get('me')
  me(@Req() req: any) {
    return this.authService.currentUser(req.raibitSubject);
  }

  @RequirePermission('project:read')
  @Post('logout')
  @HttpCode(200)
  logout() {
    return { ok: true };
  }
}
