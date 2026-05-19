import crypto from 'node:crypto';
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
    output[key] = isSecretKey(key) && value !== null && value !== undefined && typeof value !== 'object'
      ? maskSecretValue(value)
      : maskSecrets(value);
  }
  return output;
}

const LOCAL_DEV_SECRET_KEY = 'raibitserver-local-development-secret-key-for-local-e2e-only';
const SEALED_PREFIX = 'raibit:v1:aes-256-gcm';

export function sealSecretValue(value, env = process.env) {
  const text = String(value ?? '');
  const iv = crypto.randomBytes(12);
  const key = secretCipherKey(env);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sealedValue: [SEALED_PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':'),
    valueMasked: maskSecretValue(text),
    encrypted: true,
    keySource: env.ENCRYPTION_KEY || env.RAIBITSERVER_SECRET_ENCRYPTION_KEY ? 'runtime' : 'local-dev',
  };
}

export function unsealSecretValue(sealedValue, env = process.env) {
  const text = String(sealedValue || '');
  const [prefix, version, algorithm, ivText, tagText, encryptedText] = text.split(':');
  if (`${prefix}:${version}:${algorithm}` !== SEALED_PREFIX || !ivText || !tagText || !encryptedText) {
    throw new Error('unsupported sealed secret format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretCipherKey(env), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

function secretCipherKey(env) {
  const configured = env?.ENCRYPTION_KEY || env?.RAIBITSERVER_SECRET_ENCRYPTION_KEY;
  const material = configured && String(configured).length >= 32 ? String(configured) : LOCAL_DEV_SECRET_KEY;
  return crypto.createHash('sha256').update(material).digest();
}
