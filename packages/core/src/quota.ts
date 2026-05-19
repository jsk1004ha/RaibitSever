export const PLANS = Object.freeze({
  free: {
    apps: 3,
    projects: 3,
    teamMembers: 5,
    alwaysOnReplicas: 0,
    dbStorageGb: 1,
    buildMinutesMonthly: 200,
    customDomains: 0,
    autoSleep: true,
  },
  club: {
    apps: 50,
    projects: 20,
    teamMembers: 30,
    alwaysOnReplicas: 3,
    dbStorageGb: 50,
    buildMinutesMonthly: 2000,
    customDomains: 5,
    autoSleep: true,
  },
  pro: {
    apps: 100,
    projects: 50,
    teamMembers: 50,
    alwaysOnReplicas: 20,
    dbStorageGb: 200,
    buildMinutesMonthly: 10000,
    customDomains: 50,
    autoSleep: false,
  },
  school: {
    apps: Infinity,
    projects: Infinity,
    teamMembers: Infinity,
    alwaysOnReplicas: Infinity,
    dbStorageGb: Infinity,
    buildMinutesMonthly: Infinity,
    customDomains: Infinity,
    autoSleep: false,
  },
});

export function quotaForPlan(plan = 'free') {
  return PLANS[plan] || PLANS.free;
}

export function checkQuota({ plan = 'free', current = {}, requested = {} }) {
  const quota = quotaForPlan(plan);
  const violations = [];
  for (const [metric, limit] of Object.entries(quota)) {
    if (typeof limit !== 'number' || limit === Infinity) continue;
    const used = Number(current[metric] || 0) + Number(requested[metric] || 0);
    if (used > limit) {
      violations.push({ metric, limit, requested: used, message: `${metric} quota exceeded (${used}/${limit})` });
    }
  }
  return { ok: violations.length === 0, quota, violations };
}

export function usageMetricDefinitions() {
  return [
    'app-runtime-seconds',
    'cpu-vcpu-seconds',
    'memory-gib-seconds',
    'build-minutes',
    'db-storage-gb-hours',
    'db-compute-hours',
    'network-egress-gb',
    'object-storage-gb-hours',
    'object-storage-requests',
    'custom-domains',
    'team-members',
    'backup-retention-days',
  ];
}
