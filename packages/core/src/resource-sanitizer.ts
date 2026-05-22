import path from 'node:path';
import { isSecretKey } from './secrets.ts';

const SAFE_RESOURCE_KEYS = new Set([
  'projectId',
  'name',
  'slug',
  'type',
  'engine',
  'provider',
  'plan',
  'region',
  'version',
  'status',
  'storageMb',
  'storageGb',
  'databaseName',
  'database',
  'username',
  'bucket',
  'collection',
  'topic',
  'backup',
  'desiredSpec',
]);

const BLOCKED_CONNECTION_KEYS = new Set([
  'providerconnection',
  'providercredentials',
  'providercredential',
  'connection',
  'credentials',
  'credential',
  'connectionurl',
  'connectionsecretname',
  'connectionstring',
  'dsn',
  'databaseurl',
  'databaseuri',
  'dburl',
  'dburi',
  'pgurl',
  'pguri',
  'pgdsn',
  'pgconnectionstring',
  'pgconnectionurl',
  'pgconnectionuri',
  'jdbcurl',
  'odbcurl',
  'postgresurl',
  'postgresqlurl',
  'postgresuri',
  'postgresqluri',
  'sqlitepath',
  'mysqlurl',
  'mysqluri',
  'mariadburl',
  'mariadburi',
  'mongodburi',
  'mongouri',
  'mongoconnectionuri',
  'redisurl',
  'redisuri',
  'valkeyurl',
  'valkeyuri',
  'url',
  'uri',
  'password',
  'token',
  'secret',
  'apikey',
  'accesskey',
  'secretkey',
]);

export function sanitizeTenantResourceInput(input: Record<string, any> = {}) {
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_RESOURCE_KEYS.has(key)) continue;
    if (isBlockedConnectionKey(key)) continue;
    output[key] = sanitizeResourceValue(value);
  }
  return output;
}

export function providerOwnedSqlitePath(resourceId: string) {
  const name = String(resourceId || 'resource').replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 120) || 'resource';
  return path.join(providerOwnedSqliteRoot(), `${name}.sqlite`);
}

export function providerOwnedSqliteRoot() {
  return path.resolve('.raibitserver-work', 'sqlite');
}

export function isProviderOwnedSqlitePath(candidate: string) {
  if (!candidate || candidate === ':memory:') return true;
  const resolved = path.resolve(candidate);
  const root = providerOwnedSqliteRoot();
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function sanitizeResourceValue(value: any): any {
  if (Array.isArray(value)) return value.map((item) => sanitizeResourceValue(item));
  if (!value || typeof value !== 'object') return value;
  const output: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isBlockedConnectionKey(key)) continue;
    output[key] = sanitizeResourceValue(child);
  }
  return output;
}

function isBlockedConnectionKey(key: string) {
  const raw = String(key || '');
  const normalized = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (BLOCKED_CONNECTION_KEYS.has(normalized) || isSecretKey(raw) || isSecretKey(normalized)) return true;
  const hasConnectionPrefix = /(?:^|database|db|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|valkey|sqlite|jdbc|odbc)connection/.test(normalized)
    || normalized.startsWith('connection');
  const hasConnectionSuffix = /(url|uri|dsn|string|connstr|connectionstring)$/.test(normalized);
  const hasProviderPrefix = /^(database|db|pg|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|valkey|sqlite|jdbc|odbc)/.test(normalized);
  return (hasConnectionPrefix && hasConnectionSuffix)
    || (hasProviderPrefix && hasConnectionSuffix)
    || /^connection.*(url|uri|dsn|string)$/.test(normalized);
}
