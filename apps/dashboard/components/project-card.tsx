import { StatusBadge } from './console-ui';

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
    <article className="card project-card">
      <div className="card-title"><h2>{project.name || project.slug || project.id}</h2><StatusBadge status={project.status || 'active'} /></div>
      <p className="muted">{project.services ?? 0} services · {project.resources ?? 0} resources</p>
      {href ? <span className="subtle-link">Open console →</span> : null}
    </article>
  );
  return href ? <a href={href}>{body}</a> : body;
}
