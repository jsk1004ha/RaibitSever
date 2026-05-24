import { sanitizeLogRecord } from './security.ts';

type AnyRecord = Record<string, any>;

export const ERROR_CODE_CATALOG = Object.freeze({
  BUILD_FAILED: {
    code: 'BUILD_FAILED',
    area: 'build',
    severity: 'error',
    retryable: true,
    userMessage: 'The image build failed. Check build logs, Dockerfile, and configured build commands.',
  },
  ROLLOUT_FAILED: {
    code: 'ROLLOUT_FAILED',
    area: 'orchestrator',
    severity: 'error',
    retryable: true,
    userMessage: 'The Kubernetes rollout failed. Check runtime logs, image pull status, probes, and resource limits.',
  },
  KUBERNETES_RECONCILE_FAILED: {
    code: 'KUBERNETES_RECONCILE_FAILED',
    area: 'orchestrator',
    severity: 'error',
    retryable: true,
    userMessage: 'The orchestrator could not reconcile the desired Kubernetes state.',
  },
  IMAGE_PULL_BACKOFF: {
    code: 'IMAGE_PULL_BACKOFF',
    area: 'orchestrator',
    severity: 'error',
    retryable: true,
    userMessage: 'Kubernetes could not pull the container image. Verify registry credentials, image name, and tag/digest.',
  },
  INSUFFICIENT_QUOTA: {
    code: 'INSUFFICIENT_QUOTA',
    area: 'quota',
    severity: 'error',
    retryable: false,
    userMessage: 'The requested operation exceeds the current organization or user quota.',
  },
  PROVIDER_CREDENTIAL_FAILED: {
    code: 'PROVIDER_CREDENTIAL_FAILED',
    area: 'provisioner',
    severity: 'error',
    retryable: true,
    userMessage: 'The resource provider could not create or store credentials for the managed resource.',
  },
  DEPLOYMENT_CANCELLED: {
    code: 'DEPLOYMENT_CANCELLED',
    area: 'deployment',
    severity: 'info',
    retryable: false,
    userMessage: 'Deployment cancellation was requested.',
  },
  WORKFLOW_HANDLER_MISSING: {
    code: 'WORKFLOW_HANDLER_MISSING',
    area: 'workflow',
    severity: 'error',
    retryable: false,
    userMessage: 'No worker handler is registered for this workflow type.',
  },
  UNKNOWN_INFRA_ERROR: {
    code: 'UNKNOWN_INFRA_ERROR',
    area: 'unknown',
    severity: 'error',
    retryable: false,
    userMessage: 'An unexpected infrastructure error occurred.',
  },
});

export function errorSpecForCode(code: any) {
  const normalized = normalizeErrorCode(code);
  return ERROR_CODE_CATALOG[normalized as keyof typeof ERROR_CODE_CATALOG] || ERROR_CODE_CATALOG.UNKNOWN_INFRA_ERROR;
}

export function normalizeInfrastructureError(error: any, fallbackCode = 'UNKNOWN_INFRA_ERROR') {
  const code = normalizeErrorCode(error?.code || error?.errorCode || fallbackCode);
  const spec = errorSpecForCode(code);
  const rawMessage = error?.message || error?.errorMessage || String(error || spec.userMessage);
  return {
    ...spec,
    code: spec.code,
    message: sanitizeLogRecord(rawMessage),
    metadata: sanitizeErrorMetadata(error?.metadata || {}),
  };
}

export function normalizeErrorCode(code: any) {
  const normalized = String(code || '').trim().toUpperCase().replace(/^ERR_/, '');
  if (!normalized) return 'UNKNOWN_INFRA_ERROR';
  if (normalized.includes('IMAGE_PULL') || normalized.includes('IMAGEPULLBACKOFF')) return 'IMAGE_PULL_BACKOFF';
  if (normalized === 'BUILD_FAILED') return 'BUILD_FAILED';
  if (normalized === 'ROLLOUT_FAILED') return 'ROLLOUT_FAILED';
  if (normalized === 'KUBERNETES_RECONCILE_FAILED') return 'KUBERNETES_RECONCILE_FAILED';
  if (normalized === 'INSUFFICIENT_QUOTA') return 'INSUFFICIENT_QUOTA';
  if (normalized === 'PROVIDER_CREDENTIAL_FAILED') return 'PROVIDER_CREDENTIAL_FAILED';
  if (normalized === 'DEPLOYMENT_CANCELLED') return 'DEPLOYMENT_CANCELLED';
  if (normalized === 'WORKFLOW_HANDLER_MISSING') return 'WORKFLOW_HANDLER_MISSING';
  return normalized;
}

function sanitizeErrorMetadata(input: AnyRecord) {
  if (!input || typeof input !== 'object') return {};
  const output: AnyRecord = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = typeof value === 'string' ? sanitizeLogRecord(value) : value;
  }
  return output;
}
