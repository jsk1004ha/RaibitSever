export const TEAM_ROLES = Object.freeze(['owner', 'admin', 'developer', 'viewer', 'billing-manager', 'db-admin']);
export const PROJECT_ROLES = Object.freeze(['project-owner', 'maintainer', 'developer', 'viewer']);

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  admin: ['project:read', 'project:create', 'project:update', 'project:delete', 'service:create', 'service:update', 'deploy:run', 'env:write', 'env:read', 'db:create', 'db:delete', 'db:schema:read', 'team:invite', 'audit:read', 'billing:read', 'logs:read', 'metrics:read'],
  developer: ['project:read', 'deploy:run', 'logs:read', 'metrics:read', 'env:write-limited', 'db:schema:read'],
  viewer: ['project:read', 'logs:read', 'metrics:read'],
  'billing-manager': ['project:read', 'billing:read', 'billing:write', 'usage:read'],
  'db-admin': ['project:read', 'db:create', 'db:delete', 'db:connect', 'db:schema:read', 'db:data:read', 'db:query', 'db:query:write', 'backup:restore'],
  'project-owner': ['project:*'],
  maintainer: ['project:read', 'project:update', 'service:create', 'service:update', 'deploy:run', 'env:write', 'env:read', 'db:connect', 'db:schema:read', 'db:data:read', 'logs:read', 'metrics:read'],
});

export function can(role: any, action: any) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  if (action === 'env:write-limited' && permissions.includes('env:write')) return true;
  if (action === 'db:connect-limited' && permissions.includes('db:connect')) return true;
  if (action === 'db:schema:read' && (permissions.includes('db:connect') || permissions.includes('db:data:read'))) return true;
  if (action === 'db:data:read' && permissions.includes('db:connect')) return true;
  if (action === 'db:query:write' && permissions.includes('db:query')) return true;
  return permissions.includes('*')
    || permissions.includes(action)
    || permissions.some((permission) => permission.endsWith(':*') && action.startsWith(permission.slice(0, -1)));
}

export function assertCan(role: any, action: any) {
  if (!can(role, action)) {
    const err = new Error(`role ${role} cannot perform ${action}`);
    (err as any).statusCode = 403;
    throw err;
  }
  return true;
}

export function visibleEnvironment(environment: Record<string, any> = {}, role = 'viewer') {
  if (can(role, 'env:read')) return environment;
  if (can(role, 'env:write-limited') || can(role, 'db:schema:read')) {
    return Object.fromEntries(Object.keys(environment).map((key) => [key, '<restricted>']));
  }
  return {};
}
