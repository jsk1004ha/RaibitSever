import { apiAction, loadResourceConsole } from '../../../../../../../../lib/api';
import { ConsoleShell, JsonCard, MetricCard, StatusBadge } from '../../../../../../../../components/console-ui';

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
    <ConsoleShell active="Projects" orgValue={params.orgSlug} projectValue={params.projectId} crumbs={`${params.projectId} / Resources / ${resource.name || params.resourceId}`} actions={<><a className="btn" href={`/org/${params.orgSlug}/projects/${params.projectId}`}>Project</a><button className="btn btn-danger" type="submit" form="provider-command">Credential rotation</button></>}>
      <section className="page" data-od-id="resource-console">
        <header className="page-header"><div><p className="eyebrow">Online DB / Resource manager</p><h1 className="page-title">{resource.name || params.resourceId}</h1><p className="page-subtitle">{defaults.help}. DB console은 provider-owned secret만 사용합니다. 사용자가 connection URL을 입력해도 실행 경로에는 반영하지 않습니다.</p></div><StatusBadge status={resource.status || 'provisioning'} /></header>
        <section className="grid grid-3">
          <MetricCard title="Engine" value={engine || 'resource'} detail={`provider ${resource.provider || 'managed'}`} />
          <MetricCard title="Attached services" value={(resource.attachedServices || []).length || 0} detail="masked env injection" tone="ok" />
          <article className="card"><p className="label">Connection</p><h2 className="mono">{state.schema?.connectionInfo?.databaseUrl || state.browse?.connectionInfo?.databaseUrl || 'provider-owned-secret'}</h2><p className="muted">Secret values are masked</p></article>
        </section>
        <section className="grid grid-main" style={{ marginTop: 16 }}>
          <article className="card">
            <div className="tabs"><button className="tab active">Schema</button><button className="tab">Query</button><button className="tab">Backups</button><button className="tab">Attach</button></div>
            <form method="post" action={apiAction(`/resources/${params.resourceId}/console/query`, state.context)} className="stack">
              <label className="field"><span className="label">Query / find / browse</span><textarea name="query" defaultValue={defaults.query} rows={5} className="textarea mono" /></label>
              <label><span><input type="checkbox" name="confirmed" value="true" /> Confirm destructive command</span></label>
              <button type="submit">Run /console/query</button>
            </form>
            {/* GET /console/tables /console/keys /console/collections */}
          </article>
          <aside className="stack">
            <form id="provider-command" method="post" action={apiAction(`/resources/${params.resourceId}/console/command`, state.context)} className="card danger-zone">
              <h2>Provider command</h2><input name="command" defaultValue={defaults.command} /><label><span><input type="checkbox" name="confirmed" value="true" /> Confirm mutation/delete</span></label><button type="submit">Run /console/command</button>
            </form>
            <form method="post" action={apiAction(`/resources/${params.resourceId}/provision`, state.context)} className="card"><h2>Provision / reconcile</h2><input type="hidden" name="dryRun" value="true" /><button type="submit">Create provider plan + secret</button></form>
            <form method="post" action={apiAction(`/resources/${params.resourceId}/attach`, state.context)} className="card"><h2>Attach to service</h2><input name="serviceId" placeholder="service id" required /><input name="envPrefix" placeholder="optional ENV_PREFIX" /><button type="submit">Inject env into service</button></form>
          </aside>
        </section>
        <section className="grid grid-3" style={{ marginTop: 16 }}>
          <JsonCard title="Masked connection info" value={state.schema?.connectionInfo || state.browse?.connectionInfo || { mode: 'provider-owned-secret' }} />
          <JsonCard title="Schema" value={state.schema} />
          <JsonCard title="Tables" value={state.tables} />
          <JsonCard title="Collections" value={state.collections} />
          <JsonCard title="Keys / TTL" value={state.keys} />
          <JsonCard title="Buckets / Objects / Subjects" value={state.browse} />
        </section>
      </section>
    </ConsoleShell>
  );
}
