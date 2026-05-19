import { Body, Controller, Post } from '@nestjs/common';
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
}
