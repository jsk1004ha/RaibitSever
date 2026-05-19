import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authorizeRequest } from '@raibitserver/core';
import { RAIBITSERVER_PERMISSION } from './permissions.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<string>(RAIBITSERVER_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!permission) return true;
    const req = context.switchToHttp().getRequest();
    // Scope checks need repository/project ownership context; controllers/services
    // enforce that after the action-level RBAC check succeeds.
    req.raibitSubject = authorizeRequest(req, permission, authConfig());
    return true;
  }
}

function authConfig() {
  const jwtSecret = process.env.RAIBITSERVER_AUTH_JWT_SECRET || '';
  const disabled = process.env.RAIBITSERVER_AUTH_DISABLED === '1';
  return {
    mode: disabled ? 'disabled' : 'jwt',
    allowDisabled: disabled,
    jwtSecret,
    issuer: process.env.RAIBITSERVER_AUTH_ISSUER || 'raibitserver',
    allowDevHeaders: process.env.RAIBITSERVER_AUTH_DEV_HEADERS === '1',
    defaultRole: process.env.RAIBITSERVER_ROLE || 'owner',
  };
}
