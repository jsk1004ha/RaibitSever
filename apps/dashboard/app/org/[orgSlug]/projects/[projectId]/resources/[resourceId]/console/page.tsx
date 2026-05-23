import { apiAction, loadResourceConsole } from '../../../../../../../../lib/api';
import { JsonCard } from '../../../../../../../../components/console-ui';

const ENGINE_COMMANDS: Record<string, { query: string; command: string; help: string }> = {
  postgresql: { query: 'SELECT 1', command: 'SELECT 1', help: 'SQL query, schema/table browser, backup/restore command contract' },
  sqlite: { query: 'SELECT 1', command: 'PRAGMA table_info(health)', help: 'SQLite CREATE/INSERT/SELECT and table browser against provider-owned file' },
  mysql: { query: 'SELECT 1', command: 'SHOW TABLES', help: 'MySQL SELECT/SHOW and mysqldump command contract' },
  mariadb: { query: 'SELECT 1', command: 'SHOW TABLES', help: 'MariaDB-compatible SQL console contract' },
  mongodb: { query: 'db.health.find({})', command: 'db.getCollectionNames()', help: 'Mongo collection and document browser contract' },
  redis: { query: 'SCAN 0 MATCH * COUNT 100', command: 'GET health:ready', help: 'Redis key/value/TTL browser contract' },
  valkey: { query: 'SCAN 0 MATCH * COUNT 100', command: 'TTL health:ready', help: 'Valkey key/value/TTL browser contract' },
  'object-storage': { query: 'LIST objects', command: 'mc ls', help: 'Bucket/object list plus upload/download/delete command contract' },
  qdrant: { query: 'GET /collections', command: 'search health', help: 'Qdrant collection browser and search smoke contract' },
  nats: { query: 'subjects', command: 'nats stream ls', help: 'NATS subject/stream connection info contract' },
};

export default async function ResourceConsolePage({ params }: { params: { orgSlug: string; projectId: string; resourceId: string } }) {
  const state = await loadResourceConsole(params.resourceId);
  const resource = state.resource || { id: params.resourceId, engine: 'resource' };
  const engine = String(resource.engine || '').toLowerCase();
  const defaults = ENGINE_COMMANDS[engine] || { query: 'SELECT 1', command: 'browse', help: 'Provider-owned console adapter contract' };
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Online DB / Resource manager</p>
        <h1>{resource.name || params.resourceId}</h1>
        <p>{engine} · {resource.status || 'provisioning'} · provider {resource.provider || 'managed'}</p>
        <p>{defaults.help}</p>
        <a href={`/org/${params.orgSlug}/projects/${params.projectId}`}>← Project console</a>
      </header>

      <section style={gridStyle}>
        <form method="post" action={apiAction(`/resources/${params.resourceId}/console/query`, state.context)} style={cardStyle}>
          <h2>Query / find / browse</h2>
          <textarea name="query" defaultValue={defaults.query} rows={5} />
          <label><input type="checkbox" name="confirmed" value="true" /> Confirm destructive command</label>
          <button type="submit">Run /console/query</button>
        </form>
        <form method="post" action={apiAction(`/resources/${params.resourceId}/console/command`, state.context)} style={cardStyle}>
          <h2>Provider command</h2>
          <input name="command" defaultValue={defaults.command} />
          <label><input type="checkbox" name="confirmed" value="true" /> Confirm mutation/delete</label>
          <button type="submit">Run /console/command</button>
        </form>
        <form method="post" action={apiAction(`/resources/${params.resourceId}/provision`, state.context)} style={cardStyle}>
          <h2>Provision / reconcile</h2>
          <input type="hidden" name="dryRun" value="true" />
          <button type="submit">Create provider plan + secret</button>
        </form>
        <form method="post" action={apiAction(`/resources/${params.resourceId}/attach`, state.context)} style={cardStyle}>
          <h2>Attach to service</h2>
          <input name="serviceId" placeholder="service id" required />
          <input name="envPrefix" placeholder="optional ENV_PREFIX" />
          <button type="submit">Inject env into service</button>
        </form>
      </section>

      <section style={gridStyle}>
        <JsonCard title="Masked connection info" value={state.schema?.connectionInfo || state.browse?.connectionInfo || { mode: 'provider-owned-secret' }} />
        <JsonCard title="Schema" value={state.schema} />
        {/* GET /console/tables /console/keys /console/collections */}
        <JsonCard title="Tables" value={state.tables} />
        <JsonCard title="Collections" value={state.collections} />
        <JsonCard title="Keys / TTL" value={state.keys} />
        <JsonCard title="Buckets / Objects / Subjects" value={state.browse} />
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 10 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
