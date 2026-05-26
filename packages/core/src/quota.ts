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

export function quotaUsageGauges(usage = {}, quota = null, options: Record<string, any> = {}) {
  if (!quota) return [];
  const threshold = Number(options.warningThreshold ?? 0.8);
  return Object.entries(quota)
    .filter(([metric, limit]) => metric.startsWith('max') && typeof limit === 'number' && Number.isFinite(limit) && limit > 0)
    .map(([metric, limit]) => {
      const used = Math.max(0, Number(usage[metric] || 0));
      const ratio = used / Number(limit);
      return {
        metric,
        used,
        limit,
        remaining: Math.max(0, Number(limit) - used),
        percent: Math.round(ratio * 100),
        level: ratio >= 1 ? 'blocked' : (ratio >= threshold ? 'warning' : 'ok'),
      };
    });
}

export function quotaWarnings(usage = {}, quota = null, options = {}) {
  return quotaUsageGauges(usage, quota, options)
    .filter((gauge) => gauge.level !== 'ok')
    .map((gauge) => ({
      code: gauge.level === 'blocked' ? 'QUOTA_EXHAUSTED' : 'QUOTA_NEAR_LIMIT',
      metric: gauge.metric,
      message: `${gauge.metric} is ${gauge.percent}% used (${gauge.used}/${gauge.limit})`,
      level: gauge.level,
    }));
}
