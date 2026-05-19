import http from 'node:http';
import { createApiHandler } from '../packages/core/src/api.ts';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';

const port = Number(process.env.PORT || 3000);
const controlPlane = new RAIBITSERVERControlPlane();
const server = http.createServer(createApiHandler(controlPlane));

server.listen(port, () => {
  console.log(`RAIBITSERVER control-plane API listening on http://localhost:${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
