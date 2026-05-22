import { apiAction, loadProjectConsole } from '../../../../../lib/api';

export default async function ProjectDetailPage({ params }: { params: { orgSlug: string; projectId: string } }) {
  const state = await loadProjectConsole(params.projectId);
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Project console</p>
        <h1>{state.project.name || state.project.slug || params.projectId}</h1>
        <p>Service, deployment, resource, logs, DB console, GitHub, and preview data below are loaded from the control-plane API.</p>
      </header>

      <section style={gridStyle}>
        <Metric title="Services" value={state.services.length} />
        <Metric title="Resources" value={state.resources.length} />
        <Metric title="Deployments" value={state.deployments.length} />
        <Metric title="Previews" value={state.previewDeployments.length} />
      </section>

      <section style={gridStyle}>
        <form method="post" action={apiAction(`/projects/${params.projectId}/services`, state.context)} style={cardStyle}>
          <h2>Create service</h2>
          <input name="name" placeholder="web" required />
          <select name="type" defaultValue="web"><option>web</option><option>private</option><option>worker</option><option>cron</option><option>job</option></select>
          <input name="repoUrl" placeholder="https://github.com/org/repo.git" />
          <button type="submit">POST /projects/:id/services</button>
        </form>
        <form method="post" action={apiAction(`/projects/${params.projectId}/resources`, state.context)} style={cardStyle}>
          <h2>Create resource</h2>
          <input name="name" placeholder="postgres" required />
          <select name="engine" defaultValue="postgresql"><option>postgresql</option><option>redis</option><option>mysql</option><option>mongodb</option><option>object-storage</option><option>qdrant</option><option>nats</option></select>
          <button type="submit">POST /projects/:id/resources</button>
        </form>
      </section>

      <section style={cardStyle}>
        <h2>Services and deploy buttons</h2>
        <div style={gridStyle}>
          {state.services.map((service: any) => (
            <article key={service.id} style={miniCardStyle}>
              <h3>{service.name || service.slug}</h3>
              <p>{service.type || 'web'} · {service.status || 'created'} · {service.repoUrl || service.imageUrl || 'no source attached'}</p>
              <form method="post" action={apiAction(`/projects/${params.projectId}/services/${service.id}/deployments`, state.context)}>
                <input type="hidden" name="deploymentType" value="production" />
                <button type="submit">Deploy production</button>
              </form>
              <form method="post" action={apiAction(`/projects/${params.projectId}/services/${service.id}/deployments`, state.context)}>
                <input type="hidden" name="deploymentType" value="preview" />
                <button type="submit">Create preview</button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <h2>Deployments</h2>
        {state.deployments.length ? <table style={tableStyle}><tbody>{state.deployments.map((deployment: any) => <tr key={deployment.id}><td>{deployment.serviceName}</td><td>{deployment.deploymentType}</td><td>{deployment.status}</td><td><a href={`/org/${params.orgSlug}/projects/${params.projectId}/deployments/${deployment.id}`}>logs/events</a></td></tr>)}</tbody></table> : <p>No deployments yet.</p>}
      </section>

      <section style={cardStyle}>
        <h2>Resources and DB console</h2>
        <p>Schema and browser data come from GET /resources/:id/console/schema and POST /resources/:id/console/browse; query actions post to /console/query.</p>
        <div style={gridStyle}>
          {state.resourceConsoles.map(({ resource, schema, browse }: any) => (
            <article key={resource.id} style={miniCardStyle}>
              <h3>{resource.name}</h3>
              <p>{resource.engine} · {resource.status || 'provisioning'}</p>
              <pre style={preStyle}>{JSON.stringify(schema?.schema || browse, null, 2)}</pre>
              <a href={`/org/${params.orgSlug}/projects/${params.projectId}/resources/${resource.id}/console`}>Open DB/resource console</a>
            </article>
          ))}
        </div>
      </section>

      <section style={gridStyle}>
        <LogPanel title="Build logs" rows={state.buildLogs} field="line" />
        <LogPanel title="Deployment events" rows={state.deploymentEvents} field="message" />
        <LogPanel title="Runtime logs" rows={state.runtimeLogs} field="line" />
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: number }) { return <article style={cardStyle}><h2>{title}</h2><strong style={{ fontSize: 30 }}>{value}</strong></article>; }
function LogPanel({ title, rows, field }: { title: string; rows: any[]; field: string }) { return <article style={cardStyle}><h2>{title}</h2>{rows.length ? <pre style={preStyle}>{rows.map((row) => row[field]).join('\n')}</pre> : <p>No rows returned.</p>}</article>; }
const pageStyle = { padding: 32, maxWidth: 1240, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' } as const;
const miniCardStyle = { border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#f8fafc', display: 'grid', gap: 8 } as const;
const tableStyle = { width: '100%', borderCollapse: 'collapse' } as const;
const preStyle = { whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0f172a', color: '#dbeafe', padding: 12, borderRadius: 10 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
