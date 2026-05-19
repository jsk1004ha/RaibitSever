export interface GitHubWebhookEvent {
  installationId: string;
  repository: string;
  branch: string;
  commitSha: string;
  event: 'push' | 'pull_request';
}

export function toDeploymentIntent(event: GitHubWebhookEvent) {
  return {
    source: 'github',
    repository: event.repository,
    branch: event.branch,
    commitSha: event.commitSha,
    deploymentType: event.event === 'pull_request' ? 'preview' : 'production',
  } as const;
}
