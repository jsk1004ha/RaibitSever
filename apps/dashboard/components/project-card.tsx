type ProjectCardProps = {
  project: {
    name: string;
    status: string;
    services: number;
    resources: number;
  };
};

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <article style={{ background: 'white', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0' }}>
      <strong>{project.name}</strong>
      <p>{project.status} · {project.services} services · {project.resources} resources</p>
    </article>
  );
}
