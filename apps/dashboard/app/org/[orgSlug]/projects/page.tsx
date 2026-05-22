import { loadDashboardOverview } from '../../../../lib/api';
import { ProjectCard } from '../../../../components/project-card';

export default async function ProjectsPage({ params }: { params: { orgSlug: string } }) {
  const state = await loadDashboardOverview();
  const projects = (state.projects || []).filter((project: any) => [project.organizationSlug, project.organizationId, 'default'].includes(params.orgSlug) || params.orgSlug === 'all');
  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Workspace</p>
          <h1>{params.orgSlug} projects</h1>
          <p>Project list is loaded from GET /projects and links into API-backed management screens.</p>
        </div>
        <a href={`/org/${params.orgSlug}/projects/new`}>Create project</a>
      </header>
      <section style={gridStyle}>
        {projects.length ? projects.map((project: any) => <ProjectCard key={project.id} project={project} href={`/org/${params.orgSlug}/projects/${project.id}`} />) : <p>No projects returned for this workspace.</p>}
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 20 } as const;
const headerStyle = { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
