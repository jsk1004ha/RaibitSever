import { loadDashboardOverview, apiAction } from '../lib/api';
import { ConsoleShell, MetricCard, StatusBadge } from '../components/console-ui';
import { ProjectCard } from '../components/project-card';

export default async function HomePage() {
  const state = await loadDashboardOverview();
  const user = state.me.body?.user;
  const subject = state.me.body?.subject;
  const projects = state.projects || [];
  const createOrgSlug = projects[0]?.organizationSlug || projects[0]?.organizationId || subject?.organizationSlug || subject?.organizationId || 'default';
  const health = state.health.body?.status === 'ok';
  return (
    <ConsoleShell active="Dashboard" orgValue={createOrgSlug} crumbs={`${createOrgSlug} / Dashboard`} actions={<><a className="btn" href="/github">GitHub 연결</a><a className="btn btn-primary" href={`/org/${createOrgSlug}/projects/new`}>새 프로젝트</a></>}>
      <section className="page" data-od-id="org-dashboard">
        <header className="page-header">
          <div>
            <p className="eyebrow">RAIBITSERVER · PRODUCT CONSOLE</p>
            <h1 className="page-title">Repo에서 runtime URL까지, 안전한 기본값으로 배포하세요.</h1>
            <p className="page-subtitle">Projects, services, deployments, resources, logs, GitHub previews, and admin quota flows are rendered from the control-plane API.</p>
          </div>
          <StatusBadge status={health ? 'connected' : 'offline'} />
        </header>

        <section className="card callout">
          <div className="card-title"><h2>API connection</h2><span className="badge info">API health</span></div>
          <div className="grid grid-3">
            <p><span className="label">Endpoint</span><br /><span className="mono">{state.context.baseUrl}</span></p>
            <p><span className="label">Status</span><br />{health ? 'connected' : `offline (${state.health.error || 'token missing or API unavailable'})`}</p>
            <p><span className="label">Current user</span><br />{user?.email || subject?.id || 'No dashboard token'}</p>
            <p><span className="label">Account</span><br />{subject?.accountType || user?.accountType || 'unknown'} / {subject?.approvalStatus || user?.approvalStatus || 'unknown'}</p>
          </div>
        </section>

        <section className="grid grid-3">
          <MetricCard title="Projects" value={projects.length} detail="Loaded with GET /projects" tone="ok" />
          <MetricCard title="GitHub integrations" value={state.github?.integrations?.length || 0} detail="Installations, repo import, webhooks" />
          <MetricCard title="Usage records" value={state.usage?.usage?.length || 0} detail="GET /usage/me quota surface" tone="warn" />
        </section>

        <section className="grid grid-main">
          <article className="card">
            <div className="card-title"><h2>Project consoles</h2><a className="btn btn-primary" href={`/org/${createOrgSlug}/projects/new`}>Create project</a></div>
            <div className="grid grid-2">
              {projects.length ? projects.map((project: any) => (
                <ProjectCard key={project.id} project={{ ...project, services: project.serviceCount, resources: project.resourceCount }} href={`/org/${project.organizationSlug || project.organizationId || 'org'}/projects/${project.id}`} />
              )) : <p className="muted">No projects returned. Add RAIBITSERVER_DASHBOARD_TOKEN or create one through the form/API.</p>}
            </div>
          </article>
          <aside className="stack">
            <article className="card"><div className="card-title"><h2>다음 추천 행동</h2><span className="badge info">Guide</span></div><p className="muted">GitHub App을 설치하면 push deploy와 PR preview가 자동으로 연결됩니다.</p><a className="btn btn-primary" href="/github" style={{ marginTop: 12 }}>GitHub import</a></article>
            <article className="card"><div className="card-title"><h2>Console routes</h2><span className="badge ok">Ready</span></div><nav className="stack"><a className="subtle-link" href="/login">Login / Signup</a><a className="subtle-link" href="/github">GitHub import</a><a className="subtle-link" href="/admin">Admin</a><a className="subtle-link" href={apiAction('/health')}>API health</a></nav></article>
          </aside>
        </section>
      </section>
    </ConsoleShell>
  );
}
