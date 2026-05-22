import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

function hasCommand(command) {
  return spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).status === 0;
}

test('Go builder worker contract is executable when Go exists or statically present otherwise', async (t) => {
  if (hasCommand('go')) {
    const result = spawnSync('go', ['test', './...'], { cwd: 'services/builder', encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return;
  }

  const [main, worker, store] = await Promise.all([
    fs.readFile('services/builder/cmd/builder/main.go', 'utf8'),
    fs.readFile('services/builder/internal/worker/builder.go', 'utf8'),
    fs.readFile('services/builder/internal/controlplane/store.go', 'utf8'),
  ]);
  assert.match(main, /StateFileFromEnv/);
  assert.match(store, /ClaimNextWorkflowJob/);
  assert.match(store, /AppendBuildLog/);
  assert.match(worker, /git.*clone/s);
  assert.match(worker, /docker.*buildx.*build/s);
  assert.match(worker, /DeploymentStatusImageReady/);
  assert.match(worker, /imageDigest/);
});
