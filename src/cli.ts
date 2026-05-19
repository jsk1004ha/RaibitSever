#!/usr/bin/env node
import fs from 'node:fs/promises';
import { RAIBITSERVERControlPlane } from '../packages/core/src/control-plane.ts';
import { maskSecrets } from '../packages/core/src/secrets.ts';

const controlPlane = new RAIBITSERVERControlPlane();

async function main(argv: string[]) {
  const [command, file, ...rest] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) return help();

  if (command === 'catalog') {
    return print({ resources: controlPlane.catalog() });
  }
  if (command === 'build') {
    const payload = await readJsonFile(file);
    if (payload.services) {
      const projectSlug = payload.project?.slug || payload.slug || payload.project?.name || 'project';
      return print({
        buildPlans: payload.services.map((service: Record<string, unknown>) => controlPlane.planBuild(
          { projectSlug, registry: payload.registry, ...service },
          payload.filesByService?.[String(service.name)] || {},
        )),
      });
    }
    return print(controlPlane.planBuild(payload.service || payload, payload.files || {}));
  }
  if (command === 'manifest') {
    const payload = await readJsonFile(file);
    return print(controlPlane.compileManifests(projectSpecFromPayload(payload), payload.filesByService || {}));
  }
  if (command === 'validate') {
    const payload = await readJsonFile(file);
    return print(controlPlane.validateProject(projectSpecFromPayload(payload)));
  }
  if (command === 'compose') {
    const text = await fs.readFile(file, 'utf8');
    return print(controlPlane.importCompose(text, { projectName: rest[0] || 'compose-import' }));
  }
  if (command === 'guard-query') {
    const query = rest.length ? [file, ...rest].join(' ') : await fs.readFile(file, 'utf8');
    return print(controlPlane.guardQuery(query, { role: process.env.RAIBITSERVER_ROLE || 'developer', confirmed: process.env.RAIBITSERVER_CONFIRMED === '1' }));
  }

  throw new Error(`unknown command: ${command}`);
}

async function readJsonFile(path: string | undefined) {
  if (!path) throw new Error('JSON file path is required');
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(maskSecrets(value), null, 2)}\n`);
}

function projectSpecFromPayload(payload: Record<string, any>) {
  if (payload.projectSpec) return payload.projectSpec;
  if (payload.services || payload.resources || payload.organization) return payload;
  return payload.project || payload;
}

function help() {
  process.stdout.write(`RAIBITSERVER CLI\n\nUsage:\n  node src/cli.js catalog\n  node src/cli.js build <service-or-project.json>\n  node src/cli.js manifest <project.json>\n  node src/cli.js validate <project.json>\n  node src/cli.js compose <docker-compose.yml> [project-name]\n  node src/cli.js guard-query <SQL text>\n\n`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
