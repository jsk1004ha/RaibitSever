import { isSecretKey, maskSecretValue } from './secrets.ts';
import { can } from './rbac.ts';

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
  const context = service.securityContext || {};
  if (service.privileged === true || service.securityContext?.privileged === true) {
    findings.push({ level: 'block', code: 'NO_PRIVILEGED', message: 'privileged containers are not allowed' });
  }
  if (service.hostNetwork === true) {
    findings.push({ level: 'block', code: 'NO_HOST_NETWORK', message: 'hostNetwork is not allowed for tenant workloads' });
  }
  if (service.hostPID === true) {
    findings.push({ level: 'block', code: 'NO_HOST_PID', message: 'hostPID is not allowed for tenant workloads' });
  }
  if (service.hostIPC === true) {
    findings.push({ level: 'block', code: 'NO_HOST_IPC', message: 'hostIPC is not allowed for tenant workloads' });
  }
  if (service.automountServiceAccountToken === true) {
    findings.push({ level: 'block', code: 'NO_SERVICE_ACCOUNT_TOKEN', message: 'tenant workloads cannot automount Kubernetes service account tokens' });
  }
  for (const volume of service.volumes || []) {
    if (volume.hostPath) {
      findings.push({ level: 'block', code: 'NO_HOST_PATH', message: `hostPath mount is not allowed: ${volume.name || volume.hostPath}` });
    }
  }
  for (const mount of service.volumeMounts || []) {
    if (mount.readOnly !== true && mount.mountPath !== '/tmp') {
      findings.push({ level: 'block', code: 'WRITABLE_PATH_NOT_ALLOWED', message: `writable mount path is not allowed: ${mount.mountPath || mount.name}` });
    }
  }
  const limits = service.resources?.limits;
  if (!limits?.cpu || !limits?.memory) {
    findings.push({ level: 'warn', code: 'RESOURCE_LIMITS_REQUIRED', message: 'CPU and memory limits should be configured' });
  }
  if (service.runAsRoot === true || context.runAsUser === 0 || context.runAsNonRoot === false) {
    findings.push({ level: 'block', code: 'NO_ROOT', message: 'runtime containers must not run as root' });
  }
  if (context.allowPrivilegeEscalation === true) {
    findings.push({ level: 'block', code: 'NO_PRIVILEGE_ESCALATION', message: 'allowPrivilegeEscalation must be false' });
  }
  if (context.readOnlyRootFilesystem === false) {
    findings.push({ level: 'block', code: 'READ_ONLY_ROOT_REQUIRED', message: 'readOnlyRootFilesystem must remain true' });
  }
  if (Array.isArray(context.capabilities?.add) && context.capabilities.add.length > 0) {
    findings.push({ level: 'block', code: 'NO_CAPABILITY_ADD', message: 'Linux capabilities.add is not allowed' });
  }
  if (context.seccompProfile && context.seccompProfile.type !== 'RuntimeDefault') {
    findings.push({ level: 'block', code: 'RUNTIME_DEFAULT_SECCOMP_REQUIRED', message: 'seccompProfile.type must be RuntimeDefault' });
  }
  return {
    ok: !findings.some((finding) => finding.level === 'block'),
    findings,
  };
}

export function secureContainerDefaults(service: AnyRecord = {}) {
  const requestedRunAsUser = Number(service.runAsUser ?? service.securityContext?.runAsUser);
  const runAsUser = Number.isInteger(requestedRunAsUser) && requestedRunAsUser > 0
    ? requestedRunAsUser
    : DEFAULT_CONTAINER_SECURITY_CONTEXT.runAsUser;
  return {
    runAsNonRoot: true,
    runAsUser,
    privileged: false,
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: { drop: ['ALL'] },
    seccompProfile: { type: 'RuntimeDefault' },
  };
}

export function guardDatabaseQuery(query: any, { confirmed = false, role = 'developer' }: AnyRecord = {}) {
  const text = String(query || '').trim();
  const readOnly = isReadOnlyDatabaseQuery(text);
  const destructive = !readOnly;
  const readOnlyRole = ['viewer'].includes(role);
  if (!text) {
    return { allowed: false, reason: 'query is required', destructive: false, readOnly: false };
  }
  if (readOnlyRole && !readOnly) {
    return { allowed: false, reason: 'viewer role can only run read-only queries', destructive };
  }
  if (destructive && !canMutateDatabase(role)) {
    return { allowed: false, reason: `role ${role} requires db:query permission for destructive queries`, destructive };
  }
  if (destructive && !confirmed) {
    return { allowed: false, reason: 'destructive query requires explicit confirmation', destructive };
  }
  return { allowed: true, reason: 'query accepted', destructive, readOnly };
}

function canMutateDatabase(role: string) {
  return can(role, 'db:query');
}

export function isReadOnlyDatabaseQuery(query: any) {
  const text = stripLeadingSqlComments(String(query || '').trim()).replace(/;+\s*$/, '').trim();
  if (!text || text.includes(';')) return false;
  const normalized = text.replace(/\s+/g, ' ').toUpperCase();
  if (/^SELECT\b/.test(normalized)) {
    return !/\b(FOR\s+UPDATE|INTO\s+(?:OUTFILE|DUMPFILE)?|COPY|DO)\b/.test(normalized);
  }
  if (/^SHOW\b/.test(normalized) || /^DESCRIBE\b/.test(normalized)) return true;
  if (/^EXPLAIN\s+SELECT\b/.test(normalized)) return true;
  if (/^PRAGMA\b/.test(normalized)) return !/[=;]/.test(normalized);
  return false;
}

function stripLeadingSqlComments(value: string) {
  let text = value;
  let changed = true;
  while (changed) {
    changed = false;
    const next = text.replace(/^\s*--[^\n]*(?:\n|$)/, '').replace(/^\s*\/\*[\s\S]*?\*\//, '');
    if (next !== text) {
      text = next.trimStart();
      changed = true;
    }
  }
  return text;
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
