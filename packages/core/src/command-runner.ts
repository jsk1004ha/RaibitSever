import { spawn } from 'node:child_process';
import { once } from 'node:events';

export interface CommandSpec {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  redacted?: string;
}

export interface CommandRunResult {
  command: string;
  executable: string;
  args: string[];
  cwd?: string;
  dryRun: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function commandToString(command: CommandSpec) {
  if (command.redacted) return command.redacted;
  return [command.executable, ...(command.args || [])].map(shellQuote).join(' ');
}

export function shellQuote(value: string) {
  const text = String(value);
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

export async function runCommand(command: CommandSpec, { dryRun = false, timeoutMs = 20 * 60 * 1000 } = {}) {
  const args = command.args || [];
  const printable = commandToString(command);
  if (dryRun) {
    return {
      command: printable,
      executable: command.executable,
      args,
      cwd: command.cwd,
      dryRun: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
    } satisfies CommandRunResult;
  }

  const child = spawn(command.executable, args, {
    cwd: command.cwd,
    env: { ...process.env, ...(command.env || {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  if (command.stdin) child.stdin?.write(command.stdin);
  child.stdin?.end();

  const [exitCodeRaw] = await once(child, 'close');
  clearTimeout(timer);
  const exitCode = Number(exitCodeRaw ?? 0);
  const result = { command: printable, executable: command.executable, args, cwd: command.cwd, dryRun: false, exitCode, stdout, stderr } satisfies CommandRunResult;
  if (exitCode !== 0) {
    const error = new Error(`command failed (${exitCode}): ${printable}\n${stderr || stdout}`);
    (error as any).result = result;
    throw error;
  }
  return result;
}

export async function commandExists(executable: string) {
  try {
    await runCommand({ executable, args: ['--version'] }, { dryRun: false, timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}
