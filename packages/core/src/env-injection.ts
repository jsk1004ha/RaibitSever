import { getCatalogEntry, normalizeResourceEngine } from './catalog.ts';
import { slugify } from './ids.ts';

type AnyRecord = Record<string, any>;

function hostFor(resource: AnyRecord, projectSlug: any) {
  return resource.poolerHost || resource.providerHost || resource.sharedHost || resource.internalHost || resource.host || defaultSharedProviderHost(normalizeResourceEngine(resource.engine || resource.type), projectSlug || resource.projectSlug);
}

function userFor(resource: AnyRecord, projectSlug: any) {
  return resource.username || sharedTenantName(resource, 'app', projectSlug);
}

function passwordFor(resource: AnyRecord, projectSlug: any, engine: string) {
  return resource.password || resource.generatedPassword || resource.desiredSpec?.password || resource.desiredState?.password || deterministicProviderPassword(resource, projectSlug, engine);
}

function databaseFor(resource: AnyRecord, projectSlug: any) {
  return resource.databaseName || sharedTenantName(resource, 'db', projectSlug).replace(/-/g, '_');
}

export function connectionEnvForResource(resource: AnyRecord, projectSlug = 'project') {
  const engine = normalizeResourceEngine(resource.engine || resource.type);
  const entry = getCatalogEntry(engine);
  const host = hostFor(resource, projectSlug);
  const port = resource.port || defaultPort(engine);
  const username = userFor(resource, projectSlug);
  const password = passwordFor(resource, projectSlug, engine);
  const database = databaseFor(resource, projectSlug);
  const bucket = resource.bucket || slugify(resource.name || 'bucket');
  const protocol = resource.tls ? 'rediss' : 'redis';
  const connectionLimit = connectionLimitForResource(resource);

  const env: AnyRecord = {};
  switch (entry.key) {
    case 'postgresql':
      env.DATABASE_URL = appendConnectionLimit(`postgresql://${username}:${password}@${host}:${port}/${database}`, connectionLimit);
      env.POSTGRES_URL = env.DATABASE_URL;
      env.PGHOST = host;
      env.PGPORT = String(port);
      env.PGDATABASE = database;
      env.PGUSER = username;
      env.PGPASSWORD = password;
      if (connectionLimit) env.PG_CONNECTION_LIMIT = String(connectionLimit);
      break;
    case 'mysql':
    case 'mariadb':
      env.MYSQL_URL = appendConnectionLimit(`mysql://${username}:${password}@${host}:${port}/${database}`, connectionLimit);
      env.MYSQL_HOST = host;
      env.MYSQL_PORT = String(port);
      env.MYSQL_DATABASE = database;
      env.MYSQL_USER = username;
      env.MYSQL_PASSWORD = password;
      if (connectionLimit) env.MYSQL_CONNECTION_LIMIT = String(connectionLimit);
      if (entry.key === 'mariadb') env.MARIADB_URL = env.MYSQL_URL;
      break;
    case 'mongodb':
      env.MONGODB_URI = `mongodb://${username}:${password}@${host}:${port}/${database}`;
      env.MONGO_URL = env.MONGODB_URI;
      env.MONGO_HOST = host;
      env.MONGO_DATABASE = database;
      env.MONGO_USER = username;
      env.MONGO_PASSWORD = password;
      break;
    case 'sqlite':
      env.SQLITE_PATH = resource.sqlitePath || `/data/${slugify(resource.name || 'app')}.db`;
      env.DATABASE_URL = `sqlite:${env.SQLITE_PATH}`;
      break;
    case 'redis':
    case 'valkey':
      env.REDIS_USERNAME = username;
      env.REDIS_URL = `${protocol}://${username}:${password}@${host}:${port}`;
      if (entry.key === 'valkey') env.VALKEY_URL = env.REDIS_URL;
      env.REDIS_HOST = host;
      env.REDIS_PORT = String(port);
      env.REDIS_PASSWORD = password;
      env.REDIS_KEY_PREFIX = redisKeyPrefixFor(resource, projectSlug);
      if (entry.key === 'valkey') env.VALKEY_KEY_PREFIX = env.REDIS_KEY_PREFIX;
      break;
    case 'object-storage':
      env.S3_ENDPOINT = resource.endpoint || `https://${host}`;
      env.S3_BUCKET = bucket;
      env.S3_REGION = resource.region || 'local';
      env.S3_ACCESS_KEY = resource.accessKey || deterministicProviderPlaceholder(resource, projectSlug, engine, 'access-key');
      env.S3_SECRET_KEY = resource.secretKey || deterministicProviderPlaceholder(resource, projectSlug, engine, 'secret-key');
      break;
    case 'vector-db':
    case 'qdrant':
      env.VECTOR_DB_URL = resource.url || `http://${host}:${port}`;
      env.VECTOR_DB_API_KEY = resource.apiKey || deterministicProviderPlaceholder(resource, projectSlug, engine, 'api-key');
      env.VECTOR_DB_COLLECTION = resource.collection || slugify(resource.name || 'collection');
      break;
    case 'message-queue':
    case 'nats':
      env.QUEUE_URL = resource.url || `nats://${host}:${port}`;
      env.QUEUE_USERNAME = username;
      env.QUEUE_PASSWORD = password;
      env.QUEUE_TOPIC = resource.topic || slugify(resource.name || 'events');
      break;
    default:
      throw new Error(`unsupported resource: ${engine}`);
  }
  return env;
}

function defaultSharedProviderHost(engine: string, projectSlug: any) {
  const project = slugify(projectSlug || 'project');
  if (engine === 'postgresql') return process.env.RAIBITSERVER_POSTGRES_POOLER_HOST || `pgbouncer.shared-providers.svc.cluster.local`;
  if (engine === 'mysql' || engine === 'mariadb') return `mysql.shared-providers.svc.cluster.local`;
  if (engine === 'mongodb') return `mongodb.shared-providers.svc.cluster.local`;
  if (engine === 'redis') return `redis.shared-providers.svc.cluster.local`;
  if (engine === 'valkey') return `valkey.shared-providers.svc.cluster.local`;
  const name = slugify(engine || 'resource');
  return `${name}.${project}.svc.cluster.local`;
}

function sharedTenantName(resource: AnyRecord, suffix: string, projectSlug: any) {
  const project = slugify(uniqueTenantScope(resource, projectSlug)).replace(/-/g, '_');
  const name = slugify(resource.name || resource.engine || suffix).replace(/-/g, '_');
  return `${project}_${name}_${suffix}`.slice(0, 63);
}

function redisKeyPrefixFor(resource: AnyRecord, projectSlug: any) {
  const fallback = `${slugify(uniqueTenantScope(resource, projectSlug))}:${slugify(resource.name || 'cache')}:`;
  const raw = String(resource.keyPrefix || fallback).replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 128) || fallback;
  return raw.endsWith(':') ? raw : `${raw}:`;
}

function uniqueTenantScope(resource: AnyRecord, projectSlug: any) {
  const explicit = projectSlug || resource.projectSlug || resource.project;
  if (explicit) return explicit;
  const parts = [resource.organizationId, resource.projectId, resource.id]
    .filter((value) => value !== undefined && value !== null && String(value).length > 0)
    .map((value) => slugify(value));
  if (parts.length) return parts.join('-').slice(0, 48);
  return 'project';
}

function deterministicProviderPassword(resource: AnyRecord, projectSlug: any, engine: string) {
  return deterministicProviderPlaceholder(resource, projectSlug, engine);
}

function deterministicProviderPlaceholder(resource: AnyRecord, projectSlug: any, engine: string, suffix = '') {
  const project = slugify(projectSlug || resource.projectSlug || resource.project || 'project');
  const name = slugify(resource.name || resource.slug || engine || 'resource');
  const suffixPart = suffix ? `-${slugify(suffix)}` : '';
  return `provider-managed-${project}-${name}${suffixPart}`.slice(0, 96);
}

function connectionLimitForResource(resource: AnyRecord) {
  const explicit = resource.connectionLimit ?? resource.maxConnections ?? resource.desiredState?.connectionLimit ?? resource.desiredSpec?.connectionLimit;
  if (explicit !== undefined && explicit !== null && explicit !== '') return clampConnectionLimit(explicit);
  const plan = String(resource.plan || resource.tier || resource.desiredState?.plan || resource.desiredSpec?.plan || '').toLowerCase();
  if (plan === 'shared-small' || plan === 'shared' || plan.startsWith('shared-')) return 3;
  return null;
}

function clampConnectionLimit(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
}

function appendConnectionLimit(url: string, limit: number | null) {
  if (!limit) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${limit}`;
}

export function injectResourceEnv(service: AnyRecord, resources: AnyRecord[] = [], projectSlug = 'project', options: AnyRecord = {}) {
  const base = { ...(service.environment || {}) };
  const attachedNames = new Set(service.attachedResources || resources.map((resource) => resource.name));
  const resourceEnvByName = options.resourceEnvByName || {};
  for (const resource of resources) {
    if (!attachedNames.has(resource.name)) continue;
    Object.assign(base, resourceEnvByName[resource.name] || connectionEnvForResource(resource, projectSlug));
  }
  return base;
}

function defaultPort(engine: string) {
  switch (engine) {
    case 'postgresql': return 5432;
    case 'mysql':
    case 'mariadb': return 3306;
    case 'mongodb': return 27017;
    case 'redis':
    case 'valkey': return 6379;
    case 'sqlite': return 0;
    case 'object-storage': return 9000;
    case 'vector-db':
    case 'qdrant': return 6333;
    case 'message-queue':
    case 'nats': return 4222;
    default: return 0;
  }
}
