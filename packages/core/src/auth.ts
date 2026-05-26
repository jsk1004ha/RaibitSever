import crypto from 'node:crypto';
import { can } from './rbac.ts';

function base64url(input: any) {
  return Buffer.from(input).toString('base64url');
}

function parseJsonSegment(segment: string) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw unauthorized('invalid bearer token payload');
  }
}

export function signJwtHs256(payload: Record<string, any>, secret: string, { expiresInSeconds = 3600, issuer = 'raibitserver', audience = 'raibitserver-api' } = {}) {
  if (!secret) throw new Error('jwt secret is required');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const ttl = Math.max(60, Math.min(Number(expiresInSeconds || 3600), 24 * 60 * 60));
  const { exp: _exp, iat: _iat, nbf: _nbf, iss: _iss, aud: _aud, jti: _jti, ...safePayload } = payload || {};
  const body = { ...safePayload, iss: issuer, aud: audience, jti: crypto.randomUUID(), iat: now, exp: now + ttl };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest('base64url');
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

export function verifyJwtHs256(token: string, secret: string, { issuer = 'raibitserver', audience = 'raibitserver-api' } = {}) {
  if (!secret) throw unauthorized('jwt auth is not configured');
  const [headerSegment, payloadSegment, signature] = String(token || '').split('.');
  if (!headerSegment || !payloadSegment || !signature) throw unauthorized('invalid bearer token');
  const header = parseJsonSegment(headerSegment);
  if (header.alg !== 'HS256') throw unauthorized('unsupported jwt algorithm');
  const expected = crypto.createHmac('sha256', secret).update(`${headerSegment}.${payloadSegment}`).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const signatureOk = signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!signatureOk) throw unauthorized('invalid bearer token signature');
  const payload = parseJsonSegment(payloadSegment);
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp) throw unauthorized('missing bearer token expiration');
  if (now >= Number(payload.exp)) throw unauthorized('expired bearer token');
  if (payload.nbf && now < Number(payload.nbf)) throw unauthorized('bearer token is not active yet');
  if (issuer && (!payload.iss || payload.iss !== issuer)) throw unauthorized('invalid token issuer');
  if (audience && (!payload.aud || payload.aud !== audience)) throw unauthorized('invalid token audience');
  if (!payload.jti) throw unauthorized('missing token id');
  return payload;
}

export function subjectFromRequest(req: any, auth: Record<string, any> = {}) {
  const mode = auth.mode || (auth.jwtSecret ? 'jwt' : 'jwt');
  if (mode === 'disabled') {
    if (auth.allowDisabled !== true) throw unauthorized('disabled auth mode requires explicit allowDisabled=true');
    return { id: 'system', role: auth.defaultRole || 'owner', authMode: 'disabled', global: true };
  }
  const headers = req.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  const token = String(authorization).startsWith('Bearer ') ? String(authorization).slice('Bearer '.length) : null;
  if (!token && auth.allowDevHeaders) {
    return {
      id: headers['x-raibitserver-user'] || 'dev-user',
      role: headers['x-raibitserver-role'] || 'developer',
      organizationId: headers['x-raibitserver-organization'] || null,
      projectId: headers['x-raibitserver-project'] || null,
      authMode: 'dev-header',
    };
  }
  if (!token) throw unauthorized('missing bearer token');
  const payload = verifyJwtHs256(token, auth.jwtSecret, { issuer: auth.issuer || 'raibitserver', audience: auth.audience || 'raibitserver-api' });
  return {
    id: payload.sub || payload.userId || payload.email || 'user',
    role: payload.role || payload.orgRole || 'viewer',
    organizationId: payload.organizationId || payload.orgId || null,
    organizationIds: payload.organizationIds || null,
    projectId: payload.projectId || null,
    projectIds: payload.projectIds || null,
    global: payload.global === true,
    authMode: 'jwt',
    accountType: payload.accountType || null,
    approvalStatus: payload.approvalStatus || null,
    userRole: payload.userRole || null,
    claims: payload,
  };
}

export function requireAction(subject: Record<string, any>, action: string) {
  if (!can(subject.role, action)) {
    const error = new Error(`role ${subject.role} cannot perform ${action}`);
    (error as any).statusCode = 403;
    throw error;
  }
  return true;
}

export function requireScope(subject: Record<string, any>, scope: Record<string, any> = {}) {
  if (subject.global === true || subject.claims?.global === true || subject.authMode === 'disabled') return true;
  const organizationId = scope.organizationId || scope.orgId || null;
  const projectId = scope.projectId || null;
  if (organizationId && !matchesScope(subject.organizationId, subject.organizationIds, organizationId)) {
    throw forbidden(`subject is not scoped to organization ${organizationId}`);
  }
  if (projectId && !matchesScope(subject.projectId, subject.projectIds, projectId)) {
    throw forbidden(`subject is not scoped to project ${projectId}`);
  }
  return true;
}

export function authorizeRequest(req: any, action: string, auth: Record<string, any> = {}, scope: Record<string, any> = {}) {
  const subject = subjectFromRequest(req, auth);
  requireAction(subject, action);
  requireScope(subject, { ...(req.params || {}), ...scope });
  return subject;
}

function matchesScope(single: any, many: any, expected: any) {
  const value = String(expected);
  if (single && String(single) === value) return true;
  if (Array.isArray(many) && many.map(String).includes(value)) return true;
  return false;
}

function unauthorized(message: string) {
  const error = new Error(message);
  (error as any).statusCode = 401;
  return error;
}

function forbidden(message: string) {
  const error = new Error(message);
  (error as any).statusCode = 403;
  return error;
}
