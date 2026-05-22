import fs from 'node:fs/promises';
import path from 'node:path';
import { guardDatabaseQuery, isReadOnlyDatabaseQuery } from './security.ts';
import { isProviderOwnedSqlitePath } from './resource-sanitizer.ts';
import { providerConsoleSurface } from './resource-providers.ts';

export async function runDbConsoleQuery(resource: Record<string, any>, query: string, options: Record<string, any> = {}) {
  const engine = String(resource.engine || resource.desiredSpec?.engine || '').toLowerCase();
  if (engine !== 'sqlite' && engine !== 'postgresql' && engine !== 'postgres') {
    const surface = providerConsoleSurface(resource, options);
    return {
      engine,
      mode: surface.mode || 'connection-info',
      rows: [],
      fields: [],
      warning: surface.warning || `${engine} console requires a live provider connection; local deterministic mode verified the provider command path`,
      command: surface.command,
      guard: { allowed: true, readOnly: true, providerCommand: true },
    };
  }
  const guard = guardDatabaseQuery(query, { role: options.role || 'developer', confirmed: options.confirmed === true });
  if (!guard.allowed) {
    const error = new Error(guard.reason);
    (error as any).statusCode = 403;
    (error as any).guard = guard;
    throw error;
  }
  if (engine === 'sqlite') return runSqlite(resource, query, options);
  return runPostgres(resource, query, options, guard);
}

async function runSqlite(resource: Record<string, any>, query: string, options: Record<string, any>) {
  const sqlite = await import('node:sqlite');
  const dbPath = providerSqlitePath(resource);
  await ensureSqliteDirectory(dbPath);
  const db = new (sqlite as any).DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout=1000');
    const text = String(query || '').trim();
    assertSqliteStatementAllowed(text);
    if (/^SELECT\b/i.test(text)) {
      const limited = /\bLIMIT\b/i.test(text) ? text.replace(/;$/, '') : `${text.replace(/;$/, '')} LIMIT ${Math.min(Number(options.limit || 100), 500)}`;
      const stmt = db.prepare(limited);
      const rows = stmt.all();
      return { engine: 'sqlite', dbPath, rows, fields: rows[0] ? Object.keys(rows[0]) : [], rowCount: rows.length };
    }
    if (/^PRAGMA\b/i.test(text)) {
      const stmt = db.prepare(text.replace(/;$/, ''));
      const rows = stmt.all();
      return { engine: 'sqlite', dbPath, rows, fields: rows[0] ? Object.keys(rows[0]) : [], rowCount: rows.length };
    }
    db.exec(text);
    return { engine: 'sqlite', dbPath, rows: [], fields: [], rowCount: 0, changed: true };
  } finally {
    db.close();
  }
}

function assertSqliteStatementAllowed(query: string) {
  const policySql = normalizeSqlForPolicy(query);
  const blocked = /\b(ATTACH|DETACH)\b/.test(policySql.spaced)
    || /\bVACUUM\b.+\bINTO\b/.test(policySql.spaced)
    || policySql.compact.includes('LOAD_EXTENSION(')
    || /^PRAGMA(?:[A-Z_][A-Z0-9_]*\.)?(WRITABLE_SCHEMA|JOURNAL_MODE|TEMP_STORE_DIRECTORY|DATA_STORE_DIRECTORY|TRUSTED_SCHEMA)(?:\b|=|\(|;|$)/.test(policySql.compact);
  if (!blocked) return;
  const error = new Error('sqlite console statement is blocked by filesystem safety policy');
  (error as any).statusCode = 403;
  throw error;
}

function normalizeSqlForPolicy(query: string) {
  const text = String(query || '');
  let output = '';
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      if (char === quote && next === quote && quote !== ']') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      output += ' ';
      continue;
    }
    if (char === '-' && next === '-') {
      output += ' ';
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      output += ' ';
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1;
      if (index < text.length) index += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      output += ' ';
      continue;
    }
    if (char === '[') {
      quote = ']';
      output += ' ';
      continue;
    }
    output += char;
  }
  return {
    spaced: output.replace(/\s+/g, ' ').trim().toUpperCase(),
    compact: output.replace(/\s+/g, '').trim().toUpperCase(),
  };
}

export async function browseDbConsole(resource: Record<string, any>, options: Record<string, any> = {}) {
  const engine = String(resource.engine || '').toLowerCase();
  if (engine === 'postgresql' || engine === 'postgres') return browsePostgres(resource, options);
  if (engine !== 'sqlite') return providerConsoleSurface(resource, options);
  const sqlite = await import('node:sqlite');
  const dbPath = providerSqlitePath(resource);
  await ensureSqliteDirectory(dbPath);
  const db = new (sqlite as any).DatabaseSync(dbPath);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row: any) => row.name);
    return { engine: 'sqlite', dbPath, tables };
  } finally {
    db.close();
  }
}

export async function resourceConsoleView(resource: Record<string, any>, view: string, options: Record<string, any> = {}) {
  const surface = await browseDbConsole(resource, options) as Record<string, any>;
  const engine = surface.engine || String(resource.engine || '').toLowerCase();
  if (view === 'schema') {
    return {
      engine,
      schema: {
        schemas: surface.schemas || [],
        tables: surface.tables || [],
        collections: surface.collections || [],
        keys: surface.keys || [],
        buckets: surface.buckets || [],
        streams: surface.streams || [],
        subjects: surface.subjects || [],
      },
      warning: surface.warning,
      mode: surface.mode,
    };
  }
  if (view === 'tables') return { engine, schemas: surface.schemas || [], tables: surface.tables || [], warning: surface.warning, mode: surface.mode };
  if (view === 'collections') return { engine, collections: surface.collections || [], warning: surface.warning, mode: surface.mode };
  if (view === 'keys') return { engine, keys: surface.keys || [], warning: surface.warning, mode: surface.mode, command: surface.command };
  return surface;
}

async function ensureSqliteDirectory(dbPath: string) {
  if (!dbPath || dbPath === ':memory:') return;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
}

function providerSqlitePath(resource: Record<string, any>) {
  const candidate = resource.sqlitePath || resource.desiredSpec?.sqlitePath || ':memory:';
  if (!isProviderOwnedSqlitePath(candidate)) {
    const error = new Error('sqlite console path must be provider-owned');
    (error as any).statusCode = 403;
    throw error;
  }
  return candidate;
}

async function runPostgres(resource: Record<string, any>, query: string, options: Record<string, any>, guard: Record<string, any>) {
  const connectionUrl = resourceConnectionUrl(resource, options, ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL']);
  if (!connectionUrl) return liveConnectionRequired('postgresql', guard);
  const client = await prismaClientFor(connectionUrl);
  try {
    const timeoutMs = clampNumber(options.timeoutMs, 250, 30_000, 5_000);
    const text = String(query || '').trim().replace(/;+\s*$/, '');
    if (guard.readOnly === true && isReadOnlyDatabaseQuery(text)) {
      const limited = limitSqlQuery(text, options.limit);
      const rows = await queryPostgresReadOnly(client, limited, timeoutMs);
      return rowsResult('postgresql', trimResultRows(rows, options.maxResultBytes), guard);
    }
    await client.$executeRawUnsafe(`SET statement_timeout = ${Math.floor(timeoutMs)}`);
    const rowCount = await withTimeout(client.$executeRawUnsafe(text), timeoutMs);
    return { engine: 'postgresql', rows: [], fields: [], rowCount: Number(rowCount || 0), changed: true, guard };
  } finally {
    await client.$disconnect();
  }
}

async function browsePostgres(resource: Record<string, any>, options: Record<string, any> = {}) {
  const connectionUrl = resourceConnectionUrl(resource, options, ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL']);
  if (!connectionUrl) return { engine: 'postgresql', tables: [], schemas: [], warning: 'PostgreSQL browser requires provider-owned DATABASE_URL/POSTGRES_URL on the resource' };
  const client = await prismaClientFor(connectionUrl);
  try {
    const timeoutMs = clampNumber(options.timeoutMs, 250, 30_000, 5_000);
    const tables = await queryPostgresReadOnly(client, `
      SELECT table_schema AS schema, table_name AS name, table_type AS type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
      LIMIT ${clampNumber(options.limit, 1, 500, 100)}
    `, timeoutMs);
    const schemas = [...new Set((tables as Record<string, any>[]).map((table) => table.schema))];
    return { engine: 'postgresql', schemas, tables };
  } finally {
    await client.$disconnect();
  }
}

async function queryPostgresReadOnly(client: any, sql: string, timeoutMs: number) {
  return withTimeout(client.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`);
    return tx.$queryRawUnsafe(sql);
  }, { timeout: timeoutMs + 1000 }), timeoutMs + 1500);
}

async function prismaClientFor(connectionUrl: string) {
  const mod = await import('@prisma/client');
  const PrismaClient = (mod as any).PrismaClient;
  if (!PrismaClient) throw new Error('@prisma/client PrismaClient export is required for live PostgreSQL console queries');
  return new PrismaClient({ datasourceUrl: connectionUrl, log: [] });
}

function resourceConnectionUrl(resource: Record<string, any>, options: Record<string, any>, envKeys: string[]) {
  const providerConnection = resource.providerConnection || {};
  const candidates = [
    providerConnection.connectionUrl,
    providerConnection.databaseUrl,
    providerConnection.url,
    providerConnection.uri,
    providerConnection.connectionString,
    ...envKeys.map((key) => providerConnection[key]),
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}

function liveConnectionRequired(engine: string, guard: Record<string, any>) {
  return {
    engine,
    mode: 'connection-info',
    rows: [],
    fields: [],
    warning: `${engine} console requires a live provider-owned connection URL on the resource`,
    guard,
  };
}

function limitSqlQuery(query: string, limit: any) {
  if (/\bLIMIT\s+\d+\b/i.test(query)) return query;
  if (!/^SELECT\b/i.test(query)) return query;
  return `${query} LIMIT ${clampNumber(limit, 1, 500, 100)}`;
}

function rowsResult(engine: string, rows: any, guard: Record<string, any>) {
  const list = Array.isArray(rows) ? rows : [];
  return { engine, rows: list, fields: list[0] ? Object.keys(list[0]) : [], rowCount: list.length, guard };
}

function trimResultRows(rows: any, maxBytes: any) {
  if (!Array.isArray(rows)) return rows;
  const byteLimit = clampNumber(maxBytes, 1024, 2_000_000, 512_000);
  const kept = [];
  let used = 2;
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row));
    if (used + bytes > byteLimit) break;
    kept.push(row);
    used += bytes + 1;
  }
  return kept;
}

function clampNumber(value: any, min: number, max: number, defaultValue: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return defaultValue;
  return Math.min(max, Math.max(min, number));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`database console query timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
