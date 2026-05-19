import { SetMetadata } from '@nestjs/common';

export const RAIBITSERVER_PERMISSION = 'raibitserver:permission';
export const RequirePermission = (permission: string) => SetMetadata(RAIBITSERVER_PERMISSION, permission);
