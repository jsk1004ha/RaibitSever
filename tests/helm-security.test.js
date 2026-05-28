import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const deploymentTemplates = [
  'infra/helm/raibitserver/templates/api-deployment.yaml',
  'infra/helm/raibitserver/templates/orchestrator-deployment.yaml',
];

test('Helm control-plane workloads keep non-root filesystem and resource hardening', async () => {
  for (const templatePath of deploymentTemplates) {
    const template = await fs.readFile(templatePath, 'utf8');
    assert.match(template, /securityContext:\s*\n(?:.*\n){0,4}\s*runAsNonRoot: true/, `${templatePath} must set pod/container non-root security context`);
    assert.match(template, /seccompProfile:\s*\n\s*type: RuntimeDefault/, `${templatePath} must use RuntimeDefault seccomp`);
    assert.match(template, /readOnlyRootFilesystem: true/, `${templatePath} must mount root filesystem read-only`);
    assert.match(template, /runAsUser: 10001/, `${templatePath} must use an explicit non-root UID`);
    assert.match(template, /allowPrivilegeEscalation: false/, `${templatePath} must block privilege escalation`);
    assert.match(template, /drop: \["ALL"\]/, `${templatePath} must drop Linux capabilities`);
    assert.match(template, /resources:\s*\n\s*requests:/, `${templatePath} must include resource requests`);
    assert.match(template, /limits:/, `${templatePath} must include resource limits`);
    assert.match(template, /volumeMounts:\s*\n\s*- name: tmp\s*\n\s*mountPath: \/tmp/, `${templatePath} must provide writable tmp for read-only rootfs`);
  }
});

