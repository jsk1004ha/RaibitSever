import { runCommand, commandToString, type CommandSpec } from './command-runner.ts';

export function parseImageReference(image: string) {
  const original = String(image || '').trim();
  if (!original) throw new Error('image reference is required');
  const [nameWithOptionalTag, digest = null] = original.split('@');
  const lastSlash = nameWithOptionalTag.lastIndexOf('/');
  const lastColon = nameWithOptionalTag.lastIndexOf(':');
  const hasTag = !digest && lastColon > lastSlash;
  const nameWithoutTag = hasTag ? nameWithOptionalTag.slice(0, lastColon) : nameWithOptionalTag;
  const tag = hasTag ? nameWithOptionalTag.slice(lastColon + 1) : (digest ? null : 'latest');
  const parts = nameWithoutTag.split('/');
  const first = parts[0] || '';
  const hasExplicitRegistry = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost');
  const registry = hasExplicitRegistry ? first : 'docker.io';
  const repository = (hasExplicitRegistry ? parts.slice(1) : parts).join('/');
  const normalized = digest ? `${nameWithoutTag}@${digest}` : `${nameWithoutTag}:${tag}`;
  return { registry, repository, tag, digest, image: normalized };
}

export function dockerLoginCommand({ registry, username, password }: Record<string, any>) {
  if (!registry || !username || !password) throw new Error('registry, username, and password are required for docker login');
  return {
    executable: 'docker',
    args: ['login', String(registry), '--username', String(username), '--password-stdin'],
    stdin: String(password),
    redacted: `docker login ${registry} --username ${username} --password-stdin`,
  } satisfies CommandSpec;
}

export function dockerPushCommand(image: string) {
  return { executable: 'docker', args: ['push', image] } satisfies CommandSpec;
}

export async function registryLogin(options: Record<string, any>) {
  const command = dockerLoginCommand(options);
  const result = await runCommand(command, { dryRun: options.dryRun !== false, timeoutMs: options.timeoutMs || 5 * 60 * 1000 });
  return { registry: options.registry, dryRun: result.dryRun, command: result.command, result };
}

export async function pushImage({ image, dryRun = true, timeoutMs = 20 * 60 * 1000 }: Record<string, any>) {
  if (!image) throw new Error('image is required for registry push');
  const command = dockerPushCommand(image);
  const result = await runCommand(command, { dryRun, timeoutMs });
  return { image, registry: parseImageReference(image).registry, dryRun: result.dryRun, command: result.command, result };
}

export function registryPushPlan(image: string) {
  const command = dockerPushCommand(image);
  return { image, registry: parseImageReference(image).registry, command: commandToString(command) };
}
