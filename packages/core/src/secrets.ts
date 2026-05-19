const SECRET_KEY_RE = /(secret|password|token|private|credential|api[_-]?key|access[_-]?key|database_url|mongodb_uri|redis_url|mysql_url|postgres_url|dsn)/i;

export function isSecretKey(key) {
  const value = String(key || '');
  if (/(^|[_-])(secret|password|token|credential)s?[_-]?count$/i.test(value) || /secretCount|plainCount/i.test(value)) return false;
  return SECRET_KEY_RE.test(value);
}

export function maskSecretValue(value) {
  if (value === null || value === undefined) return value;
  const text = String(value);
  if (text.length <= 4) return '****';
  return `${text.slice(0, 2)}****${text.slice(-2)}`;
}

export function maskSecrets(input) {
  if (Array.isArray(input)) return input.map(maskSecrets);
  if (!input || typeof input !== 'object') return input;
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = isSecretKey(key) && typeof value === 'string' ? maskSecretValue(value) : maskSecrets(value);
  }
  return output;
}
