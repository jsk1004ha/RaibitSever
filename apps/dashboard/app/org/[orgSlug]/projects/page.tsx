import { loadDashboardOverview } from '../../../../lib/api';
import { ConsoleShell } from '../../../../components/console-ui';
import { ProjectCard } from '../../../../components/project-card';

export default async function ProjectsPage({ params }: { params: { orgSlug: string } }) {
  const state = await loadDashboardOverview();
  const projects = (state.projects || []).filter((project: any) => [project.organizationSlug, project.organizationId, 'default'].includes(params.orgSlug) || params.orgSlug === 'all');
  return (
    <ConsoleShell active="Projects" orgValue={params.orgSlug} crumbs={`${params.orgSlug} / Projects`} actions={<a className="btn btn-primary" href={`/org/${params.orgSlug}/projects/new`}>Create project</a>}>
      <section className="page">
        <header className="page-header">
          <div><p className="eyebrow">Workspace</p><h1 className="page-title">{params.orgSlug} projects</h1><p className="page-subtitle">Project list is loaded from GET /projects and links into API-backed management screens.</p></div>
          <span className="badge ok">{projects.length} projects</span>
        </header>
        <section className="grid grid-3">
          {projects.length ? projects.map((project: any) => <ProjectCard key={project.id} project={project} href={`/org/${params.orgSlug}/projects/${project.id}`} />) : <article className="card callout"><h2>첫 repo를 배포하세요</h2><p className="muted">No projects returned for this workspace.</p><a className="btn btn-primary" href={`/org/${params.orgSlug}/projects/new`} style={{ marginTop: 12 }}>새 프로젝트</a></article>}
        </section>
      </section>
    </ConsoleShell>
  );
}
