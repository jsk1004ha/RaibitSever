import crypto from 'node:crypto';
import { maskSecretValue } from './secrets.ts';

const DEV_KEY = 'raibitserver-local-dev-encryption-key-32b';

function keyMaterial(secret = process.env.ENCRYPTION_KEY || process.env.RAIBITSERVER_SECRET_ENCRYPTION_KEY || DEV_KEY) {
  const configured = process.env.ENCRYPTION_KEY || process.env.RAIBITSERVER_SECRET_ENCRYPTION_KEY;
  const usingRuntimeDefault = !secret || secret === DEV_KEY || secret === configured;
  if (usingRuntimeDefault && (!configured || String(configured).length < 32) && String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('RAIBITSERVER_SECRET_ENCRYPTION_KEY or ENCRYPTION_KEY with at least 32 characters is required in production');
  }
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function secureRandomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sealSecret(value: any, options: Record<string, any> = {}) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(options.encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value ?? ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function openSecret(sealed: string, options: Record<string, any> = {}) {
  const [alg, version, ivText, tagText, ciphertextText] = String(sealed || '').split(':');
  if (alg !== 'aes256gcm' || version !== 'v1') throw new Error('unsupported sealed secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(options.encryptionKey), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

export function publicSecretRecord(row: Record<string, any>) {
  return { id: row.id, scopeType: row.scopeType, scopeId: row.scopeId, key: row.key, valueMasked: row.valueMasked || maskSecretValue(row.value), metadata: row.metadata || {}, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
