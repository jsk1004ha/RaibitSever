import crypto from 'node:crypto';
import { signJwtHs256 } from './auth.ts';
import { slugify } from './ids.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string) {
  const value = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(value)) {
    const error = new Error('valid email is required');
    (error as any).statusCode = 400;
    throw error;
  }
  return value;
}

export function assertPasswordStrength(password: string) {
  if (String(password || '').length < 8) {
    const error = new Error('password must be at least 8 characters');
    (error as any).statusCode = 400;
    throw error;
  }
  return true;
}

export function hashPassword(password: string, options: Record<string, any> = {}) {
  assertPasswordStrength(password);
  const salt = options.salt || crypto.randomBytes(16).toString('base64url');
  const cost = Number(options.cost || 16384);
  const hash = crypto.scryptSync(String(password), salt, 32, { N: cost }).toString('base64url');
  return `scrypt:v1:${cost}:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [scheme, version, costText, salt, expected] = String(encoded || '').split(':');
  if (scheme !== 'scrypt' || version !== 'v1' || !salt || !expected) return false;
  const cost = Number(costText || 16384);
  const actual = crypto.scryptSync(String(password || ''), salt, 32, { N: cost }).toString('base64url');
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function sessionPayloadForUser(user: Record<string, any>, memberships: Array<Record<string, any>> = []) {
  const organizationIds = memberships.map((membership) => membership.organizationId).filter(Boolean);
  return {
    sub: user.id,
    email: user.email,
    role: memberships[0]?.role || 'developer',
    organizationId: organizationIds[0] || null,
    organizationIds,
  };
}

export function createSessionToken(user: Record<string, any>, memberships: Array<Record<string, any>>, jwtSecret: string, options: Record<string, any> = {}) {
  return signJwtHs256(sessionPayloadForUser(user, memberships), jwtSecret, { expiresInSeconds: Number(options.expiresInSeconds || 3600), issuer: options.issuer || 'raibitserver' });
}

export function personalOrganizationSlug(email: string) {
  return slugify(String(email).split('@')[0] || 'user');
}
