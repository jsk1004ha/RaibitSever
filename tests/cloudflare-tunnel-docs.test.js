import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import YAML from 'yaml';

const repo = new URL('..', import.meta.url);

test('Cloudflare Tunnel docs lock RAIBITSERVER wildcard and security guardrails', async () => {
  const doc = await fs.readFile(new URL('docs/cloudflare-tunnel.md', repo), 'utf8');

  for (const required of [
    '*.apps.<BASE_DOMAIN>',
    '*.preview.<BASE_DOMAIN>',
    '*.console.<BASE_DOMAIN>',
    '*.resources.<BASE_DOMAIN>',
    '내부 Kubernetes Ingress Controller',
    'Cloudflare Access',
    'RAIBITSERVER_DASHBOARD_BASIC_AUTH',
    '/api/*/stream',
    '/github/webhooks',
    'DB 포트를 일반 사용자용 public tunnel로 열지 않습니다',
    'origin port가 인터넷에 열려 있으면',
  ]) {
    assert.match(doc, new RegExp(escapeRegExp(required)));
  }

  assert.doesNotMatch(doc, /test\.\*\.example\.com.*권장/);
});

test('Cloudflare Tunnel example routes wildcard zones to one ingress controller', async () => {
  const example = await fs.readFile(new URL('deploy/production/cloudflare-tunnel.example.yml', repo), 'utf8');
  const config = YAML.parse(example.replaceAll('<TUNNEL_UUID>', '00000000-0000-0000-0000-000000000000'));
  const rules = config.ingress;

  assert.ok(Array.isArray(rules));
  assert.deepEqual(
    rules.filter((rule) => rule.hostname).map((rule) => rule.hostname),
    [
      'api.raibitserver.app',
      'admin.raibitserver.app',
      'console.raibitserver.app',
      '*.apps.raibitserver.app',
      '*.preview.raibitserver.app',
      '*.console.raibitserver.app',
      '*.resources.raibitserver.app',
    ],
  );

  const originServices = new Set(rules.filter((rule) => rule.hostname).map((rule) => rule.service));
  assert.deepEqual([...originServices], ['http://ingress-nginx-controller.ingress-nginx.svc.cluster.local:80']);
  assert.equal(rules.at(-1).service, 'http_status:404');
  assert.equal(rules.some((rule) => /\.\*\./.test(String(rule.hostname || ''))), false);
  assert.equal(rules.some((rule) => String(rule.service || '').startsWith('tcp://')), false);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
