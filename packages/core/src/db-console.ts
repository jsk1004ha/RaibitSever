import fs from 'node:fs/promises';
import path from 'node:path';
import { guardDatabaseQuery } from './security.ts';

export async function runDbConsoleQuery(resource: Record<string, any>, query: string, options: Record<string, any> = {}) {
  const guard = guardDatabaseQuery(query, { role: options.role || 'developer', confirmed: options.confirmed === true });
  if (!guard.allowed) {
    const error = new Error(guard.reason);
    (error as any).statusCode = 403;
    (error as any).guard = guard;
    throw error;
  }
  const engine = String(resource.engine || resource.desiredSpec?.engine || '').toLowerCase();
  if (engine === 'sqlite') return runSqlite(resource, query, options);
  return {
    engine,
    mode: 'connection-info',
    rows: [],
    fields: [],
    warning: `${engine} console requires a live provider connection; local deterministic mode verified the query guard and audit path`,
    guard,
  };
}

async function runSqlite(resource: Record<string, any>, query: string, options: Record<string, any>) {
  const sqlite = await import('node:sqlite');
  const dbPath = resource.sqlitePath || resource.desiredSpec?.sqlitePath || options.sqlitePath || ':memory:';
  await ensureSqliteDirectory(dbPath);
  const db = new (sqlite as any).DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout=1000');
    const text = String(query || '').trim();
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

export async function browseDbConsole(resource: Record<string, any>, options: Record<string, any> = {}) {
  const engine = String(resource.engine || '').toLowerCase();
  if (engine !== 'sqlite') return { engine, tables: [], collections: [], keys: [], warning: 'live provider browser is available when the provider connection is configured' };
  const sqlite = await import('node:sqlite');
  const dbPath = resource.sqlitePath || resource.desiredSpec?.sqlitePath || options.sqlitePath || ':memory:';
  await ensureSqliteDirectory(dbPath);
  const db = new (sqlite as any).DatabaseSync(dbPath);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row: any) => row.name);
    return { engine: 'sqlite', dbPath, tables };
  } finally {
    db.close();
  }
}

async function ensureSqliteDirectory(dbPath: string) {
  if (!dbPath || dbPath === ':memory:') return;
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
}
