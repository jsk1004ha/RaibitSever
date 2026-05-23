import { DEFAULT_DOMAIN } from './constants.ts';
import { serviceHostname } from './domain-router.ts';
import { slugify } from './ids.ts';

type AnyRecord = Record<string, any>;

export function previewKey(pullRequestNumber: any) {
  const number = Number(pullRequestNumber || 0);
  return `pr-${Number.isFinite(number) && number > 0 ? number : 0}`;
}

export function previewWorkloadName(service: AnyRecord = {}, pullRequestNumber: any) {
  const identity = previewIdentity({ service, pullRequestNumber });
  return identity.workloadName;
}

export function previewRuntimePlan(input: AnyRecord = {}) {
  const { service, project, pullRequestNumber, preview, serviceName, projectSlug, organizationSlug, workloadName } = previewIdentity(input);
  const baseDomain = input.baseDomain || service.baseDomain || project.baseDomain || DEFAULT_DOMAIN;
  const host = serviceHostname({ organizationSlug, projectSlug, serviceName, baseDomain, preview });
  const deploymentId = input.deploymentId || input.deployment?.id || null;
  const labels = {
    'app.kubernetes.io/name': workloadName,
    'app.kubernetes.io/managed-by': 'raibitserver',
    'raibitserver.io/project': projectSlug,
    'raibitserver.io/service': serviceName,
    'raibitserver.io/preview': 'true',
    'raibitserver.io/pull-request': String(Number.isFinite(pullRequestNumber) ? pullRequestNumber : 0),
    ...(deploymentId ? { 'raibitserver.io/deployment': String(deploymentId) } : {}),
  };
  return {
    kind: 'PreviewDeploymentPlan',
    action: input.action || 'apply',
    safe: true,
    pullRequestNumber: Number.isFinite(pullRequestNumber) ? pullRequestNumber : 0,
    deploymentId,
    url: `https://${host}`,
    host,
    kubernetes: {
      namespace: `${organizationSlug}-${projectSlug}`,
      workloadName,
      deploymentName: workloadName,
      serviceName: workloadName,
      ingressName: workloadName,
      labels,
      cleanupSelector: Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(','),
    },
  };
}

function previewIdentity(input: AnyRecord = {}) {
  const service = input.service || {};
  const project = input.project || {};
  const organization = input.organization || {};
  const pullRequestNumber = Number(input.pullRequestNumber || input.prNumber || 0);
  const preview = previewKey(pullRequestNumber);
  const serviceName = slugify(service.slug || service.name || service.id || 'service');
  const projectSlug = slugify(project.slug || project.name || project.id || 'project');
  const organizationSlug = slugify(organization.slug || organization.name || project.organizationSlug || project.organizationId || 'org');
  return { service, project, pullRequestNumber, preview, serviceName, projectSlug, organizationSlug, workloadName: `${preview}-${serviceName}` };
}
