import { apiAction, loadGitHubConsole } from '../../lib/api';
import { JsonCard } from '../../components/console-ui';

export default async function GitHubPage() {
  const state = await loadGitHubConsole();
  const firstProject = state.projects[0];
  const firstService = state.services[0];
  const firstRepository = state.repositories[0];
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>GitHub App</p>
        <h1>Repository import and preview deployments</h1>
        <p>Installations, stored integrations, repository attach/import/sync, raw webhook HMAC handling, and PR preview workload contracts are API-backed.</p>
      </header>
      <section style={gridStyle}>
        <form method="post" action={apiAction('/integrations/github', state.context)} style={cardStyle}>
          <h2>Connect integration</h2>
          <input name="organizationId" placeholder="org id" />
          <input name="accountLogin" placeholder="github org/user" />
          <input name="installationId" placeholder="installation id" />
          <input name="token" placeholder="optional token" />
          <button type="submit">POST /integrations/github</button>
        </form>
        <form method="post" action={apiAction('/github/repositories/import', state.context)} style={cardStyle}>
          <h2>Import repository</h2>
          <input name="projectId" placeholder="project id" defaultValue={state.projects[0]?.id || ''} />
          <input name="integrationId" placeholder="integration id" defaultValue={state.integrations[0]?.id || ''} />
          <input name="repository" placeholder="owner/repo" />
          <input name="serviceName" placeholder="service name" />
          <button type="submit">POST /github/repositories/import</button>
        </form>
        <form method="post" action={apiAction(firstProject && firstService ? `/projects/${firstProject.id}/services/${firstService.id}/github` : '/projects/project-id/services/service-id/github', state.context)} style={cardStyle}>
          <h2>Attach repository to service</h2>
          <input name="integrationId" placeholder="integration id" defaultValue={state.integrations[0]?.id || ''} />
          <input name="repoUrl" placeholder="https://github.com/org/repo.git" defaultValue={firstRepository?.repoUrl || ''} />
          <input name="branch" placeholder="main" defaultValue={firstRepository?.defaultBranch || 'main'} />
          <button type="submit">POST /projects/:projectId/services/:serviceId/github</button>
          <p style={hintStyle}>Current default target: {firstProject?.name || 'project-id'} / {firstService?.name || 'service-id'}</p>
        </form>
        <form method="post" action={apiAction(firstRepository ? `/github/repositories/${encodeURIComponent(firstRepository.fullName)}/sync` : '/github/repositories/owner%2Frepo/sync', state.context)} style={cardStyle}>
          <h2>Sync repository metadata</h2>
          <p>Queues `github-repository-sync` for attached services and keeps installation repository evidence fresh.</p>
          <button type="submit">POST /github/repositories/:repositoryId/sync</button>
        </form>
      </section>
      <section style={gridStyle}>
        <JsonCard title="Installations" value={state.installations} />
        <JsonCard title="Installation repositories" value={state.repositoriesByInstallation} />
        <JsonCard title="Integrations" value={state.integrations} />
        <JsonCard title="Projects for import" value={state.projects.map((project: any) => ({ id: project.id, name: project.name || project.slug }))} />
        <JsonCard title="Attachable services" value={state.services.map((service: any) => ({ projectId: service.projectId, serviceId: service.id, name: service.name || service.slug, repository: service.githubRepository || service.repoUrl }))} />
        <JsonCard title="Webhook / Preview contract" value={{ webhookEndpoint: 'POST /github/webhooks', requiredHeaders: ['x-github-event', 'x-github-delivery', 'x-hub-signature-256'], push: 'build-and-deploy WorkflowJob', pullRequest: 'preview-deploy WorkflowJob with pr-N workload', closed: 'preview-cleanup WorkflowJob' }} />
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 1160, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 10 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
const hintStyle = { color: '#64748b', fontSize: 13 } as const;
