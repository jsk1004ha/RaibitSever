import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileProject } from './manifest-compiler.ts';
import { runCommand, commandToString, type CommandSpec } from './command-runner.ts';
import { maskSecrets } from './secrets.ts';

export function kubectlApplyCommand({ file = '-', namespace = null, kubeconfig = null, context = null, serverSide = true, dryRunMode = null, prune = false, selector = null }: Record<string, any>) {
  const args = ['apply'];
  if (serverSide) args.push('--server-side');
  if (namespace) args.push('--namespace', String(namespace));
  if (kubeconfig) args.push('--kubeconfig', String(kubeconfig));
  if (context) args.push('--context', String(context));
  if (dryRunMode) args.push(`--dry-run=${dryRunMode}`);
  if (prune) args.push('--prune');
  if (selector) args.push('--selector', String(selector));
  args.push('-f', String(file));
  return { executable: 'kubectl', args } satisfies CommandSpec;
}

export function kubernetesApplyPlan(manifests: any[] = [], options: Record<string, any> = {}) {
  const namespace = options.namespace || manifests.find((manifest) => manifest.kind === 'Namespace')?.metadata?.name || null;
  const command = kubectlApplyCommand({ file: options.file || '<generated-json-list>', namespace: options.applyNamespace ? namespace : null, kubeconfig: options.kubeconfig, context: options.context, serverSide: options.serverSide !== false, dryRunMode: options.dryRunMode || null });
  return {
    namespace,
    manifestCount: manifests.length,
    serverSide: options.serverSide !== false,
    command: commandToString(command),
    list: { apiVersion: 'v1', kind: 'List', items: manifests },
  };
}

export async function applyManifests(manifests: any[] = [], options: Record<string, any> = {}) {
  const dryRun = options.dryRun !== false;
  const dir = options.outputDir || await fs.mkdtemp(path.join(os.tmpdir(), 'raibitserver-k8s-'));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, options.fileName || 'manifests.json');
  const payload = { apiVersion: 'v1', kind: 'List', items: manifests };
  const payloadToWrite = dryRun ? maskSecrets(payload) : payload;
  await fs.writeFile(file, `${JSON.stringify(payloadToWrite, null, 2)}\n`, { mode: 0o600 });
  const namespace = options.namespace || manifests.find((manifest) => manifest.kind === 'Namespace')?.metadata?.name || null;
  const command = kubectlApplyCommand({ file, namespace: options.applyNamespace ? namespace : null, kubeconfig: options.kubeconfig, context: options.context, serverSide: options.serverSide !== false, dryRunMode: options.kubectlDryRunMode || null });
  const result = await runCommand(command, { dryRun, timeoutMs: options.timeoutMs || 10 * 60 * 1000 });
  if (!dryRun && options.keepManifest !== true) await fs.unlink(file).catch(() => undefined);
  return {
    namespace,
    manifestFile: dryRun || options.keepManifest === true ? file : null,
    manifestCount: manifests.length,
    dryRun,
    command: result.command,
    result,
  };
}

export async function applyProject(projectSpec: Record<string, any>, filesByService: Record<string, Record<string, string>> = {}, options: Record<string, any> = {}) {
  const compiled = compileProject(projectSpec, filesByService);
  const apply = await applyManifests(compiled.manifests, options);
  return { compiled: maskSecrets(compiled), apply };
}
