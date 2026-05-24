import { apiAction, loadProjectConsole } from '../../../../../lib/api';
import { ConsoleShell, LogViewer, MetricCard, StatusBadge } from '../../../../../components/console-ui';

export default async function ProjectDetailPage({ params }: { params: { orgSlug: string; projectId: string } }) {
  const state = await loadProjectConsole(params.projectId);
  const projectName = state.project.name || state.project.slug || params.projectId;
  return (
    <ConsoleShell active="Projects" orgValue={params.orgSlug} projectValue={projectName} crumbs={`${params.orgSlug} / ${projectName} / Overview`} actions={<><a className="btn" href={`/org/${params.orgSlug}/projects/new`}>New service</a><button className="btn btn-primary" type="submit" form="deploy-first-service">Deploy</button></>}>
      <section className="page" data-od-id="project-overview">
        <header className="page-header">
          <div><p className="eyebrow">Project console</p><h1 className="page-title">{projectName}</h1><p className="page-subtitle">Service, deployment, resource, logs, DB console, GitHub, and preview data below are loaded from the control-plane API. Kubernetes 용어는 세부 이벤트에서만 노출합니다.</p></div>
          <StatusBadge status={state.project.status || 'Production healthy'} />
        </header>

        <div className="tabs"><button className="tab active">Overview</button><button className="tab">Services</button><button className="tab">Deployments</button><button className="tab">Resources</button><button className="tab">Domains</button><button className="tab">Env</button><button className="tab">Audit</button><button className="tab">Settings</button></div>

        <section className="grid grid-3">
          <MetricCard title="Services" value={state.services.length} detail="web, worker, cron, job" tone="ok" />
          <MetricCard title="Resources" value={state.resources.length} detail="managed catalog resources" />
          <MetricCard title="Deployments" value={state.deployments.length} detail={`${state.previewDeployments.length} previews`} tone="warn" />
        </section>

        <section className="grid grid-main" style={{ marginTop: 16 }}>
          <article className="stack">
            <section className="card">
              <div className="card-title"><h2>Create service</h2><span className="badge info">Dockerfile first</span></div>
              <form method="post" action={apiAction(`/projects/${params.projectId}/services`, state.context)} className="form-grid">
                <input name="name" placeholder="web" required />
                <select name="type" defaultValue="web"><option>web</option><option>private</option><option>worker</option><option>cron</option><option>job</option></select>
                <select name="sourceType" defaultValue="github"><option value="github">GitHub / git source</option><option value="image">Prebuilt image</option><option value="local">Local generated Dockerfile</option></select>
                <input name="repoUrl" placeholder="https://github.com/org/repo.git" />
                <input name="branch" placeholder="main" />
                <input name="imageUrl" placeholder="registry.example.com/team/web:tag for prebuilt image" />
                <input name="dockerfilePath" placeholder="Dockerfile (Dockerfile-first)" />
                <input name="buildContext" placeholder="." />
                <button type="submit">POST /projects/:id/services</button>
              </form>
            </section>

            <section className="card">
              <div className="card-title"><h2>Services and deploy buttons</h2><a className="btn btn-ghost" href="#deployments">Deployments</a></div>
              <table className="table"><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Source</th><th>Action</th></tr></thead><tbody>
                {state.services.map((service: any, index: number) => (
                  <tr key={service.id}><td><strong>{service.name || service.slug}</strong><p className="muted">{service.id}</p></td><td className="mono">{service.type || 'web'}</td><td><StatusBadge status={service.status || 'created'} /></td><td className="mono">{service.repoUrl || service.imageUrl || 'no source attached'}</td><td className="table-actions"><form id={index === 0 ? 'deploy-first-service' : undefined} method="post" action={apiAction(`/projects/${params.projectId}/services/${service.id}/deployments`, state.context)} className="inline-actions"><input type="hidden" name="deploymentType" value="production" /><button type="submit">Deploy production</button></form><form method="post" action={apiAction(`/projects/${params.projectId}/services/${service.id}/deployments`, state.context)} className="inline-actions" style={{ marginTop: 8 }}><input type="hidden" name="deploymentType" value="preview" /><button type="submit">Create preview</button></form></td></tr>
                ))}
              </tbody></table>
            </section>

            <section className="card" id="deployments">
              <div className="card-title"><h2>Deployments</h2><span className="badge info">Logs and events</span></div>
              {state.deployments.length ? <table className="table"><tbody>{state.deployments.map((deployment: any) => <tr key={deployment.id}><td>{deployment.serviceName}</td><td>{deployment.deploymentType}</td><td><StatusBadge status={deployment.status} /></td><td className="mono">{deployment.imageDigest || deployment.imageUrl || 'image pending'}</td><td>{deployment.errorCode || deployment.errorMessage || 'no error'}</td><td><a className="subtle-link" href={`/org/${params.orgSlug}/projects/${params.projectId}/deployments/${deployment.id}`}>deployment detail logs/events</a></td></tr>)}</tbody></table> : <p className="muted">No deployments yet.</p>}
              <h3 style={{ marginTop: 18 }}>Preview deployment list</h3>
              {state.previewDeployments.length ? <ul>{state.previewDeployments.map((deployment: any) => <li key={deployment.id}><a className="subtle-link" href={`/org/${params.orgSlug}/projects/${params.projectId}/deployments/${deployment.id}`}>{deployment.serviceName} PR #{deployment.pullRequestNumber || 'manual'} · {deployment.status}</a></li>)}</ul> : <p className="muted">No preview deployments returned.</p>}
            </section>
          </article>

          <aside className="stack">
            <section className="card">
              <div className="card-title"><h2>Create resource</h2><span className="badge ok">Catalog</span></div>
              <form method="post" action={apiAction(`/projects/${params.projectId}/resources`, state.context)} className="stack">
                <input name="name" placeholder="postgres" required />
                <select name="engine" defaultValue="postgresql"><option>postgresql</option><option>sqlite</option><option>redis</option><option>valkey</option><option>mysql</option><option>mariadb</option><option>mongodb</option><option>object-storage</option><option>qdrant</option><option>nats</option></select>
                <button type="submit">POST /projects/:id/resources</button>
              </form>
            </section>
            <section className="card">
              <div className="card-title"><h2>Resources and DB console</h2><span className="badge ok">Provider-owned</span></div>
              <p className="muted">Schema and browser data come from GET /resources/:id/console/schema and POST /resources/:id/console/browse; query actions post to /console/query. Attach/provision actions inject provider-owned env into services.</p>
              <div className="stack" style={{ marginTop: 12 }}>{state.resourceConsoles.map(({ resource, schema, browse }: any) => <article key={resource.id} className="card"><div className="card-title"><h2>{resource.name}</h2><StatusBadge status={resource.status || 'provisioning'} /></div><p className="mono muted">{resource.engine}</p><pre className="code-panel" style={{ padding: 12 }}>{JSON.stringify(schema?.schema || browse, null, 2)}</pre><a className="subtle-link" href={`/org/${params.orgSlug}/projects/${params.projectId}/resources/${resource.id}/console`}>Open DB/resource console</a></article>)}</div>
            </section>
            <section className="card danger-zone"><div className="card-title"><h2>Danger zone</h2><span className="badge danger">Audit required</span></div><p className="muted">프로젝트 삭제, production rollback, secret rotation은 확인 문구와 감사 로그가 필요합니다.</p></section>
          </aside>
        </section>

        <section className="grid grid-3" style={{ marginTop: 16 }}>
          <article className="card"><div className="card-title"><h2>Build logs</h2><span className="badge info">masked</span></div><LogViewer rows={state.buildLogs} field="line" /></article>
          <article className="card"><div className="card-title"><h2>Deployment events</h2><span className="badge info">timeline</span></div><LogViewer rows={state.deploymentEvents} field="message" /></article>
          <article className="card"><div className="card-title"><h2>Runtime logs</h2><span className="badge info">runtime</span></div><LogViewer rows={state.runtimeLogs} field="line" /></article>
        </section>
      </section>
    </ConsoleShell>
  );
}
