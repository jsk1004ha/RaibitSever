import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { resolveBuildStrategy } from './build-strategy.ts';
import { SOURCE_TYPES } from './constants.ts';
import { cloneRepository, sourceCheckoutPlan } from './source-control.ts';
import { runCommand, commandToString, type CommandSpec } from './command-runner.ts';
import { pushImage, registryLogin } from './registry.ts';
import { isSecretKey, maskSecretValue } from './secrets.ts';
import { sanitizeLogRecord } from './security.ts';

export function dockerBuildxCommand({ image, context = '.', dockerfile = 'Dockerfile', push = false, load = false, platforms = [], buildArgs = {}, target = null, cache = true, metadataFile = null }: Record<string, any>) {
  if (!image) throw new Error('image is required for docker buildx');
  const args = ['buildx', 'build', '--file', String(dockerfile), '--tag', String(image)];
  const redactedArgs = [...args];
  if (metadataFile) { args.push('--metadata-file', String(metadataFile)); redactedArgs.push('--metadata-file', String(metadataFile)); }
  if (push) { args.push('--push'); redactedArgs.push('--push'); }
  if (load) { args.push('--load'); redactedArgs.push('--load'); }
  if (cache) { args.push('--cache-to', 'type=inline'); redactedArgs.push('--cache-to', 'type=inline'); }
  for (const platform of platforms || []) { args.push('--platform', String(platform)); redactedArgs.push('--platform', String(platform)); }
  for (const [key, value] of Object.entries(buildArgs || {})) {
    args.push('--build-arg', `${key}=${value}`);
    redactedArgs.push('--build-arg', `${key}=${isSecretKey(key) ? maskSecretValue(value) : value}`);
  }
  if (target) { args.push('--target', String(target)); redactedArgs.push('--target', String(target)); }
  args.push(String(context));
  redactedArgs.push(String(context));
  return { executable: 'docker', args, redacted: ['docker', ...redactedArgs].join(' ') } satisfies CommandSpec;
}

export function buildctlCommand({ image, context = '.', dockerfile = '.', push = true }: Record<string, any>) {
  return {
    executable: 'buildctl',
    args: [
      'build',
      '--frontend', 'dockerfile.v0',
      '--local', `context=${context}`,
      '--local', `dockerfile=${dockerfile}`,
      '--output', `type=image,name=${image},push=${push ? 'true' : 'false'}`,
    ],
  } satisfies CommandSpec;
}


function resolvePathWithinSourceDir(sourceDir: string, requestedPath: string, field: string) {
  const sourceRoot = path.resolve(sourceDir);
  const resolvedPath = path.resolve(sourceRoot, requestedPath);
  const relative = path.relative(sourceRoot, resolvedPath);
  if (relative === '' || relative === '.') return resolvedPath;
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${field} must stay within source directory`);
  }
  return resolvedPath;
}

export function buildExecutionPlan(service: Record<string, any>, files: Record<string, string> = {}, options: Record<string, any> = {}) {
  const buildPlan = resolveBuildStrategy(service, files);
  const checkout = sourceCheckoutPlan(service, options);
  const sourceDir = path.resolve(options.sourceDir || checkout.localPath || checkout.destination || '.');
  const dockerfile = service.dockerfilePath || 'Dockerfile';
  const context = resolvePathWithinSourceDir(sourceDir, service.buildContext || service.rootDirectory || '.', 'buildContext');
  const dockerfilePath = resolvePathWithinSourceDir(sourceDir, dockerfile, 'dockerfilePath');
  const push = Boolean(options.push || service.push);
  const builder = options.builder || 'docker-buildx';
  const buildCommand = builder === 'buildctl'
    ? buildctlCommand({ image: buildPlan.image, context, dockerfile: path.dirname(dockerfilePath), push })
    : dockerBuildxCommand({ image: buildPlan.image, context, dockerfile: dockerfilePath, push, load: !push, platforms: options.platforms || service.platforms || [], buildArgs: options.buildArgs || service.buildArgs || {}, target: options.target || service.target || null, metadataFile: options.metadataFile || service.metadataFile || null });

  return {
    service: buildPlan.service,
    image: buildPlan.image,
    mode: buildPlan.mode,
    checkout,
    builder,
    sourceDir,
    context,
    dockerfile: dockerfilePath,
    push,
    buildCommand: commandToString(buildCommand),
    registryPush: push ? null : { note: 'image can be pushed later with registry push command' },
    buildPlan,
  };
}

export async function executeBuildWorkflow(service: Record<string, any>, files: Record<string, string> = {}, options: Record<string, any> = {}) {
  const dryRun = options.dryRun !== false;
  const plan = buildExecutionPlan(service, files, options);
  const steps: any[] = [];
  let sourceDir = options.sourceDir || plan.sourceDir;

  if (plan.checkout.required) {
    const clone = await cloneRepository({
      repoUrl: service.repoUrl || service.repositoryUrl,
      branch: service.branch || 'main',
      commitSha: service.commitSha || service.commitHash || null,
      destination: plan.checkout.destination,
      workspaceDir: options.workspaceDir,
      token: options.githubToken || options.token,
      dryRun,
      timeoutMs: options.cloneTimeoutMs,
    });
    steps.push({ type: 'git-clone', ...clone });
    sourceDir = clone.destination;
  }

  if (service.sourceType === SOURCE_TYPES.IMAGE || plan.mode === 'prebuilt-image') {
    if (options.retagImage) {
      const tag = await runCommand({ executable: 'docker', args: ['tag', service.image || service.imageUrl, plan.image] }, { dryRun, timeoutMs: options.timeoutMs });
      steps.push({ type: 'docker-tag', command: tag.command, dryRun: tag.dryRun });
    }
    if (options.push) steps.push({ type: 'registry-push', ...(await pushImage({ image: plan.image, dryRun, timeoutMs: options.timeoutMs })) });
    const imageDigest = options.imageDigest || (dryRun ? deterministicImageDigest(plan.image) : null);
    return { ...plan, sourceDir, dryRun, imageDigest, steps };
  }

  if (options.registryUsername && options.registryPassword) {
    steps.push({ type: 'registry-login', ...(await registryLogin({ registry: options.registry || imageRegistry(plan.image), username: options.registryUsername, password: options.registryPassword, dryRun })) });
  }

  const buildCommand = options.builder === 'buildctl'
    ? buildctlCommand({ image: plan.image, context: plan.context, dockerfile: path.dirname(plan.dockerfile), push: plan.push })
    : dockerBuildxCommand({ image: plan.image, context: plan.context, dockerfile: plan.dockerfile, push: plan.push, load: !plan.push, platforms: options.platforms || service.platforms || [], buildArgs: options.buildArgs || service.buildArgs || {}, target: options.target || service.target || null, metadataFile: options.metadataFile || service.metadataFile || null });
  await ensureSyntheticDockerfileIfNeeded(plan, service, { dryRun });
  const result = await runCommand(buildCommand, { dryRun, timeoutMs: options.timeoutMs || 30 * 60 * 1000 });
  const imageDigest = await resolveBuildDigest(options.metadataFile || service.metadataFile, plan.image, dryRun);
  steps.push({ type: 'buildkit-build', command: result.command, dryRun: result.dryRun, imageDigest, ...safeCommandOutput(result, options) });

  if (!plan.push && options.pushAfterBuild) {
    steps.push({ type: 'registry-push', ...(await pushImage({ image: plan.image, dryRun, timeoutMs: options.timeoutMs })) });
  }
  return { ...plan, sourceDir, dryRun, imageDigest, steps };
}

async function ensureSyntheticDockerfileIfNeeded(plan: Record<string, any>, service: Record<string, any>, { dryRun }: Record<string, any>) {
  if (plan.mode === 'dockerfile') return;
  if (dryRun) return;
  await fs.mkdir(path.dirname(plan.dockerfile), { recursive: true });
  const start = service.startCommand || plan.buildPlan.runtime?.startCommand || 'npm start';
  const build = service.buildCommand || service.customBuildCommand || 'npm run build --if-present';
  const install = service.installCommand || 'if [ -f package-lock.json ]; then npm ci; elif [ -f package.json ]; then npm install; fi';
  const prune = service.pruneCommand || 'if [ -f package.json ]; then npm prune --omit=dev; fi';
  const dockerfile = `FROM node:24-alpine\nWORKDIR /app\nCOPY . .\nRUN ${install}\nRUN ${build}\nRUN ${prune}\nRUN chown -R node:node /app\nENV NODE_ENV=production\nUSER node\nCMD ${JSON.stringify(['sh', '-lc', start])}\n`;
  await fs.writeFile(plan.dockerfile, dockerfile);
}


function safeCommandOutput(result: Record<string, any>, options: Record<string, any>) {
  if (!options.includeCommandOutput) return {};
  return {
    stdout: sanitizeLogRecord(result.stdout || ''),
    stderr: sanitizeLogRecord(result.stderr || ''),
  };
}

function imageRegistry(image: string) {
  const first = String(image).split('/')[0];
  return first.includes('.') ? first : 'docker.io';
}

async function resolveBuildDigest(metadataFile: any, image: string, dryRun: boolean) {
  if (metadataFile) {
    try {
      const metadata = JSON.parse(await fs.readFile(String(metadataFile), 'utf8'));
      const digest = metadata['containerimage.digest'] || metadata['containerimage.descriptor']?.digest;
      if (digest) return String(digest);
    } catch {
      // Buildx does not create a metadata file on dry-run or with builders that omit metadata.
    }
  }
  if (dryRun) return deterministicImageDigest(image);
  return null;
}

function deterministicImageDigest(image: string) {
  return `sha256:${crypto.createHash('sha256').update(String(image)).digest('hex')}`;
}
