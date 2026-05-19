export default function ProjectDetailPage({ params }: { params: { orgSlug: string; projectId: string } }) {
  const services = ['web', 'api', 'worker', 'cleanup-cron'];
  const resources = ['postgres', 'redis', 'object-storage'];
  return (
    <main style={{ padding: 32 }}>
      <h1>{params.projectId}</h1>
      <p>Organization: {params.orgSlug}</p>
      <h2>Services</h2>
      <ul>{services.map((service) => <li key={service}>{service}</li>)}</ul>
      <h2>Resources</h2>
      <ul>{resources.map((resource) => <li key={resource}>{resource}</li>)}</ul>
    </main>
  );
}
