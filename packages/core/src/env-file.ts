import { isSecretKey, maskSecretValue } from './secrets.ts';

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type EnvEntry = { key: string; value: string; isSecret: boolean; valueMasked: string; source: string };

export function parseDotEnv(text: string, options: Record<string, any> = {}) {
  const source = options.source || '.env';
  const entries: EnvEntry[] = [];
  const errors: Array<Record<string, any>> = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex <= 0) {
      errors.push({ line: index + 1, code: 'INVALID_ENV_LINE', message: 'expected KEY=value' });
      continue;
    }
    const key = withoutExport.slice(0, eqIndex).trim();
    const value = unquoteEnvValue(withoutExport.slice(eqIndex + 1).trim());
    if (!ENV_KEY_RE.test(key)) {
      errors.push({ line: index + 1, key, code: 'INVALID_ENV_KEY', message: 'environment keys must match /^[A-Za-z_][A-Za-z0-9_]*$/' });
      continue;
    }
    const isSecret = isSecretKey(key);
    entries.push({ key, value, isSecret, valueMasked: isSecret ? maskSecretValue(value) : value, source });
  }
  if (errors.length && options.throwOnError !== false) {
    const error = new Error(`invalid .env content: ${errors.map((item) => `line ${item.line} ${item.code}`).join(', ')}`);
    (error as any).statusCode = 400;
    (error as any).errors = errors;
    throw error;
  }
  return { entries, errors, plainCount: entries.filter((entry) => !entry.isSecret).length, secretCount: entries.filter((entry) => entry.isSecret).length };
}

function unquoteEnvValue(value: string) {
  const trimmed = value.replace(/\s+#.*$/, '');
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"') ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t') : inner;
  }
  return trimmed;
}

export function normalizeEnvEntries(input: any, options: Record<string, any> = {}) {
  if (typeof input === 'string') return parseDotEnv(input, options).entries;
  const source = options.source || 'json';
  const rawEntries = Array.isArray(input) ? input : Object.entries(input || {}).map(([key, value]) => ({ key, value }));
  const entries = rawEntries.map((entry: any) => {
    const key = String(entry.key || '').trim();
    if (!ENV_KEY_RE.test(key)) {
      const error = new Error(`invalid environment key: ${key}`);
      (error as any).statusCode = 400;
      throw error;
    }
    const value = String(entry.value ?? '');
    const isSecret = entry.isSecret === true || isSecretKey(key);
    return { key, value, isSecret, valueMasked: isSecret ? maskSecretValue(value) : value, source: entry.source || source };
  });
  return entries;
}

export function maskEnvEntries(entries: Array<Record<string, any>>) {
  return entries.map((entry) => ({
    key: entry.key,
    isSecret: entry.isSecret === true,
    value: entry.isSecret ? undefined : entry.value,
    valueMasked: entry.isSecret ? (entry.valueMasked || maskSecretValue(entry.value)) : String(entry.value ?? ''),
    source: entry.source || 'api',
    updatedAt: entry.updatedAt || null,
  }));
}
