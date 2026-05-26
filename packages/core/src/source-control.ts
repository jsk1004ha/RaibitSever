import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand, commandToString, type CommandSpec } from './command-runner.ts';
import { slugify } from './ids.ts';
import { normalizeTenantGitUrl } from './security.ts';

export function validateGitUrl(repoUrl: string) {
  const value = String(repoUrl || '').trim();
  if (!value) throw new Error('repoUrl is required for github/git source');
  return normalizeTenantGitUrl(value, { env: process.env });
}

export function redactGitUrl(url: string) {
  return String(url).replace(/(https:\/\/)([^/@\s]+)@/i, '$1****@');
}

function withToken(repoUrl: string, token?: string) {
  // Tokens are intentionally not embedded in argv/URLs because process lists can leak them.
  // cloneRepository creates a temporary GIT_ASKPASS helper for actual authenticated clones.
  return { url: repoUrl, redactedUrl: token ? `${repoUrl} (auth via GIT_ASKPASS)` : repoUrl };
}

export function gitCloneCommand({ repoUrl, branch = 'main', destination, depth = 1, commitSha = null, token = undefined, extraArgs = [] }: Record<string, any>) {
  const validated = validateGitUrl(repoUrl);
  const auth = withToken(validated, token);
  const args = ['clone', '--depth', String(depth), '--branch', String(branch), auth.url, destination, ...extraArgs];
  const redactedArgs = ['clone', '--depth', String(depth), '--branch', String(branch), auth.redactedUrl, destination, ...extraArgs];
  if (commitSha) {
    // The checkout happens as a separate step so shallow clones can be deepened by callers if needed.
  }
  return {
    executable: 'git',
    args,
    env: { GIT_TERMINAL_PROMPT: '0' },
    redacted: ['git', ...redactedArgs].join(' '),
  } satisfies CommandSpec;
}

export async function cloneRepository(options: Record<string, any>) {
  const repoUrl = validateGitUrl(options.repoUrl);
  const branch = options.branch || 'main';
  const destination = options.destination || path.join(options.workspaceDir || '.raibitserver-work', slugify(options.name || path.basename(repoUrl, '.git')));
  const dryRun = options.dryRun !== false;
  if (!dryRun) await fs.mkdir(path.dirname(destination), { recursive: true });
  const clone: CommandSpec = gitCloneCommand({ ...options, repoUrl, branch, destination });
  const askPassPath = !dryRun && options.token ? await writeAskPassScript(destination, String(options.token)) : null;
  if (askPassPath) clone.env = { ...(clone.env || {}), GIT_ASKPASS: askPassPath };
  const steps = [];
  try {
    steps.push(await runCommand(clone, { dryRun, timeoutMs: options.timeoutMs || 10 * 60 * 1000 }));
    if (options.commitSha) {
      steps.push(await runCommand({ executable: 'git', args: ['checkout', String(options.commitSha)], cwd: destination }, { dryRun, timeoutMs: options.timeoutMs || 10 * 60 * 1000 }));
    }
  } finally {
    if (askPassPath) {
      await fs.writeFile(askPassPath, '#!/bin/sh\nexit 1\n', { mode: 0o700 }).catch(() => undefined);
      await fs.unlink(askPassPath).catch(() => undefined);
    }
  }
  return {
    provider: repoUrl.includes('github.com') ? 'github' : 'git',
    repoUrl: redactGitUrl(repoUrl),
    branch,
    commitSha: options.commitSha || null,
    destination,
    dryRun,
    commands: steps.map((step) => step.command),
    steps: steps.map((step) => ({ command: step.command, cwd: step.cwd, dryRun: step.dryRun, exitCode: step.exitCode, stdout: step.stdout, stderr: step.stderr })),
  };
}


async function writeAskPassScript(destination: string, token: string) {
  const dir = path.dirname(destination);
  await fs.mkdir(dir, { recursive: true });
  const script = path.join(dir, `.raibitserver-git-askpass-${process.pid}.sh`);
  const body = `#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' ${shSingleQuote(token)} ;;
esac
`;
  await fs.writeFile(script, body, { mode: 0o700 });
  await fs.chmod(script, 0o700);
  return script;
}

function shSingleQuote(value: string) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function sourceCheckoutPlan(service: Record<string, any>, options: Record<string, any> = {}) {
  if (service.sourceType === 'image') {
    return { required: false, reason: 'prebuilt image source does not require source checkout' };
  }
  if (service.sourceType === 'local') {
    return { required: false, localPath: service.localPath || service.buildContext || '.', reason: 'local source path is already available' };
  }
  const repoUrl = service.repoUrl || service.repositoryUrl;
  if (!repoUrl) return { required: false, reason: 'no repository URL configured' };
  const destination = options.destination || path.join(options.workspaceDir || '.raibitserver-work', slugify(service.name || 'service'));
  const command = gitCloneCommand({ repoUrl, branch: service.branch || 'main', destination, depth: service.cloneDepth || 1, token: options.token });
  return {
    required: true,
    provider: repoUrl.includes('github.com') ? 'github' : 'git',
    repoUrl: redactGitUrl(repoUrl),
    branch: service.branch || 'main',
    commitSha: service.commitSha || service.commitHash || null,
    destination,
    command: commandToString(command),
  };
}
