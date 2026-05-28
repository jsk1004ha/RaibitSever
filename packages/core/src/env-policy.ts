import { can } from './rbac.ts';
import { isSecretKey } from './secrets.ts';

export function secretEnvironmentKeys(entries: Array<Record<string, any>> = []) {
  return entries
    .filter((entry) => entry.isSecret === true || isSecretKey(entry.key))
    .map((entry) => entry.key);
}

export function assertEnvironmentWriteAllowed(subject: Record<string, any>, entries: Array<Record<string, any>> = []) {
  if (can(subject.role, 'env:write')) return true;
  const secretKeys = secretEnvironmentKeys(entries);
  if (secretKeys.length) {
    const error = new Error(`role ${subject.role} requires env:write to modify secret environment keys: ${secretKeys.join(', ')}`);
    (error as any).statusCode = 403;
    throw error;
  }
  return true;
}
