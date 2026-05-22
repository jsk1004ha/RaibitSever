type ProjectCardProps = {
  project: {
    id?: string;
    name?: string;
    slug?: string;
    status?: string;
    services?: number;
    resources?: number;
  };
  href?: string;
};

export function ProjectCard({ project, href }: ProjectCardProps) {
  const body = (
    <article style={{ background: 'white', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0', minHeight: 110 }}>
      <strong>{project.name || project.slug || project.id}</strong>
      <p>{project.status || 'active'} · {project.services ?? 0} services · {project.resources ?? 0} resources</p>
      {href ? <span style={{ color: '#2563eb', fontWeight: 700 }}>Open console →</span> : null}
    </article>
  );
  return href ? <a href={href} style={{ textDecoration: 'none' }}>{body}</a> : body;
}
