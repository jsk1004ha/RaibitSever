import path from 'node:path';
import { runCommand, commandToString, type CommandSpec } from './command-runner.ts';
import { secureRandomSecret } from './secret-vault.ts';
import { maskSecretValue, maskSecrets } from './secrets.ts';
import { slugify } from './ids.ts';

const SQL_IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;

type AnyRecord = Record<string, any>;

export function buildPostgresProviderPlan(resource: AnyRecord = {}, options: AnyRecord = {}) {
  const databaseName = safeSqlIdentifier(resource.databaseName || resource.database || resource.name || 'app');
  const username = safeSqlIdentifier(resource.username || `${databaseName}_app`);
  const password = String(options.password || resource.generatedPassword || (options.generatePassword === true ? secureRandomSecret(24) : '<generated-provider-password>'));
  const host = options.host || resource.host || `${slugify(resource.name || databaseName)}.${slugify(resource.projectSlug || resource.project || 'project')}.svc.cluster.local`;
  const port = Number(options.port || resource.port || 5432);
  const databaseUrl = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${databaseName}`;
  const adminUrl = options.adminUrl || options.providerAdminUrl || process.env.RAIBITSERVER_POSTGRES_PROVIDER_URL || process.env.POSTGRES_PROVIDER_URL || null;
  const sqlStatements = [
    `CREATE USER ${quoteIdent(username)} WITH PASSWORD ${quoteLiteral(password)}`,
    `CREATE DATABASE ${quoteIdent(databaseName)} OWNER ${quoteIdent(username)}`,
    `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(databaseName)} TO ${quoteIdent(username)}`,
  ];
  const sql = `${sqlStatements.join(';\n')};\n`;
  const adminCommand = psqlCommand(adminUrl || '<provider-admin-url>', ['--set', 'ON_ERROR_STOP=1'], sql);
  const testCommand = psqlCommand(databaseUrl, ['--command', 'SELECT 1 AS raibitserver_connection_test'], '');
  const backupPath = options.backupPath || path.posix.join('/backups', `${slugify(resource.name || databaseName)}-${new Date(0).toISOString().slice(0, 10)}.dump`);
  const backupCommand = { executable: 'pg_dump', args: ['--dbname', databaseUrl, '--format=custom', '--file', backupPath], redacted: `pg_dump --dbname ${maskSecretValue(databaseUrl)} --format=custom --file ${backupPath}` } satisfies CommandSpec;
  const restoreCommand = { executable: 'pg_restore', args: ['--dbname', databaseUrl, '--clean', '--if-exists', backupPath], redacted: `pg_restore --dbname ${maskSecretValue(databaseUrl)} --clean --if-exists ${backupPath}` } satisfies CommandSpec;
  const plan = {
    engine: 'postgresql',
    provider: options.provider || resource.provider || 'postgresql-direct',
    databaseName,
    username,
    host,
    port,
    databaseUrlMasked: maskSecretValue(databaseUrl),
    sqlStatements: sqlStatements.map((statement) => statement.replace(quoteLiteral(password), quoteLiteral('****'))),
    commands: {
      create: commandToString(adminCommand),
      test: commandToString(testCommand),
      backup: commandToString(backupCommand),
      restore: commandToString(restoreCommand),
    },
    secret: { key: 'DATABASE_URL', valueMasked: maskSecretValue(databaseUrl), providerOwned: true },
    lifecycle: ['create-user', 'create-database', 'grant-privileges', 'store-provider-secret', 'connection-test', 'backup-plan', 'restore-plan'],
  } as AnyRecord;
  Object.defineProperty(plan, 'internal', { value: { adminUrl, sql, databaseUrl, adminCommand, testCommand, backupCommand, restoreCommand }, enumerable: false });
  return plan;
}

export async function provisionPostgresProvider(resource: AnyRecord = {}, options: AnyRecord = {}) {
  const plan = buildPostgresProviderPlan(resource, { generatePassword: true, ...options });
  const dryRun = options.dryRun !== false || options.execute !== true;
  if (!dryRun && !plan.internal.adminUrl) throw new Error('RAIBITSERVER_POSTGRES_PROVIDER_URL or providerAdminUrl is required for live PostgreSQL provisioning');
  const steps = [];
  steps.push({ type: 'postgres-create-user-database-grants', ...(await runCommand(plan.internal.adminCommand, { dryRun, timeoutMs: options.timeoutMs || 30_000 })) });
  steps.push({ type: 'postgres-connection-test', ...(await runCommand(plan.internal.testCommand, { dryRun, timeoutMs: options.timeoutMs || 10_000 })) });
  const result = {
    engine: 'postgresql',
    provider: plan.provider,
    status: 'ready',
    dryRun,
    databaseName: plan.databaseName,
    username: plan.username,
    databaseUrlMasked: plan.databaseUrlMasked,
    connectionSecret: plan.secret,
    backup: { command: plan.commands.backup },
    restore: { command: plan.commands.restore },
    steps: steps.map((step) => maskSecrets(step)),
    plan: publicProviderPlan(plan),
  } as AnyRecord;
  Object.defineProperty(result, 'databaseUrl', { value: plan.internal.databaseUrl, enumerable: false });
  return result;
}

export function providerConsoleSurface(resource: AnyRecord = {}, options: AnyRecord = {}) {
  const engine = normalizedEngine(resource.engine || resource.type);
  const desired = { ...(resource.desiredSpec || {}), ...(resource.desiredState || {}) };
  if (engine === 'redis' || engine === 'valkey') {
    const keys = Array.isArray(options.keys) ? options.keys : Array.isArray(desired.keys) ? desired.keys : [];
    return { engine, keys: keys.map(String).slice(0, clamp(options.limit, 1, 1000, 100)), mode: keys.length ? 'deterministic-adapter' : 'provider-contract', command: 'SCAN 0 MATCH * COUNT 100', warning: keys.length ? undefined : `${engine} key browser requires provider-owned REDIS_URL or adapter-supplied keys` };
  }
  if (engine === 'mysql' || engine === 'mariadb') {
    return { engine, tables: desired.tables || [], schemas: desired.schemas || [], mode: 'provider-contract', command: 'mysql --batch --execute "SHOW TABLES"', warning: `${engine} console uses provider-owned MYSQL_URL/MARIADB_URL with mysql CLI adapter when configured` };
  }
  if (engine === 'mongodb') {
    return { engine, collections: desired.collections || [], mode: 'provider-contract', command: 'mongosh --eval "db.getCollectionNames()"', warning: 'MongoDB collection browser uses provider-owned MONGODB_URI when configured' };
  }
  if (engine === 'object-storage') {
    return { engine, buckets: desired.buckets || (desired.bucket ? [desired.bucket] : []), objects: desired.objects || [], mode: 'provider-contract', command: 'mc ls <alias>/<bucket>', warning: 'MinIO/S3 bucket browser uses provider-owned endpoint credentials when configured' };
  }
  if (engine === 'qdrant' || engine === 'vector-db') {
    return { engine: engine === 'vector-db' ? 'qdrant' : engine, collections: desired.collections || (desired.collection ? [desired.collection] : []), mode: 'provider-contract', command: 'GET /collections', warning: 'Qdrant collection/search uses provider-owned QDRANT_URL/API key when configured' };
  }
  if (engine === 'nats' || engine === 'message-queue') {
    return { engine: engine === 'message-queue' ? 'nats' : engine, streams: desired.streams || [], subjects: desired.subjects || (desired.topic ? [desired.topic] : []), mode: 'provider-contract', command: 'nats stream ls', warning: 'NATS browser uses provider-owned QUEUE_URL/NATS_URL when configured' };
  }
  return { engine, mode: 'provider-contract', warning: `${engine} provider console adapter is not configured` };
}

export function publicProviderPlan(plan: AnyRecord) {
  const { internal: _internal, secret: _secret, ...rest } = plan;
  return maskSecrets(rest);
}

function psqlCommand(databaseUrl: string, args: string[], stdin: string): CommandSpec {
  return { executable: 'psql', args: [databaseUrl, ...args], stdin, redacted: `psql ${maskSecretValue(databaseUrl)} ${args.join(' ')}` };
}

function safeSqlIdentifier(value: any) {
  const normalized = slugify(String(value || 'app')).replace(/-/g, '_').slice(0, 63) || 'app';
  const withPrefix = /^[a-z_]/.test(normalized) ? normalized : `r_${normalized}`;
  if (!SQL_IDENTIFIER_RE.test(withPrefix)) throw new Error(`unsafe PostgreSQL identifier: ${value}`);
  return withPrefix;
}

function quoteIdent(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizedEngine(value: any) {
  const engine = String(value || '').toLowerCase();
  if (engine === 'postgres' || engine === 'pg') return 'postgresql';
  if (engine === 'valkey') return 'valkey';
  if (engine === 'mongo') return 'mongodb';
  if (['minio', 's3', 'storage'].includes(engine)) return 'object-storage';
  if (engine === 'queue') return 'message-queue';
  return engine;
}

function clamp(value: any, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
