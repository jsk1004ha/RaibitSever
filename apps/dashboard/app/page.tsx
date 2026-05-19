import { ProjectCard } from '../components/project-card';

const projects = [
  { name: 'festival-2026', status: 'Live', services: 4, resources: 3 },
  { name: 'hackathon-team-a', status: 'Sleeping', services: 3, resources: 2 },
  { name: 'study-board', status: 'Live', services: 2, resources: 1 },
];

export default function HomePage() {
  return (
    <main style={{ padding: 32, maxWidth: 1040, margin: '0 auto' }}>
      <p style={{ color: '#2563eb', fontWeight: 700 }}>RAIBITSERVER</p>
      <h1>동아리·학교·소규모 팀을 위한 PaaS + DBaaS</h1>
      <p>GitHub repo, Dockerfile, container image, DB, storage를 한 프로젝트 안에서 관리합니다.</p>
      <section style={{ display: 'grid', gap: 16, marginTop: 32 }}>
        {projects.map((project) => <ProjectCard key={project.name} project={project} />)}
      </section>
    </main>
  );
}
