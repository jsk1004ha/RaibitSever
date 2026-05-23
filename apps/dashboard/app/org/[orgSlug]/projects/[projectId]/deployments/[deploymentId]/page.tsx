import { apiAction, getJson, dashboardApiContext } from '../../../../../../../lib/api';

export default async function DeploymentDetailPage({ params }: { params: { orgSlug: string; projectId: string; deploymentId: string } }) {
  const context = dashboardApiContext();
  const [deployment, logs, events] = await Promise.all([
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}`, { id: params.deploymentId, status: 'unknown' }, context),
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}/logs`, { logs: [] }, context),
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}/events`, { events: [] }, context),
  ]);
  const detail = deployment.body || {};
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Deployment detail</p>
        <h1>{params.deploymentId}</h1>
        <a href={`/org/${params.orgSlug}/projects/${params.projectId}`}>← Project console</a>
      </header>
      <section style={cardStyle}>
        <h2>Status, image, digest, preview, and failure fields</h2>
        <dl style={metaGridStyle}>
          <div><dt>Status</dt><dd>{detail.status || 'unknown'}</dd></div>
          <div><dt>Type</dt><dd>{detail.deploymentType || 'production'}</dd></div>
          <div><dt>Image URL</dt><dd>{detail.imageUrl || 'pending'}</dd></div>
          <div><dt>Image digest</dt><dd>{detail.imageDigest || 'pending'}</dd></div>
          <div><dt>Preview URL</dt><dd>{detail.previewUrl || 'not a preview'}</dd></div>
          <div><dt>Error</dt><dd>{detail.errorCode || detail.errorMessage || 'none'}</dd></div>
        </dl>
        <div style={formGridStyle}>
          <form method="post" action={apiAction(`/deployments/${params.deploymentId}/status`, context)} style={inlineFormStyle}>
            <select name="status" defaultValue="BUILDING"><option>BUILDING</option><option>IMAGE_READY</option><option>DEPLOYING</option><option>READY</option><option>FAILED</option></select>
            <input name="imageUrl" placeholder="image URL when IMAGE_READY" />
            <input name="imageDigest" placeholder="sha256:..." />
            <input name="errorMessage" placeholder="failure message" />
            <button type="submit">Update deployment status</button>
          </form>
          <form method="post" action={apiAction(`/deployments/${params.deploymentId}/cancel`, context)} style={inlineFormStyle}>
            <input name="reason" placeholder="cancel reason" />
            <button type="submit">Cancel deployment</button>
          </form>
          <form method="post" action={apiAction(`/deployments/${params.deploymentId}/rollback`, context)} style={inlineFormStyle}>
            <input name="imageUrl" placeholder="optional previous READY image override" />
            <button type="submit">Rollback deployment</button>
          </form>
        </div>
      </section>
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
const metaGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 } as const;
const formGridStyle = { display: 'grid', gap: 12, marginTop: 16 } as const;
const inlineFormStyle = { display: 'flex', gap: 8, flexWrap: 'wrap' } as const;
const preStyle = { whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0f172a', color: '#dbeafe', padding: 12, borderRadius: 10, minHeight: 260 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
