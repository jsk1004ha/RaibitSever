import { nowIso, stableId } from './ids.ts';
import { maskSecrets } from './secrets.ts';

export const WORKFLOW_TYPES = Object.freeze({
  BUILD_AND_DEPLOY: 'build-and-deploy',
  KUBERNETES_APPLY: 'kubernetes-apply',
  PROVISION_RESOURCE: 'provision-resource',
});

export function createWorkflowJobRecord(input: Record<string, any>) {
  const type = input.type || WORKFLOW_TYPES.BUILD_AND_DEPLOY;
  const targetType = input.targetType || 'deployment';
  const targetId = input.targetId || input.deploymentId || input.serviceId;
  if (!targetId) throw new Error('workflow job targetId is required');
  return {
    id: input.id || stableId('job', type, targetType, targetId, input.createdAt || Date.now()),
    type,
    status: input.status || 'queued',
    targetType,
    targetId,
    payload: maskSecrets(input.payload || {}),
    attempts: Number(input.attempts || 0),
    maxAttempts: Number(input.maxAttempts || 3),
    runAfter: input.runAfter || nowIso(),
    lockedBy: input.lockedBy || null,
    lockedAt: input.lockedAt || null,
    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || nowIso(),
  };
}
