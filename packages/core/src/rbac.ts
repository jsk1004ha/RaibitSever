export const TEAM_ROLES = Object.freeze(['owner', 'admin', 'developer', 'viewer', 'billing-manager', 'db-admin']);
export const PROJECT_ROLES = Object.freeze(['project-owner', 'maintainer', 'developer', 'viewer']);

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  admin: ['project:create', 'project:delete', 'deploy:run', 'env:write', 'env:read', 'db:create', 'db:delete', 'db:connect', 'team:invite', 'audit:read', 'billing:read'],
  developer: ['project:create', 'deploy:run', 'logs:read', 'metrics:read', 'env:write-limited', 'db:connect-limited'],
  viewer: ['project:read', 'logs:read', 'metrics:read'],
  'billing-manager': ['billing:read', 'billing:write', 'usage:read'],
  'db-admin': ['db:create', 'db:delete', 'db:connect', 'db:query', 'backup:restore'],
  'project-owner': ['project:*'],
  maintainer: ['deploy:run', 'env:write', 'env:read', 'db:connect', 'logs:read', 'metrics:read'],
});

export function can(role, action) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('*')
    || permissions.includes(action)
    || permissions.some((permission) => permission.endsWith(':*') && action.startsWith(permission.slice(0, -1)));
}

export function assertCan(role, action) {
  if (!can(role, action)) {
    const err = new Error(`role ${role} cannot perform ${action}`);
    err.statusCode = 403;
    throw err;
  }
  return true;
}

export function visibleEnvironment(environment = {}, role = 'viewer') {
  if (can(role, 'env:read')) return environment;
  if (can(role, 'env:write-limited') || can(role, 'db:connect-limited')) {
    return Object.fromEntries(Object.keys(environment).map((key) => [key, '<restricted>']));
  }
  return {};
}
