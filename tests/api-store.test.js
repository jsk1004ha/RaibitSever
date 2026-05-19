import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApiHandler } from '../packages/core/src/api.ts';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';

test('HTTP API serves health, catalog, and manifest planning', async () => {
  const server = http.createServer(createApiHandler(new RAIBITSERVERControlPlane()));
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  try {
    const health = await request(port, 'GET', '/health');
    assert.equal(health.status, 'ok');

    const catalog = await request(port, 'GET', '/catalog');
    assert.equal(catalog.resources.some((resource) => resource.key === 'postgresql'), true);

    const org = await request(port, 'POST', '/organizations', { name: 'GDG Seoul', plan: 'club' });
    assert.equal(org.slug, 'gdg-seoul');

    const manifest = await request(port, 'POST', '/plan/manifests', {
      organization: { slug: 'gdg-seoul', plan: 'club' },
      project: { name: 'demo' },
      services: [{ name: 'web', type: 'web', sourceType: 'image', image: 'ghcr.io/demo/web:1', port: 3000 }],
      resources: [],
    });
    assert.equal(manifest.manifests.some((m) => m.kind === 'Ingress'), true);
  } finally {
    server.close();
  }
});

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ port, path, method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
