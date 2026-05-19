import { DEFAULT_CONTAINER_SECURITY_CONTEXT, DEFAULT_POD_SECURITY_CONTEXT, secureContainerDefaults, splitEnvForSecret, validateServiceSecurity } from './security.ts';
import { injectResourceEnv } from './env-injection.ts';
import { resolveBuildStrategy } from './build-strategy.ts';
import { DEFAULT_DOMAIN, DEFAULT_PORT, SERVICE_TYPES } from './constants.ts';
import { getCatalogEntry, normalizeResourceEngine } from './catalog.ts';
import { slugify } from './ids.ts';
import { domainPlanForProject, serviceHostname } from './domain-router.ts';

type AnyRecord = Record<string, any>;

export function compileProject(spec: AnyRecord = {}, filesByService: AnyRecord = {}) {
  const organization = spec.organization || { slug: spec.organizationSlug || 'default' };
  const project = spec.project || { name: spec.name || 'project', slug: spec.slug || spec.name || 'project' };
  const projectSlug = slugify(project.slug || project.name);
  const organizationSlug = slugify(organization.slug || organization.name || 'org');
  const baseDomain = spec.baseDomain || DEFAULT_DOMAIN;
  const namespace = slugify(`${organization.slug || organization.name || 'org'}-${projectSlug}`);
  const services: AnyRecord[] = spec.services || [];
  const resources: AnyRecord[] = spec.resources || [];
  const manifests: AnyRecord[] = [namespaceManifest(namespace, projectSlug)];
  const buildPlans: AnyRecord[] = [];
  const resourcePlans = resources.map((resource) => resourcePlan(resource, namespace, projectSlug));

  for (const service of services) {
    const serviceName = slugify(service.name);
    const fullService = {
      projectSlug,
      registry: spec.registry,
      ...service,
      name: serviceName,
    };
    const buildPlan = resolveBuildStrategy(fullService, filesByService[service.name] || filesByService[serviceName] || {});
    buildPlans.push(buildPlan);
    const serviceManifests = compileService({ namespace, organizationSlug, projectSlug, baseDomain, service: fullService, resources, image: buildPlan.image });
    manifests.push(...serviceManifests);
  }

  manifests.push(networkPolicyManifest(namespace, services, resources));
  return {
    apiVersion: 'raibitserver.io/v1alpha1',
    kind: 'ProjectDeploymentPlan',
    metadata: {
      organization: organization.slug || organization.name || 'default',
      project: projectSlug,
      namespace,
    },
    buildPlans,
    resourcePlans,
    domainPlan: domainPlanForProject(spec),
    manifests,
    security: {
      tenantNamespace: namespace,
      defaults: {
        podSecurityContext: DEFAULT_POD_SECURITY_CONTEXT,
        containerSecurityContext: DEFAULT_CONTAINER_SECURITY_CONTEXT,
        networkPolicy: 'deny-cross-project-and-control-plane-by-default',
      },
      findings: services.flatMap((service) => validateServiceSecurity(service).findings.map((finding) => ({ service: service.name, ...finding }))),
    },
  };
}

function compileService({ namespace, organizationSlug, projectSlug, baseDomain, service, resources, image }: AnyRecord) {
  const serviceName = slugify(service.name);
  const type = service.type || SERVICE_TYPES.WEB;
  const port = Number(service.port || DEFAULT_PORT);
  const env = injectResourceEnv(service, resources, projectSlug);
  const { plain, secret } = splitEnvForSecret(env);
  const labels = labelsFor(projectSlug, serviceName, type);
  const out: AnyRecord[] = [];

  if (Object.keys(secret).length) out.push(secretManifest(namespace, `${serviceName}-env`, labels, secret));
  if (Object.keys(plain).length) out.push(configMapManifest(namespace, `${serviceName}-config`, labels, plain));

  if (type === SERVICE_TYPES.CRON) {
    out.push(cronJobManifest(namespace, service, labels, image, port, plain, secret));
    return out;
  }
  if (type === SERVICE_TYPES.JOB) {
    out.push(jobManifest(namespace, service, labels, image, port, plain, secret));
    return out;
  }

  out.push(deploymentManifest(namespace, service, labels, image, port, plain, secret));
  if ([SERVICE_TYPES.WEB, SERVICE_TYPES.PRIVATE].includes(type) && port) {
    out.push(serviceManifest(namespace, serviceName, labels, port));
  }
  if (type === SERVICE_TYPES.WEB) {
    out.push(ingressManifest(namespace, service, organizationSlug, projectSlug, baseDomain, labels, port));
  }
  if (service.scaling?.maxReplicas && Number(service.scaling.maxReplicas) > Number(service.scaling.minReplicas || 1)) {
    out.push(hpaManifest(namespace, serviceName, service.scaling));
  }
  out.push(pdbManifest(namespace, serviceName, labels, service.availability));
  return out;
}

function namespaceManifest(namespace: string, projectSlug: string): AnyRecord {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: namespace,
      labels: {
        'raibitserver.io/project': projectSlug,
        'pod-security.kubernetes.io/enforce': 'restricted',
      },
    },
  };
}

function labelsFor(projectSlug: string, serviceName: string, type: string): AnyRecord {
  return {
    'app.kubernetes.io/name': serviceName,
    'app.kubernetes.io/managed-by': 'raibitserver',
    'raibitserver.io/project': projectSlug,
    'raibitserver.io/service': serviceName,
    'raibitserver.io/service-type': type,
  };
}

function envRefs(plain: AnyRecord, secret: AnyRecord, secretName: string): AnyRecord[] {
  const values = Object.keys(plain).map((key) => ({ name: key, valueFrom: { configMapKeyRef: { name: secretName.replace('-env', '-config'), key } } }));
  const secrets = Object.keys(secret).map((key) => ({ name: key, valueFrom: { secretKeyRef: { name: secretName, key } } }));
  return [...values, ...secrets];
}

function containerFor(service: AnyRecord, image: string, port: number, plain: AnyRecord, secret: AnyRecord): AnyRecord {
  const serviceName = slugify(service.name);
  return {
    name: serviceName,
    image,
    imagePullPolicy: 'IfNotPresent',
    ports: port ? [{ name: 'http', containerPort: port }] : [],
    env: envRefs(plain, secret, `${serviceName}-env`),
    command: service.command || undefined,
    args: service.args || undefined,
    resources: service.resources || {
      requests: { cpu: '100m', memory: '128Mi' },
      limits: { cpu: '500m', memory: '512Mi' },
    },
    securityContext: secureContainerDefaults(service),
    readinessProbe: service.healthCheck?.path ? httpProbe(service.healthCheck.path, port) : undefined,
    livenessProbe: service.healthCheck?.path ? httpProbe(service.healthCheck.path, port) : undefined,
  };
}

function podSpec(service: AnyRecord, image: string, port: number, plain: AnyRecord, secret: AnyRecord, restartPolicy = 'Always'): AnyRecord {
  return {
    securityContext: DEFAULT_POD_SECURITY_CONTEXT,
    restartPolicy,
    containers: [containerFor(service, image, port, plain, secret)],
    automountServiceAccountToken: false,
  };
}

function deploymentManifest(namespace: string, service: AnyRecord, labels: AnyRecord, image: string, port: number, plain: AnyRecord, secret: AnyRecord): AnyRecord {
  const serviceName = slugify(service.name);
  const replicas = service.sleepPolicy === 'scale-to-zero' ? 0 : Number(service.scaling?.minReplicas ?? service.replicas ?? 1);
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: serviceName, namespace, labels },
    spec: {
      replicas,
      selector: { matchLabels: { 'app.kubernetes.io/name': serviceName } },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
      template: {
        metadata: { labels, annotations: { 'raibitserver.io/sleep-policy': service.sleepPolicy || 'always-on' } },
        spec: podSpec(service, image, port, plain, secret),
      },
    },
  };
}

function cronJobManifest(namespace: string, service: AnyRecord, labels: AnyRecord, image: string, port: number, plain: AnyRecord, secret: AnyRecord): AnyRecord {
  const serviceName = slugify(service.name);
  return {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: { name: serviceName, namespace, labels },
    spec: {
      schedule: service.schedule || '0 * * * *',
      concurrencyPolicy: service.concurrencyPolicy || 'Forbid',
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: service.backoffLimit ?? 2,
          template: { metadata: { labels }, spec: podSpec(service, image, port, plain, secret, 'OnFailure') },
        },
      },
    },
  };
}

function jobManifest(namespace: string, service: AnyRecord, labels: AnyRecord, image: string, port: number, plain: AnyRecord, secret: AnyRecord): AnyRecord {
  const serviceName = slugify(service.name);
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: serviceName, namespace, labels },
    spec: {
      backoffLimit: service.backoffLimit ?? 1,
      template: { metadata: { labels }, spec: podSpec(service, image, port, plain, secret, 'Never') },
    },
  };
}

function serviceManifest(namespace: string, serviceName: string, labels: AnyRecord, port: number): AnyRecord {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: serviceName, namespace, labels },
    spec: {
      type: 'ClusterIP',
      selector: { 'app.kubernetes.io/name': serviceName },
      ports: [{ name: 'http', port, targetPort: 'http' }],
    },
  };
}

function ingressManifest(namespace: string, service: AnyRecord, organizationSlug: string, projectSlug: string, baseDomain: string, labels: AnyRecord, port: number): AnyRecord {
  const serviceName = slugify(service.name);
  const host = serviceHostname({
    organizationSlug,
    projectSlug,
    serviceName,
    baseDomain: service.baseDomain || baseDomain || DEFAULT_DOMAIN,
    customDomain: service.domain || null,
  });
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: serviceName,
      namespace,
      labels,
      annotations: {
        'cert-manager.io/cluster-issuer': service.tlsIssuer || 'letsencrypt',
        'traefik.ingress.kubernetes.io/router.entrypoints': 'websecure',
        'raibitserver.io/hostname': host,
      },
    },
    spec: {
      tls: [{ hosts: [host], secretName: `${serviceName}-tls` }],
      rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: serviceName, port: { number: port } } } }] } }],
    },
  };
}

function hpaManifest(namespace: string, serviceName: string, scaling: AnyRecord): AnyRecord {
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { name: `${serviceName}-hpa`, namespace },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: serviceName },
      minReplicas: scaling.minReplicas ?? 1,
      maxReplicas: scaling.maxReplicas,
      metrics: scaling.metrics || [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }],
    },
  };
}

function pdbManifest(namespace: string, serviceName: string, labels: AnyRecord, availability: AnyRecord = {}): AnyRecord {
  return {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: { name: `${serviceName}-pdb`, namespace, labels },
    spec: {
      minAvailable: availability.minAvailable ?? 0,
      selector: { matchLabels: { 'app.kubernetes.io/name': serviceName } },
    },
  };
}

function secretManifest(namespace: string, name: string, labels: AnyRecord, data: AnyRecord): AnyRecord {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name, namespace, labels },
    type: 'Opaque',
    stringData: data,
  };
}

function configMapManifest(namespace: string, name: string, labels: AnyRecord, data: AnyRecord): AnyRecord {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name, namespace, labels },
    data,
  };
}

function httpProbe(path: string, port: number): AnyRecord {
  return {
    httpGet: { path, port: 'http' },
    initialDelaySeconds: 10,
    periodSeconds: 10,
    timeoutSeconds: 2,
    failureThreshold: 3,
  };
}

function networkPolicyManifest(namespace: string, services: AnyRecord[], resources: AnyRecord[]): AnyRecord {
  const serviceNames = services.map((service) => slugify(service.name));
  const resourceNames = resources.map((resource) => slugify(resource.name));
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'tenant-isolation', namespace },
    spec: {
      podSelector: {},
      policyTypes: ['Ingress', 'Egress'],
      ingress: [
        { from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } } }] },
        { from: [{ namespaceSelector: { matchLabels: { 'raibitserver.io/ingress-gateway': 'true' } } }] },
      ],
      egress: [
        { to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } } }] },
        { to: [{ ipBlock: { cidr: '0.0.0.0/0', except: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'] } }] },
      ],
    },
    raibitserver: {
      allowsOwnServices: serviceNames,
      allowsOwnResources: resourceNames,
      blocksControlPlane: true,
      blocksCrossProject: true,
    },
  };
}

function resourcePlan(resource: AnyRecord, namespace: string, projectSlug: string): AnyRecord {
  const engine = normalizeResourceEngine(resource.engine || resource.type);
  const entry = getCatalogEntry(engine);
  return {
    name: slugify(resource.name),
    namespace,
    project: projectSlug,
    catalogKey: entry.key,
    displayName: entry.displayName,
    type: entry.type,
    engine: entry.engine,
    version: resource.version || entry.defaultVersion,
    provider: resource.provider || 'hybrid-managed',
    operator: entry.operator,
    plan: resource.plan || 'shared-small',
    lifecycle: ['provision', 'credential', 'backup', 'metrics', 'restore', 'delete'],
    env: entry.env,
    backup: resource.backup || { schedule: 'daily', retentionDays: 7 },
  };
}
