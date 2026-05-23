import { normalizeResourceEngine } from './catalog.ts';
import { providerConnectionEnvForResource } from './resource-providers.ts';

type AnyRecord = Record<string, any>;

export function resourceTypeForEngine(engine: string) {
  if (['redis', 'valkey'].includes(engine)) return 'cache';
  if (engine === 'object-storage') return 'storage';
  if (['qdrant', 'vector-db'].includes(engine)) return 'vector';
  if (['nats', 'message-queue'].includes(engine)) return 'queue';
  return 'database';
}

export function prefixEnv(env: AnyRecord, envPrefix: any) {
  const prefix = String(envPrefix || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  if (!prefix) return { ...env };
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [`${prefix}_${key}`, value]));
}

export function providerEnvFromConnection(consoleResource: AnyRecord, resource: AnyRecord) {
  const providerConnection = consoleResource.providerConnection || {};
  const env = Object.fromEntries(Object.entries(providerConnection).filter(([key, value]) => /^[A-Z0-9_]+$/.test(key) && typeof value === 'string'));
  if (Object.keys(env).length) return env;
  return providerConnectionEnvForResource(resource);
}

export function providerConnectionFromEnv(env: Record<string, string>, engine: any, live: boolean) {
  const normalized = normalizeResourceEngine(engine);
  const connection: AnyRecord = { ...env, live, mode: live ? 'live-provider' : 'provider-contract' };
  const first = (...keys: string[]) => keys.map((key) => env[key]).find(Boolean);
  if (normalized === 'postgresql') connection.databaseUrl = first('DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL');
  else if (normalized === 'mysql') connection.url = first('MYSQL_URL');
  else if (normalized === 'mariadb') connection.url = first('MARIADB_URL', 'MYSQL_URL');
  else if (normalized === 'mongodb') connection.uri = first('MONGODB_URI', 'MONGO_URL');
  else if (normalized === 'redis') connection.url = first('REDIS_URL');
  else if (normalized === 'valkey') connection.url = first('VALKEY_URL', 'REDIS_URL');
  else if (normalized === 'sqlite') connection.databaseUrl = first('DATABASE_URL');
  else if (normalized === 'object-storage') connection.url = first('S3_ENDPOINT');
  else if (normalized === 'qdrant' || normalized === 'vector-db') connection.url = first('VECTOR_DB_URL', 'QDRANT_URL');
  else if (normalized === 'nats' || normalized === 'message-queue') connection.url = first('QUEUE_URL', 'NATS_URL');
  return connection;
}

export function isProviderConnectionSecret(secret: any, resourceId: string) {
  return secret
    && secret.scopeType === 'resource-provider-connection'
    && String(secret.scopeId) === String(resourceId)
    && Boolean(secret.key);
}

export function resourceQuotaMetric(resource: AnyRecord) {
  return String(resource?.type || '').toLowerCase() === 'storage' || String(resource?.engine || '').toLowerCase().includes('object') ? 'maxObjectStorageMb' : 'maxDbStorageMb';
}

export function resourceStorageMb(resource: AnyRecord, { includeDesiredState = false } = {}) {
  const spec = includeDesiredState ? { ...(resource.desiredSpec || {}), ...(resource.desiredState || {}), ...resource } : resource;
  if (spec.storageMb !== undefined) return Number(spec.storageMb || 0);
  if (spec.storageGb !== undefined) return Number(spec.storageGb || 0) * 1024;
  return 1;
}

export function usageMetricSum(records: AnyRecord[], aliases: string[]) {
  const names = new Set(aliases.map((alias) => alias.toLowerCase()));
  return records
    .filter((record) => names.has(String(record.metric || '').toLowerCase()))
    .reduce((sum, record) => sum + Number(record.value || 0), 0);
}

export function deploymentBuildMinutes(deployment: AnyRecord) {
  const start = dateMs(deployment.buildStartedAt || deployment.startedAt);
  const end = dateMs(deployment.buildFinishedAt || deployment.finishedAt);
  return start && end && end > start ? (end - start) / 60_000 : 0;
}

export function deploymentRuntimeHours(deployment: AnyRecord) {
  const start = dateMs(deployment.deployedAt);
  const end = dateMs(deployment.finishedAt) || Date.now();
  return start && end > start ? (end - start) / 3_600_000 : 0;
}

export function serviceCpuMillicores(service: AnyRecord) {
  const spec = service.desiredSpec || service.desiredState || service;
  return parseCpuMillicores(spec.cpu || spec.cpuRequest || spec.resources?.requests?.cpu || spec.resources?.limits?.cpu);
}

export function serviceMemoryMb(service: AnyRecord) {
  const spec = service.desiredSpec || service.desiredState || service;
  return parseMemoryMb(spec.memory || spec.memoryMb || spec.memoryRequest || spec.resources?.requests?.memory || spec.resources?.limits?.memory);
}

export function dateMs(value: any) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function parseCpuMillicores(value: any) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim();
  if (text.endsWith('m')) return Number(text.slice(0, -1)) || 0;
  const number = Number(text);
  return Number.isFinite(number) ? number * 1000 : 0;
}

function parseMemoryMb(value: any) {
  if (value === null || value === undefined || value === '') return 0;
  const text = String(value).trim().toLowerCase();
  const number = Number(text.replace(/[a-z]+$/, ''));
  if (!Number.isFinite(number)) return 0;
  if (text.endsWith('gi') || text.endsWith('gib')) return number * 1024;
  if (text.endsWith('gb')) return number * 1000;
  if (text.endsWith('ki') || text.endsWith('kib')) return number / 1024;
  if (text.endsWith('kb')) return number / 1000;
  return number;
}
