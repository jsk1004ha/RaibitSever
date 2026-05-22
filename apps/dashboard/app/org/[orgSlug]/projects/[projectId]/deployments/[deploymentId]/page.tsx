import { getJson, dashboardApiContext } from '../../../../../../../lib/api';

export default async function DeploymentDetailPage({ params }: { params: { orgSlug: string; projectId: string; deploymentId: string } }) {
  const context = dashboardApiContext();
  const [logs, events] = await Promise.all([
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}/logs`, { logs: [] }, context),
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}/events`, { events: [] }, context),
  ]);
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Deployment detail</p>
        <h1>{params.deploymentId}</h1>
        <a href={`/org/${params.orgSlug}/projects/${params.projectId}`}>← Project console</a>
      </header>
      <section style={gridStyle}>
        <article style={cardStyle}><h2>Build log viewer</h2><pre style={preStyle}>{(logs.body?.logs || []).map((row: any) => `[${row.level || 'info'}] ${row.step || 'build'} ${row.line}`).join('\n') || 'No build logs returned.'}</pre></article>
        <article style={cardStyle}><h2>Deployment events</h2><pre style={preStyle}>{(events.body?.events || []).map((row: any) => `${row.type}: ${row.message}`).join('\n') || 'No deployment events returned.'}</pre></article>
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff' } as const;
const preStyle = { whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0f172a', color: '#dbeafe', padding: 12, borderRadius: 10, minHeight: 260 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
