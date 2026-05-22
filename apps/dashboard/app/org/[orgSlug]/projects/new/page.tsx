import { apiAction, dashboardApiContext } from '../../../../../lib/api';

export default function NewProjectPage({ params }: { params: { orgSlug: string } }) {
  const context = dashboardApiContext();
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Create project</p>
        <h1>New project in {params.orgSlug}</h1>
      </header>
      <form method="post" action={apiAction('/projects', context)} style={cardStyle}>
        <label>Name <input name="name" required placeholder="Club Website" /></label>
        <label>Slug <input name="slug" placeholder="club-website" /></label>
        <label>Organization ID/slug <input name="organizationId" defaultValue={params.orgSlug} /></label>
        <button type="submit">POST /projects</button>
      </form>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 760, margin: '0 auto', display: 'grid', gap: 20 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 12 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
