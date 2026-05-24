import { isSecretKey, maskSecretValue } from './secrets.ts';
import { can } from './rbac.ts';

type AnyRecord = Record<string, any>;

const SAFE_SERVICE_KEYS = new Set([
  'projectId',
  'name',
  'slug',
  'type',
  'runtimeType',
  'sourceType',
  'buildMode',
  'repoUrl',
  'repositoryUrl',
  'githubRepositoryId',
  'githubRepository',
  'githubIntegrationId',
  'branch',
  'rootDirectory',
  'buildContext',
  'localPath',
  'dockerfilePath',
  'installCommand',
  'buildCommand',
  'startCommand',
  'outputDirectory',
  'image',
  'imageUrl',
  'port',
  'resources',
  'scaling',
  'healthCheck',
  'schedule',
  'concurrencyPolicy',
  'backoffLimit',
  'availability',
  'sleepPolicy',
  'environment',
  'env',
  'attachedResources',
  'desiredSpec',
]);

const SAFE_RESOURCE_API_KEYS = new Set([
  'projectId',
  'name',
  'slug',
  'type',
  'engine',
  'provider',
  'plan',
  'region',
  'version',
  'storageMb',
  'storageGb',
  'databaseName',
  'database',
  'username',
  'bucket',
  'collection',
  'topic',
  'backup',
  'desiredSpec',
]);

const SAFE_DEPLOYMENT_CREATE_KEYS = new Set([
  'serviceId',
  'projectId',
  'commitHash',
  'commitSha',
  'imageUrl',
  'image',
  'imageDigest',
  'deploymentType',
  'type',
  'branch',
  'previewUrl',
  'triggerType',
  'pullRequestNumber',
]);

const SAFE_DEPLOYMENT_STATUS_KEYS = new Set([
  'status',
  'imageUrl',
  'image',
  'imageDigest',
  'buildStartedAt',
  'buildFinishedAt',
  'deployedAt',
  'finishedAt',
  'errorCode',
  'errorMessage',
  'previewUrl',
  'eventType',
  'message',
  'metadata',
]);

const DEFAULT_ALLOWED_GIT_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];

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

export function unsafeDisabledAuthAllowed(env: AnyRecord = process.env) {
  if (env.RAIBITSERVER_AUTH_DISABLED !== '1') return false;
  if (env.NODE_ENV === 'production') return false;
  return env.RAIBITSERVER_AUTH_DISABLED_CONFIRM === 'I_UNDERSTAND_THIS_GRANTS_GLOBAL_OWNER';
}

export function safeAuthModeFromEnv(env: AnyRecord = process.env) {
  return unsafeDisabledAuthAllowed(env) ? 'disabled' : 'jwt';
}

export function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'cache-control': 'no-store',
  };
}

export function createFixedWindowRateLimiter({ limit = 10, windowMs = 60_000 } = {}) {
  const entries = new Map<string, { count: number; resetAt: number }>();
  return {
    check(key: string) {
      const now = Date.now();
      const normalized = String(key || 'global');
      const current = entries.get(normalized);
      if (!current || current.resetAt <= now) {
        const row = { count: 1, resetAt: now + windowMs };
        entries.set(normalized, row);
        return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: row.resetAt };
      }
      current.count += 1;
      return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
    },
    reset(key: string) {
      entries.delete(String(key || 'global'));
    },
  };
}

export function assertRateLimit(limiter: ReturnType<typeof createFixedWindowRateLimiter>, key: string) {
  const result = limiter.check(key);
  if (!result.allowed) {
    const error = new Error('rate_limit_exceeded');
    (error as any).statusCode = 429;
    (error as any).retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw error;
  }
  return result;
}

export function sanitizeTenantServiceInput(input: AnyRecord = {}, options: AnyRecord = {}) {
  const output = pickKnown(input, SAFE_SERVICE_KEYS);
  if (output.name !== undefined) output.name = String(output.name || '').trim();
  if (output.sourceType !== undefined) output.sourceType = String(output.sourceType || 'github').toLowerCase();
  if (output.port !== undefined && output.port !== null && output.port !== '') output.port = Number(output.port);
  if (output.repoUrl || output.repositoryUrl) output.repoUrl = normalizeTenantGitUrl(output.repoUrl || output.repositoryUrl, options);
  if (output.repositoryUrl) delete output.repositoryUrl;
  const sourceType = String(output.sourceType || 'github').toLowerCase();
  if (sourceType === 'local' || output.localPath || isLocalOrFileSource(output.repoUrl || output.buildContext || '')) {
    if (!tenantLocalSourceAllowed(options.env || process.env)) {
      const error = new Error('local service sources are disabled for tenant API requests');
      (error as any).statusCode = 400;
      throw error;
    }
  }
  if (output.desiredSpec && typeof output.desiredSpec === 'object') {
    output.desiredSpec = pickKnown(output.desiredSpec, SAFE_SERVICE_KEYS);
    delete output.desiredSpec.status;
    delete output.desiredSpec.desiredState;
  }
  delete output.status;
  delete output.desiredState;
  delete output.id;
  return output;
}

export function sanitizeTenantServiceUpdate(input: AnyRecord = {}, options: AnyRecord = {}) {
  const output = sanitizeTenantServiceInput(input, options);
  delete output.projectId;
  return output;
}

export function sanitizeTenantResourceApiInput(input: AnyRecord = {}) {
  const output = pickKnown(input, SAFE_RESOURCE_API_KEYS);
  delete output.status;
  delete output.desiredState;
  delete output.connectionSecretName;
  return output;
}

export function sanitizeTenantResourceApiUpdate(input: AnyRecord = {}) {
  const output = sanitizeTenantResourceApiInput(input);
  delete output.projectId;
  return output;
}

export function sanitizeTenantDeploymentCreate(input: AnyRecord = {}) {
  const output = pickKnown(input, SAFE_DEPLOYMENT_CREATE_KEYS);
  if (output.deploymentType === undefined && output.type !== undefined) output.deploymentType = output.type;
  delete output.type;
  delete output.id;
  delete output.status;
  delete output.workflowJob;
  return output;
}

export function sanitizeDeploymentStatusInput(input: AnyRecord = {}) {
  const output = pickKnown(input, SAFE_DEPLOYMENT_STATUS_KEYS);
  delete output.workflowJob;
  return output;
}

export function assertSystemDeploymentActor(subject: AnyRecord = {}) {
  if (subject.authMode === 'disabled' || subject.claims?.system === true || subject.role === 'system') return true;
  const error = new Error('deployment status updates require a builder/system actor');
  (error as any).statusCode = 403;
  throw error;
}

export function redactDbConsoleStatement(statement: any) {
  const withoutLiteralValues = String(statement || '')
    .replace(/'([^']|'')*'/g, "'?'")
    .replace(/"([^"]|"")*"/g, '"?"');
  const text = sanitizeLogString(withoutLiteralValues.replace(/\s+/g, ' ').trim()).slice(0, 160);
  return text ? `${text}${String(statement || '').length > 160 ? '…' : ''}` : '';
}

export function tenantLocalSourceAllowed(env: AnyRecord = process.env) {
  return env.RAIBITSERVER_ALLOW_LOCAL_SOURCE === '1' || env.NODE_ENV !== 'production';
}

export function normalizeTenantGitUrl(repoUrl: any, options: AnyRecord = {}) {
  const value = String(repoUrl || '').trim();
  if (!value) return value;
  if (/^https:\/\/[^/@\s]+@/i.test(value)) badRequest('credentialed git URLs are not allowed; pass tokens through integration secrets');
  if (isLocalOrFileSource(value)) {
    if (tenantLocalSourceAllowed(options.env || process.env)) return value;
    badRequest('local/file git URLs are not allowed for tenant API requests');
  }
  const allowedHosts = new Set([
    ...DEFAULT_ALLOWED_GIT_HOSTS,
    ...String((options.env || process.env).RAIBITSERVER_ALLOWED_GIT_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean),
  ]);
  const ssh = value.match(/^git@([^:]+):[^/\s]+\/[^/\s]+(?:\.git)?$/i);
  if (ssh) {
    const host = ssh[1].toLowerCase();
    if (!allowedHosts.has(host)) badRequest(`git host is not allowed: ${host}`);
    return value;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    badRequest(`unsupported git URL: ${value}`);
  }
  if (parsed.protocol !== 'https:') badRequest('git URLs must use https');
  const host = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(host)) badRequest(`git host is not allowed: ${host}`);
  if (!/\/[^/]+\/[^/]+/.test(parsed.pathname)) badRequest(`unsupported git URL: ${value}`);
  return value;
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

function pickKnown(input: AnyRecord = {}, allowed: Set<string>) {
  const output: AnyRecord = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!allowed.has(key)) continue;
    output[key] = sanitizeLogRecord(value);
  }
  return output;
}

function isLocalOrFileSource(value: any) {
  const text = String(value || '').trim();
  return text.startsWith('/') || text.startsWith('./') || text.startsWith('../') || /^file:\/\//i.test(text);
}

function badRequest(message: string): never {
  const error = new Error(message);
  (error as any).statusCode = 400;
  throw error;
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
