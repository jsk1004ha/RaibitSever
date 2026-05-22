import { isSecretKey, maskSecretValue } from './secrets.ts';

type AnyRecord = Record<string, any>;

export const DEFAULT_CONTAINER_SECURITY_CONTEXT = Object.freeze({
  runAsNonRoot: true,
  runAsUser: 10001,
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  capabilities: { drop: ['ALL'] },
  seccompProfile: { type: 'RuntimeDefault' },
});

export const DEFAULT_POD_SECURITY_CONTEXT = Object.freeze({
  fsGroup: 10001,
  seccompProfile: { type: 'RuntimeDefault' },
});

export function validateServiceSecurity(service: AnyRecord = {}) {
  const findings = [];
  if (service.privileged === true || service.securityContext?.privileged === true) {
    findings.push({ level: 'block', code: 'NO_PRIVILEGED', message: 'privileged containers are not allowed' });
  }
  if (service.hostNetwork === true) {
    findings.push({ level: 'block', code: 'NO_HOST_NETWORK', message: 'hostNetwork is not allowed for tenant workloads' });
  }
  for (const volume of service.volumes || []) {
    if (volume.hostPath) {
      findings.push({ level: 'block', code: 'NO_HOST_PATH', message: `hostPath mount is not allowed: ${volume.name || volume.hostPath}` });
    }
  }
  const limits = service.resources?.limits;
  if (!limits?.cpu || !limits?.memory) {
    findings.push({ level: 'warn', code: 'RESOURCE_LIMITS_REQUIRED', message: 'CPU and memory limits should be configured' });
  }
  if (service.runAsRoot === true || service.securityContext?.runAsUser === 0) {
    findings.push({ level: 'block', code: 'NO_ROOT', message: 'runtime containers must not run as root' });
  }
  return {
    ok: !findings.some((finding) => finding.level === 'block'),
    findings,
  };
}

export function secureContainerDefaults(service: AnyRecord = {}) {
  return {
    ...DEFAULT_CONTAINER_SECURITY_CONTEXT,
    ...(service.securityContext || {}),
    privileged: false,
    allowPrivilegeEscalation: false,
  };
}

export function guardDatabaseQuery(query: any, { confirmed = false, role = 'developer' }: AnyRecord = {}) {
  const text = String(query || '').trim();
  const normalized = text.replace(/\s+/g, ' ').toUpperCase();
  const destructive = /\b(DROP|TRUNCATE|ALTER|REINDEX|VACUUM\s+FULL)\b/.test(normalized)
    || (/\bDELETE\s+FROM\b/.test(normalized) && !/\bWHERE\b/.test(normalized))
    || (/\bUPDATE\b/.test(normalized) && !/\bWHERE\b/.test(normalized));
  const readOnlyRole = ['viewer'].includes(role);
  if (readOnlyRole && !/^SELECT\b|^SHOW\b|^DESCRIBE\b|^EXPLAIN\b/i.test(text)) {
    return { allowed: false, reason: 'viewer role can only run read-only queries', destructive };
  }
  if (destructive && !confirmed) {
    return { allowed: false, reason: 'destructive query requires explicit confirmation', destructive };
  }
  return { allowed: true, reason: 'query accepted', destructive };
}

export function sanitizeLogRecord(record: any): any {
  if (typeof record === 'string') return sanitizeLogString(record);
  if (Array.isArray(record)) return record.map((item) => sanitizeLogRecord(item));
  if (!record || typeof record !== 'object') return record;
  const output: AnyRecord = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = isSecretKey(key) && value !== null && value !== undefined && typeof value !== 'object'
      ? maskSecretValue(value)
      : sanitizeLogRecord(value);
  }
  return output;
}

function sanitizeLogString(value: string) {
  return value
    .replace(/([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|MONGODB_URI|REDIS_URL)[A-Z0-9_]*=)([^\s]+)/gi, '$1****')
    .replace(/(["']?[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|MONGODB_URI|REDIS_URL)[A-Z0-9_]*["']?\s*[:=]\s*["'])([^"'\s,}]+)/gi, '$1****')
    .replace(/\b(Bearer|Token)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 ****')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, '$1****$3')
    .replace(/(mysql:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, '$1****$3')
    .replace(/(redis:\/\/:[^@\s]+@)/gi, 'redis://:****@');
}

export function splitEnvForSecret(environment: AnyRecord = {}) {
  const plain: AnyRecord = {};
  const secret: AnyRecord = {};
  for (const [key, value] of Object.entries(environment)) {
    if (isSecretKey(key)) secret[key] = String(value);
    else plain[key] = String(value);
  }
  return { plain, secret };
}
