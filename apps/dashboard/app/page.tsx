import { loadDashboardOverview, apiAction } from '../lib/api';
import { ProjectCard } from '../components/project-card';

export default async function HomePage() {
  const state = await loadDashboardOverview();
  const user = state.me.body?.user;
  const subject = state.me.body?.subject;
  const projects = state.projects || [];
  const createOrgSlug = projects[0]?.organizationSlug || projects[0]?.organizationId || subject?.organizationSlug || subject?.organizationId || 'default';
  return (
    <main style={pageStyle}>
      <header style={heroStyle}>
        <p style={eyebrowStyle}>RAIBITSERVER</p>
        <h1>API-backed PaaS + DBaaS operations console</h1>
        <p>Projects, services, deployments, resources, logs, GitHub previews, and admin quota flows are rendered from the control-plane API.</p>
        <nav style={navStyle}>
          <a href="/login">Login / Signup</a>
          <a href="/github">GitHub import</a>
          <a href="/admin">Admin</a>
          <a href={apiAction('/health')}>API health</a>
        </nav>
      </header>

      <section style={cardStyle}>
        <h2>API connection</h2>
        <p><b>Endpoint:</b> {state.context.baseUrl}</p>
        <p><b>Status:</b> {state.health.body?.status === 'ok' ? 'connected' : `offline (${state.health.error || 'token missing or API unavailable'})`}</p>
        <p><b>Current user:</b> {user?.email || subject?.id || 'No dashboard token'}</p>
        <p><b>Account:</b> {subject?.accountType || user?.accountType || 'unknown'} / {subject?.approvalStatus || user?.approvalStatus || 'unknown'}</p>
      </section>

      <section style={gridStyle}>
        <Panel title="Projects" value={projects.length} detail="Loaded with GET /projects" />
        <Panel title="GitHub integrations" value={state.github?.integrations?.length || 0} detail="Installations, repo import, webhooks" />
        <Panel title="Usage records" value={state.usage?.usage?.length || 0} detail="GET /usage/me quota surface" />
        <Panel title="Installations" value={state.installations.length} detail="GET /github/installations" />
      </section>

      <section style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <h2>Project consoles</h2>
          <a href={`/org/${createOrgSlug}/projects/new`}>Create project</a>
        </div>
        <div style={gridStyle}>
          {projects.length ? projects.map((project: any) => (
            <ProjectCard key={project.id} project={{ ...project, services: project.serviceCount, resources: project.resourceCount }} href={`/org/${project.organizationSlug || project.organizationId || 'org'}/projects/${project.id}`} />
          )) : <p>No projects returned. Add RAIBITSERVER_DASHBOARD_TOKEN or create one through the form/API.</p>}
        </div>
      </section>
    </main>
  );
}

function Panel({ title, value, detail }: { title: string; value: number; detail: string }) {
  return <article style={cardStyle}><h2>{title}</h2><strong style={{ fontSize: 32 }}>{value}</strong><p>{detail}</p></article>;
}

const pageStyle = { padding: 32, maxWidth: 1200, margin: '0 auto', display: 'grid', gap: 24 } as const;
const heroStyle = { display: 'grid', gap: 8 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800, letterSpacing: '0.08em' } as const;
const navStyle = { display: 'flex', gap: 14, flexWrap: 'wrap', color: '#2563eb', fontWeight: 700 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#ffffff', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 } as const;
const sectionHeaderStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' } as const;
