import { normalizeResourceEngine } from './catalog.ts';
import { slugify } from './ids.ts';
import YAML from 'yaml';

type AnyRecord = Record<string, any>;

function stripQuotes(value: any) {
  return String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
}

function parseScalar(value: any) {
  const raw = stripQuotes(value);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export function parseComposeYaml(text) {
  try {
    const parsed = YAML.parse(String(text || '')) || {};
    if (parsed && typeof parsed === 'object' && parsed.services && typeof parsed.services === 'object') {
      return { services: parsed.services };
    }
  } catch {
    // Keep the small legacy parser as a compatibility path for partial snippets;
    // full docker-compose files use the YAML parser above.
  }
  const services: AnyRecord = {};
  const lines = String(text || '').split(/\r?\n/);
  let inServices = false;
  let currentName: string | null = null;
  let currentProp: string | null = null;
  let nestedObject: string | null = null;

  for (const originalLine of lines) {
    const lineWithoutComment = originalLine.replace(/\s+#.*$/, '');
    if (!lineWithoutComment.trim()) continue;
    const indent = lineWithoutComment.match(/^\s*/)[0].length;
    const trimmed = lineWithoutComment.trim();

    if (indent === 0 && trimmed === 'services:') {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (indent === 0 && !trimmed.startsWith('services:')) break;

    if (indent === 2 && trimmed.endsWith(':')) {
      currentName = trimmed.slice(0, -1);
      services[currentName] = {};
      currentProp = null;
      nestedObject = null;
      continue;
    }
    if (!currentName) continue;

    if (indent === 4 && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();
      currentProp = key.trim();
      nestedObject = null;
      if (!value) {
        services[currentName][currentProp] = ['ports', 'environment', 'depends_on', 'volumes'].includes(currentProp) ? [] : {};
        nestedObject = currentProp;
      } else {
        services[currentName][currentProp] = parseScalar(value);
      }
      continue;
    }

    if (indent >= 6 && currentProp) {
      if (trimmed.startsWith('- ')) {
        if (!Array.isArray(services[currentName][currentProp])) services[currentName][currentProp] = [];
        services[currentName][currentProp].push(parseScalar(trimmed.slice(2)));
      } else if (trimmed.includes(':')) {
        const [key, ...valueParts] = trimmed.split(':');
        const value = parseScalar(valueParts.join(':').trim());
        if (Array.isArray(services[currentName][currentProp])) {
          services[currentName][currentProp] = {};
        }
        services[currentName][currentProp][key.trim()] = value;
        nestedObject = currentProp;
      } else if (nestedObject) {
        services[currentName][nestedObject] = parseScalar(trimmed);
      }
    }
  }

  return { services };
}

export function importCompose(text: any, { projectName = 'compose-project' }: AnyRecord = {}) {
  const parsed = parseComposeYaml(text);
  const services = [];
  const resources = [];

  for (const [name, rawSpec] of Object.entries(parsed.services || {})) {
    const spec = rawSpec as AnyRecord;
    const image = String(spec.image || '').toLowerCase();
    const resourceEngine = detectResourceEngine(name, image);
    if (resourceEngine) {
      resources.push({
        name: slugify(name),
        engine: resourceEngine,
        type: resourceType(resourceEngine),
        provider: 'managed-catalog',
        originalCompose: { image: spec.image || null, ports: spec.ports || [] },
      });
      continue;
    }

    const build = normalizeBuild(spec.build);
    const ports = normalizePorts(spec.ports || []);
    const environment = normalizeEnvironment(spec.environment || {});
    const envFiles = normalizeEnvFiles(spec.env_file);
    services.push({
      name: slugify(name),
      type: ports.length ? 'web' : inferNonHttpType(name, image),
      sourceType: build ? 'local' : (spec.image ? 'image' : 'local'),
      buildMode: build ? 'dockerfile' : (spec.image ? 'prebuilt-image' : 'auto'),
      buildContext: build?.context || '.',
      dockerfilePath: build?.dockerfile || undefined,
      image: spec.image || undefined,
      port: ports[0]?.containerPort || undefined,
      environment,
      envFiles,
      dependsOn: normalizeDependsOn(spec.depends_on),
      command: spec.command,
      entrypoint: spec.entrypoint,
      healthCheck: spec.healthcheck || spec.healthCheck || undefined,
      composeWarnings: spec.profiles ? ['compose profiles are not executed directly; profile-specific services are imported as normal desired state'] : [],
      attachedResources: [],
    });
  }

  const resourceNames = resources.map((resource) => resource.name);
  for (const service of services) {
    service.attachedResources = resourceNames;
  }

  return {
    project: { name: projectName, slug: slugify(projectName) },
    services,
    resources,
    notes: [
      'docker-compose services are translated into RAIBITSERVER services/resources; compose is not executed directly',
      'known stateful images become managed catalog resources for backup, metrics, RBAC, quota, and lifecycle control',
    ],
  };
}

function normalizeBuild(build: any) {
  if (!build) return null;
  if (typeof build === 'string') return { context: build, dockerfile: 'Dockerfile' };
  return { context: build.context || '.', dockerfile: build.dockerfile || 'Dockerfile' };
}

function normalizePorts(ports: any) {
  return (Array.isArray(ports) ? ports : []).map((port) => {
    const text = String(port);
    const parts = text.split(':');
    const containerPort = Number(parts.at(-1).split('/')[0]);
    const hostPort = parts.length > 1 ? Number(parts[0]) : null;
    return { hostPort: Number.isFinite(hostPort) ? hostPort : null, containerPort };
  }).filter((port) => Number.isFinite(port.containerPort));
}

function normalizeEnvironment(environment: any) {
  if (Array.isArray(environment)) {
    return Object.fromEntries(environment.map((entry) => {
      const [key, ...valueParts] = String(entry).split('=');
      return [key, valueParts.join('=')];
    }));
  }
  return { ...environment };
}

function normalizeEnvFiles(envFile: any) {
  if (!envFile) return [];
  return (Array.isArray(envFile) ? envFile : [envFile]).map(String);
}

function normalizeDependsOn(dependsOn: any) {
  if (!dependsOn) return [];
  if (Array.isArray(dependsOn)) return dependsOn.map(String);
  if (typeof dependsOn === 'object') return Object.keys(dependsOn);
  return [String(dependsOn)];
}

function detectResourceEngine(name: any, image: any) {
  const haystack = `${name} ${image}`.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ['postgresql', /(postgres|postgis)/],
    ['mysql', /\bmysql\b/],
    ['mariadb', /mariadb/],
    ['mongodb', /(mongo|mongodb)/],
    ['redis', /(redis|valkey)/],
    ['object-storage', /(minio|s3)/],
    ['vector-db', /(qdrant|weaviate|milvus|chroma)/],
    ['message-queue', /(kafka|redpanda|nats|rabbitmq)/],
  ];
  const match = rules.find(([, re]) => re.test(haystack));
  return match ? normalizeResourceEngine(match[0]) : null;
}

function resourceType(engine: string) {
  if (['postgresql', 'mysql', 'mariadb', 'mongodb'].includes(engine)) return 'database';
  if (engine === 'redis') return 'cache';
  if (engine === 'object-storage') return 'storage';
  if (engine === 'vector-db') return 'vector';
  if (engine === 'message-queue') return 'queue';
  return 'resource';
}

function inferNonHttpType(name: any, image: any) {
  const value = `${name} ${image}`.toLowerCase();
  if (/cron|schedule/.test(value)) return 'cron';
  if (/worker|bot|consumer|crawler/.test(value)) return 'worker';
  return 'private';
}
