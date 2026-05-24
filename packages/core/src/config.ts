import { maskSecretValue } from './secrets.ts';

type EnvRecord = Record<string, any>;

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

export function runtimeConfigStatus(env: EnvRecord = process.env) {
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

export function assertRuntimeKeys(keys: string[], env: EnvRecord = process.env) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    const error = new Error(`missing required runtime keys: ${missing.join(', ')}`);
    (error as any).statusCode = 500;
    throw error;
  }
  return true;
}

export function secretEncryptionConfigured(env: EnvRecord = process.env) {
  return Boolean(env.RAIBITSERVER_SECRET_ENCRYPTION_KEY && String(env.RAIBITSERVER_SECRET_ENCRYPTION_KEY).length >= 32);
}

export function parseApiRuntimeConfig(env: EnvRecord = process.env) {
  const nodeEnv = stringValue(env.NODE_ENV || 'development');
  const production = nodeEnv === 'production';
  const port = optionalPort(env.PORT, 'PORT');
  const authRateLimit = optionalPositiveInteger(env.RAIBITSERVER_AUTH_RATE_LIMIT, 'RAIBITSERVER_AUTH_RATE_LIMIT') ?? 10;
  const jwtSecret = stringValue(env.RAIBITSERVER_AUTH_JWT_SECRET || '');
  const secretEncryptionKey = stringValue(env.RAIBITSERVER_SECRET_ENCRYPTION_KEY || '');
  const authDisabledRequested = env.RAIBITSERVER_AUTH_DISABLED === '1';
  const authDisabledConfirmed = env.RAIBITSERVER_AUTH_DISABLED_CONFIRM === 'I_UNDERSTAND_THIS_GRANTS_GLOBAL_OWNER';
  const authMode = authDisabledRequested && authDisabledConfirmed && !production ? 'disabled' : 'jwt';
  return {
    nodeEnv,
    production,
    port: port ?? 3000,
    auth: {
      mode: authMode,
      issuer: stringValue(env.RAIBITSERVER_AUTH_ISSUER || 'raibitserver'),
      jwtSecret,
      rateLimit: authRateLimit,
      allowDevHeaders: env.RAIBITSERVER_AUTH_DEV_HEADERS === '1' && !production,
    },
    secrets: {
      encryptionConfigured: secretEncryptionKey.length >= 32,
    },
    persistence: {
      databaseUrlConfigured: Boolean(env.DATABASE_URL),
    },
  };
}

export function validateApiRuntimeConfig(env: EnvRecord = process.env) {
  const issues: Array<{ key: string; code: string; message: string }> = [];
  const nodeEnv = stringValue(env.NODE_ENV || 'development');
  const production = nodeEnv === 'production';
  capture(() => optionalPort(env.PORT, 'PORT'), issues);
  capture(() => optionalPositiveInteger(env.RAIBITSERVER_AUTH_RATE_LIMIT, 'RAIBITSERVER_AUTH_RATE_LIMIT'), issues);

  if (production && env.RAIBITSERVER_AUTH_DISABLED === '1') {
    issues.push({ key: 'RAIBITSERVER_AUTH_DISABLED', code: 'UNSAFE_PRODUCTION_AUTH_DISABLED', message: 'RAIBITSERVER_AUTH_DISABLED is forbidden when NODE_ENV=production' });
  }
  if (production && env.RAIBITSERVER_AUTH_DEV_HEADERS === '1') {
    issues.push({ key: 'RAIBITSERVER_AUTH_DEV_HEADERS', code: 'UNSAFE_PRODUCTION_DEV_HEADERS', message: 'development auth headers are forbidden when NODE_ENV=production' });
  }
  if (production && stringValue(env.RAIBITSERVER_AUTH_JWT_SECRET || '').length < 32) {
    issues.push({ key: 'RAIBITSERVER_AUTH_JWT_SECRET', code: 'WEAK_JWT_SECRET', message: 'RAIBITSERVER_AUTH_JWT_SECRET must be at least 32 characters in production' });
  }
  if (production && !secretEncryptionConfigured(env)) {
    issues.push({ key: 'RAIBITSERVER_SECRET_ENCRYPTION_KEY', code: 'MISSING_SECRET_ENCRYPTION_KEY', message: 'RAIBITSERVER_SECRET_ENCRYPTION_KEY must be at least 32 characters in production' });
  }
  return {
    ok: issues.length === 0,
    issues,
    config: issues.length === 0 ? parseApiRuntimeConfig(env) : null,
  };
}

export function assertApiRuntimeConfig(env: EnvRecord = process.env) {
  const result = validateApiRuntimeConfig(env);
  if (!result.ok) {
    const error = new Error(`invalid API runtime configuration: ${result.issues.map((issue) => `${issue.key} ${issue.code}`).join(', ')}`);
    (error as any).statusCode = 500;
    (error as any).issues = result.issues;
    throw error;
  }
  return result.config;
}

function optionalPort(value: any, key: string) {
  if (value === undefined || value === null || value === '') return null;
  const port = optionalPositiveInteger(value, key);
  if (port === null) return null;
  if (port > 65535) throw configError(key, 'INVALID_PORT', `${key} must be between 1 and 65535`);
  return port;
}

function optionalPositiveInteger(value: any, key: string) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) throw configError(key, 'INVALID_POSITIVE_INTEGER', `${key} must be a positive integer`);
  return normalized;
}

function capture(fn: () => any, issues: Array<{ key: string; code: string; message: string }>) {
  try {
    fn();
  } catch (error) {
    if ((error as any)?.key && (error as any)?.code) {
      issues.push({ key: (error as any).key, code: (error as any).code, message: (error as any).message });
      return;
    }
    throw error;
  }
}

function configError(key: string, code: string, message: string) {
  const error = new Error(message);
  (error as any).key = key;
  (error as any).code = code;
  return error;
}

function stringValue(value: any) {
  return String(value || '').trim();
}
