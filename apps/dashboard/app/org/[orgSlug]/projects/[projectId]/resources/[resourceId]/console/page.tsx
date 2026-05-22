import { apiAction, dashboardApiContext, getJson, postJson } from '../../../../../../../../lib/api';

export default async function ResourceConsolePage({ params }: { params: { orgSlug: string; projectId: string; resourceId: string } }) {
  const context = dashboardApiContext();
  const [schema, tables, collections, keys, browse] = await Promise.all([
    getJson(`/resources/${encodeURIComponent(params.resourceId)}/console/schema`, { schema: {} }, context),
    getJson(`/resources/${encodeURIComponent(params.resourceId)}/console/tables`, { tables: [] }, context),
    getJson(`/resources/${encodeURIComponent(params.resourceId)}/console/collections`, { collections: [] }, context),
    getJson(`/resources/${encodeURIComponent(params.resourceId)}/console/keys`, { keys: [] }, context),
    postJson(`/resources/${encodeURIComponent(params.resourceId)}/console/browse`, {}, {}, context),
  ]);
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Resource console</p>
        <h1>{params.resourceId}</h1>
        <a href={`/org/${params.orgSlug}/projects/${params.projectId}`}>← Project console</a>
      </header>
      <section style={gridStyle}>
        <form method="post" action={apiAction(`/resources/${params.resourceId}/console/query`, context)} style={cardStyle}>
          <h2>DB query</h2>
          <textarea name="query" defaultValue="SELECT 1" rows={5} />
          <button type="submit">POST /console/query</button>
        </form>
        <form method="post" action={apiAction(`/resources/${params.resourceId}/console/command`, context)} style={cardStyle}>
          <h2>Provider command</h2>
          <input name="command" defaultValue="SCAN 0 MATCH * COUNT 100" />
          <button type="submit">POST /console/command</button>
        </form>
      </section>
      <section style={gridStyle}>
        <JsonCard title="Schema" value={schema.body} />
        <JsonCard title="Tables" value={tables.body} />
        <JsonCard title="Collections" value={collections.body} />
        <JsonCard title="Keys" value={keys.body} />
        <JsonCard title="Browse" value={browse.body} />
      </section>
    </main>
  );
}

function JsonCard({ title, value }: { title: string; value: any }) { return <article style={cardStyle}><h2>{title}</h2><pre style={preStyle}>{JSON.stringify(value, null, 2)}</pre></article>; }
const pageStyle = { padding: 32, maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 10 } as const;
const preStyle = { whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0f172a', color: '#dbeafe', padding: 12, borderRadius: 10 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
