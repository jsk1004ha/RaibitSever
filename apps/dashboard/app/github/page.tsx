import { apiAction, loadGitHubConsole } from '../../lib/api';

export default async function GitHubPage() {
  const state = await loadGitHubConsole();
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>GitHub App</p>
        <h1>Repository import and preview deployments</h1>
        <p>Installations, stored integrations, repo import, repository sync, and webhook contracts are API-backed.</p>
      </header>
      <section style={gridStyle}>
        <form method="post" action={apiAction('/integrations/github', state.context)} style={cardStyle}>
          <h2>Connect integration</h2>
          <input name="organizationId" placeholder="org id" />
          <input name="accountLogin" placeholder="github org/user" />
          <input name="installationId" placeholder="installation id" />
          <input name="token" placeholder="optional token" />
          <button type="submit">POST /integrations/github</button>
        </form>
        <form method="post" action={apiAction('/github/repositories/import', state.context)} style={cardStyle}>
          <h2>Import repository</h2>
          <input name="projectId" placeholder="project id" defaultValue={state.projects[0]?.id || ''} />
          <input name="integrationId" placeholder="integration id" defaultValue={state.integrations[0]?.id || ''} />
          <input name="repository" placeholder="owner/repo" />
          <input name="serviceName" placeholder="service name" />
          <button type="submit">POST /github/repositories/import</button>
        </form>
      </section>
      <section style={gridStyle}>
        <JsonCard title="Installations" value={state.installations} />
        <JsonCard title="Integrations" value={state.integrations} />
        <JsonCard title="Projects for import" value={state.projects.map((project: any) => ({ id: project.id, name: project.name || project.slug }))} />
      </section>
    </main>
  );
}

function JsonCard({ title, value }: { title: string; value: any }) { return <article style={cardStyle}><h2>{title}</h2><pre style={preStyle}>{JSON.stringify(value, null, 2)}</pre></article>; }
const pageStyle = { padding: 32, maxWidth: 1160, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 10 } as const;
const preStyle = { whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#0f172a', color: '#dbeafe', padding: 12, borderRadius: 10 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
