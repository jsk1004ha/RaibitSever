export const SERVICE_TYPES = Object.freeze({
  WEB: 'web',
  PRIVATE: 'private',
  WORKER: 'worker',
  CRON: 'cron',
  JOB: 'job',
});

export const SOURCE_TYPES = Object.freeze({
  GITHUB: 'github',
  ZIP: 'zip',
  IMAGE: 'image',
  LOCAL: 'local',
});

export const BUILD_MODES = Object.freeze({
  AUTO: 'auto',
  DOCKERFILE: 'dockerfile',
  BUILDPACK: 'buildpack',
  CUSTOM: 'custom',
  PREBUILT_IMAGE: 'prebuilt-image',
});

export const DEFAULT_PORT = 8080;
export const DEFAULT_REGISTRY = 'registry.raibitserver.local';
export const DEFAULT_DOMAIN = 'raibitserver.app';

export const WORKLOAD_PIPELINE = Object.freeze([
  'source',
  'build',
  'image',
  'registry',
  'kubernetes-workload',
  'network-route',
  'domain-and-tls',
]);
