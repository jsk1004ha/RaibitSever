import { RAIBITSERVERControlPlane } from './control-plane.ts';
import { maskSecrets } from './secrets.ts';

export function createApiHandler(controlPlane = new RAIBITSERVERControlPlane()) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      const method = req.method || 'GET';

      if (method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok', service: 'raibitserver-control-plane' });
      }
      if (method === 'GET' && url.pathname === '/catalog') {
        return send(res, 200, { resources: controlPlane.catalog() });
      }
      if (method === 'GET' && url.pathname === '/snapshot') {
        return send(res, 200, maskSecrets(controlPlane.store.snapshot()));
      }
      if (method === 'POST' && url.pathname === '/plan/build') {
        const body = await readJson(req);
        return send(res, 200, controlPlane.planBuild(body.service || body, body.files || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/compose') {
        const body = await readJson(req);
        return send(res, 200, controlPlane.importCompose(body.compose || body.text || '', body.options || {}));
      }
      if (method === 'POST' && url.pathname === '/plan/manifests') {
        const body = await readJson(req);
        return send(res, 200, controlPlane.compileManifests(projectSpecFromBody(body), body.filesByService || {}));
      }
      if (method === 'POST' && url.pathname === '/validate') {
        const body = await readJson(req);
        return send(res, 200, controlPlane.validateProject(projectSpecFromBody(body)));
      }
      if (method === 'POST' && url.pathname === '/guard/query') {
        const body = await readJson(req);
        return send(res, 200, controlPlane.guardQuery(body.query, body.options || {}));
      }
      if (method === 'POST' && url.pathname === '/organizations') {
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createOrganization(body));
      }
      if (method === 'POST' && url.pathname === '/projects') {
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createProject(body));
      }
      if (method === 'POST' && url.pathname === '/services') {
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createService(body));
      }
      if (method === 'POST' && url.pathname === '/resources') {
        const body = await readJson(req);
        return send(res, 201, controlPlane.store.createResource(body));
      }

      return send(res, 404, { error: 'not_found', path: url.pathname });
    } catch (error) {
      return send(res, error.statusCode || 500, { error: error.message || 'internal_error' });
    }
  };
}

function projectSpecFromBody(body) {
  if (body.projectSpec) return body.projectSpec;
  if (body.services || body.resources || body.organization) return body;
  return body.project || body;
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function send(res, statusCode, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
