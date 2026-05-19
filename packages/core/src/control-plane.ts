import { compileProject } from './manifest-compiler.ts';
import { importCompose } from './compose-importer.ts';
import { listCatalog } from './catalog.ts';
import { resolveBuildStrategy } from './build-strategy.ts';
import { ControlPlaneStore } from './store.ts';
import { checkQuota } from './quota.ts';
import { validateServiceSecurity, guardDatabaseQuery } from './security.ts';
import { metricSeries, alertPolicies } from './observability.ts';
import type { ProjectSpec, ResourceSpec, ServiceSpec } from './types.ts';

export class RAIBITSERVERControlPlane {
  store: ControlPlaneStore;

  constructor(store = new ControlPlaneStore()) {
    this.store = store;
  }

  catalog() {
    return listCatalog();
  }

  planBuild(service: ServiceSpec, files: Record<string, string> = {}) {
    return resolveBuildStrategy(service, files);
  }

  importCompose(text: string, options: Record<string, unknown> = {}) {
    return importCompose(text, options);
  }

  compileManifests(projectSpec: ProjectSpec, filesByService: Record<string, Record<string, string>> = {}) {
    return compileProject(projectSpec, filesByService);
  }

  validateProject(projectSpec: ProjectSpec) {
    const serviceFindings = (projectSpec.services || []).map((service) => ({
      service: service.name,
      security: validateServiceSecurity(service),
      metrics: metricSeries(service),
    }));
    const quota = checkQuota({
      plan: projectSpec.organization?.plan || 'free',
      current: projectSpec.currentUsage || {},
      requested: {
        apps: (projectSpec.services || []).length,
        projects: 1,
        dbStorageGb: (projectSpec.resources || []).reduce((sum, resource) => sum + Number(resource.storageGb || 0), 0),
        customDomains: (projectSpec.services || []).filter((service) => service.domain).length,
      },
    });
    return {
      ok: serviceFindings.every((row) => row.security.ok) && quota.ok,
      serviceFindings,
      quota,
      alertPolicies: alertPolicies(),
    };
  }

  guardQuery(query: string, options: Record<string, unknown> = {}) {
    return guardDatabaseQuery(query, options);
  }
}
