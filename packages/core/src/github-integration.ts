import crypto from 'node:crypto';
import { maskSecretValue } from './secrets.ts';

export function parseGitHubRepository(input: string | Record<string, any>) {
  const value = typeof input === 'string' ? input : (input.repoUrl || input.repositoryUrl || `${input.owner}/${input.repo}`);
  const text = String(value || '').trim();
  const https = text.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[?#].*)?$/i);
  const ssh = text.match(/^git@github\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  const slug = text.match(/^([^/\s]+)\/([^/\s]+)$/);
  const match = https || ssh || slug;
  if (!match) {
    const error = new Error(`unsupported GitHub repository: ${text}`);
    (error as any).statusCode = 400;
    throw error;
  }
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, '');
  return { owner, repo, fullName: `${owner}/${repo}`, repoUrl: `https://github.com/${owner}/${repo}.git` };
}

export function githubTokenFingerprint(token: string) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
}

export function githubIntegrationSummary(input: Record<string, any>) {
  return {
    provider: 'github',
    accountLogin: input.accountLogin || input.owner || null,
    installationId: input.installationId || null,
    tokenPreview: input.token ? maskSecretValue(input.token) : input.tokenPreview || null,
    tokenFingerprint: input.token ? githubTokenFingerprint(input.token) : input.tokenFingerprint || null,
    scopes: input.scopes || ['repo:read'],
  };
}

export function githubCloneOptionsFromIntegration(integration: Record<string, any>, repository: string | Record<string, any>, options: Record<string, any> = {}) {
  const repo = parseGitHubRepository(repository);
  return {
    repoUrl: repo.repoUrl,
    branch: options.branch || integration.defaultBranch || 'main',
    token: options.token || integration.token || undefined,
    redactedToken: integration.tokenPreview || (integration.token ? maskSecretValue(integration.token) : null),
  };
}

export function verifyGitHubWebhookSignature(body: any, signatureHeader: string, secret: string) {
  if (!secret) return false;
  const header = String(signatureHeader || '');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
