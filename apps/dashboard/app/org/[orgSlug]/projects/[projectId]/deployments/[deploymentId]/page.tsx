import { apiAction, getJson, dashboardApiContext } from '../../../../../../../lib/api';
import { ConsoleShell, LogViewer, MetricCard, StatusBadge } from '../../../../../../../components/console-ui';

export default async function DeploymentDetailPage({ params }: { params: { orgSlug: string; projectId: string; deploymentId: string } }) {
  const context = dashboardApiContext();
  const [deployment, logs, events] = await Promise.all([
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}`, { id: params.deploymentId, status: 'unknown' }, context),
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}/logs`, { logs: [] }, context),
    getJson(`/deployments/${encodeURIComponent(params.deploymentId)}/events`, { events: [] }, context),
  ]);
  const detail = deployment.body || {};
  return (
    <ConsoleShell active="Projects" orgValue={params.orgSlug} projectValue={params.projectId} crumbs={`${params.projectId} / ${params.deploymentId}`} actions={<><a className="btn" href={`/org/${params.orgSlug}/projects/${params.projectId}`}>Project console</a><button className="btn btn-danger" type="submit" form="rollback-deployment">Rollback</button></>}>
      <section className="page" data-od-id="deployment-detail">
        <header className="page-header">
          <div><p className="eyebrow">Deployment detail</p><h1 className="page-title">Production deployment</h1><p className="page-subtitle">실패 원인을 로그와 이벤트 타임라인에서 읽고, 위험 액션은 결과를 명확히 설명한 뒤 실행합니다.</p></div>
          <StatusBadge status={detail.status || 'unknown'} />
        </header>
        <section className="grid grid-3">
          <MetricCard title="Type" value={detail.deploymentType || 'production'} detail="production/manual/preview" />
          <MetricCard title="Image" value={detail.imageDigest || detail.imageUrl || 'pending'} detail="registry image or digest" tone="ok" />
          <MetricCard title="Error" value={detail.errorCode || detail.errorMessage || 'none'} detail="sanitized failure fields" tone={detail.errorCode || detail.errorMessage ? 'danger' : 'ok'} />
        </section>
        <section className="grid grid-main" style={{ marginTop: 16 }}>
          <article className="stack">
            <section className="card">
              <div className="card-title"><h2>Status, image, digest, preview, and failure fields</h2><span className="badge info">Desired state</span></div>
              <dl className="grid grid-3"><div><dt>Status</dt><dd>{detail.status || 'unknown'}</dd></div><div><dt>Type</dt><dd>{detail.deploymentType || 'production'}</dd></div><div><dt>Image URL</dt><dd>{detail.imageUrl || 'pending'}</dd></div><div><dt>Image digest</dt><dd>{detail.imageDigest || 'pending'}</dd></div><div><dt>Preview URL</dt><dd>{detail.previewUrl || 'not a preview'}</dd></div><div><dt>Error</dt><dd>{detail.errorCode || detail.errorMessage || 'none'}</dd></div></dl>
              <form method="post" action={apiAction(`/deployments/${params.deploymentId}/status`, context)} className="form-grid" style={{ marginTop: 16 }}>
                <select name="status" defaultValue="BUILDING"><option>BUILDING</option><option>IMAGE_READY</option><option>DEPLOYING</option><option>READY</option><option>FAILED</option></select>
                <input name="imageUrl" placeholder="image URL when IMAGE_READY" />
                <input name="imageDigest" placeholder="sha256:..." />
                <input name="errorMessage" placeholder="failure message" />
                <button type="submit">Update deployment status</button>
              </form>
            </section>
            <section className="card"><div className="card-title"><h2>Build log viewer</h2><div className="toolbar"><button className="btn" type="button">Copy</button><button className="btn" type="button">Download</button></div></div><LogViewer rows={logs.body?.logs || []} field="line" empty="No build logs returned." /></section>
          </article>
          <aside className="stack">
            <section className="card"><div className="card-title"><h2>Deployment events</h2><span className="badge info">Live</span></div><LogViewer rows={events.body?.events || []} field="message" empty="No deployment events returned." /></section>
            <section className="card danger-zone"><h2>Rollback confirmation</h2><p className="muted" style={{ marginTop: 8 }}>이전 READY image로 되돌립니다. 연결된 DB는 변경하지 않지만 새 배포 이벤트와 audit log가 기록됩니다.</p><form id="rollback-deployment" method="post" action={apiAction(`/deployments/${params.deploymentId}/rollback`, context)} className="stack" style={{ marginTop: 12 }}><input name="imageUrl" placeholder="optional previous READY image override" /><button type="submit">Rollback deployment</button></form></section>
            <section className="card"><h2>Cancel deployment</h2><form method="post" action={apiAction(`/deployments/${params.deploymentId}/cancel`, context)} className="stack" style={{ marginTop: 12 }}><input name="reason" placeholder="cancel reason" /><button type="submit">Cancel deployment</button></form></section>
          </aside>
        </section>
      </section>
    </ConsoleShell>
  );
}
