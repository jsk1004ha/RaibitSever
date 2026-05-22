export const E2E_MODES = Object.freeze({
  DRY: 'dry',
  LIVE: 'live',
  AUTO: 'auto',
});

const VALID_MODES = new Set(Object.values(E2E_MODES));
const LIVE_TOOL_GROUPS = Object.freeze([
  ['docker'],
  ['kubectl'],
  ['kind', 'k3d'],
]);

export function parseE2EOptions(args = [], env = process.env) {
  let requestedMode = env.RAIBITSERVER_E2E_MODE || E2E_MODES.DRY;
  let execute = env.RAIBITSERVER_EXECUTE === '1';

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run' || arg === '--dry') {
      requestedMode = E2E_MODES.DRY;
      execute = false;
    } else if (arg === '--live') {
      requestedMode = E2E_MODES.LIVE;
    } else if (arg === '--execute') {
      execute = true;
    } else if (arg === '--mode') {
      if (!args[i + 1]) throw new Error('--mode requires dry, live, or auto');
      requestedMode = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--mode=')) {
      requestedMode = arg.slice('--mode='.length);
    } else {
      throw new Error(`unknown e2e option: ${arg}`);
    }
  }

  return { requestedMode: normalizeE2EMode(requestedMode), execute };
}

export function normalizeE2EMode(value) {
  const mode = String(value || E2E_MODES.DRY).toLowerCase();
  if (!VALID_MODES.has(mode)) throw new Error(`invalid e2e mode: ${value}; expected dry, live, or auto`);
  return mode;
}

export function hasLiveE2ETools(tools = {}) {
  return LIVE_TOOL_GROUPS.every((group) => group.some((tool) => tools[tool] === true));
}

export function missingLiveE2EToolGroups(tools = {}) {
  return LIVE_TOOL_GROUPS
    .filter((group) => !group.some((tool) => tools[tool] === true))
    .map((group) => group.join('|'));
}

export function resolveE2EPlan({ requestedMode = E2E_MODES.DRY, execute = false, tools = {} } = {}) {
  const normalized = normalizeE2EMode(requestedMode);
  const liveToolsReady = hasLiveE2ETools(tools);
  const missingTools = missingLiveE2EToolGroups(tools);

  if (normalized === E2E_MODES.LIVE) {
    if (!execute) throw new Error('live E2E requires --execute or RAIBITSERVER_EXECUTE=1 to make side effects explicit');
    if (!liveToolsReady) throw new Error(`live E2E requires local tools: ${missingTools.join(', ')}`);
    return {
      requestedMode: normalized,
      mode: E2E_MODES.LIVE,
      label: 'live-container-execute',
      dryRun: false,
      execute: true,
      liveToolsReady,
      missingTools,
    };
  }

  if (normalized === E2E_MODES.AUTO && execute && liveToolsReady) {
    return {
      requestedMode: normalized,
      mode: E2E_MODES.LIVE,
      label: 'live-container-execute',
      dryRun: false,
      execute: true,
      liveToolsReady,
      missingTools,
    };
  }

  return {
    requestedMode: normalized,
    mode: E2E_MODES.DRY,
    label: liveToolsReady ? 'dry-run-container-ready' : 'deterministic-dry-run',
    dryRun: true,
    execute: false,
    liveToolsReady,
    missingTools,
  };
}
