import { maskSecretValue } from './secrets.ts';

export const RUNTIME_KEY_CATALOG = Object.freeze([
  { name: 'RAIBITSERVER_AUTH_JWT_SECRET', category: 'auth', required: true, secret: true, description: 'HS256 JWT signing secret for signup/login and API sessions' },
  { name: 'RAIBITSERVER_SECRET_ENCRYPTION_KEY', category: 'secrets', required: true, secret: true, description: '32+ character key used by production secret stores before persisting credentials' },
  { name: 'RAIBITSERVER_GITHUB_CLIENT_ID', category: 'github', required: false, secret: false, description: 'GitHub OAuth/App client id' },
  { name: 'RAIBITSERVER_GITHUB_CLIENT_SECRET', category: 'github', required: false, secret: true, description: 'GitHub OAuth/App client secret' },
  { name: 'RAIBITSERVER_GITHUB_WEBHOOK_SECRET', category: 'github', required: false, secret: true, description: 'GitHub webhook HMAC verification secret' },
  { name: 'RAIBITSERVER_REGISTRY_USERNAME', category: 'registry', required: false, secret: false, description: 'Default image registry username' },
  { name: 'RAIBITSERVER_REGISTRY_PASSWORD', category: 'registry', required: false, secret: true, description: 'Default image registry password/token' },
  { name: 'DATABASE_URL', category: 'persistence', required: false, secret: true, description: 'PostgreSQL connection string used by Prisma persistence' },
  { name: 'RAIBITSERVER_POSTGRES_POOLER_HOST', category: 'provider', required: false, secret: false, description: 'PgBouncer host used for shared PostgreSQL resource DATABASE_URL injection' },
]);

export function runtimeConfigStatus(env: Record<string, any> = process.env) {
  return RUNTIME_KEY_CATALOG.map((item) => {
    const raw = env[item.name];
    const configured = raw !== undefined && raw !== null && String(raw).length > 0;
    return {
      ...item,
      configured,
      value: configured ? (item.secret ? maskSecretValue(raw) : String(raw)) : null,
    };
  });
}

export function assertRuntimeKeys(keys: string[], env: Record<string, any> = process.env) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    const error = new Error(`missing required runtime keys: ${missing.join(', ')}`);
    (error as any).statusCode = 500;
    throw error;
  }
  return true;
}

export function secretEncryptionConfigured(env: Record<string, any> = process.env) {
  return Boolean(env.RAIBITSERVER_SECRET_ENCRYPTION_KEY && String(env.RAIBITSERVER_SECRET_ENCRYPTION_KEY).length >= 32);
}
