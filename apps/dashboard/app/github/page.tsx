import { apiAction, loadGitHubConsole } from '../../lib/api';
import { ConsoleShell, JsonCard } from '../../components/console-ui';

export default async function GitHubPage() {
  const state = await loadGitHubConsole();
  const firstProject = state.projects[0];
  const firstService = state.services[0];
  const firstRepository = state.repositories[0];
  return (
    <ConsoleShell active="GitHub" eyebrow="GitHub integration" orgValue="Repository import" projectValue="Preview policy" crumbs="GitHub / Import and previews" actions={<><a className="btn" href="/">Dashboard</a><button className="btn btn-primary" type="submit" form="import-repository">Import repository</button></>}>
      <section className="page">
        <header className="page-header"><div><p className="eyebrow">GitHub App</p><h1 className="page-title">Repository import and preview deployments</h1><p className="page-subtitle">Installations, stored integrations, repository attach/import/sync, raw webhook HMAC handling, and PR preview workload contracts are API-backed. Missing installation, bad signature, permission denied 상태를 분리해 보여줍니다.</p></div><span className="badge ok">Webhook ready</span></header>
        <section className="grid grid-2">
          <form method="post" action={apiAction('/integrations/github', state.context)} className="card stack">
            <div className="card-title"><h2>Connect integration</h2><span className="badge info">Install</span></div>
            <input name="organizationId" placeholder="org id" /><input name="accountLogin" placeholder="github org/user" /><input name="installationId" placeholder="installation id" /><input name="token" placeholder="optional token" /><button type="submit">POST /integrations/github</button>
          </form>
          <form id="import-repository" method="post" action={apiAction('/github/repositories/import', state.context)} className="card stack">
            <div className="card-title"><h2>Import repository</h2><span className="badge ok">Source</span></div>
            <input name="projectId" placeholder="project id" defaultValue={state.projects[0]?.id || ''} /><input name="integrationId" placeholder="integration id" defaultValue={state.integrations[0]?.id || ''} /><input name="repository" placeholder="owner/repo" /><input name="serviceName" placeholder="service name" /><button type="submit">POST /github/repositories/import</button>
          </form>
          <form method="post" action={apiAction(firstProject && firstService ? `/projects/${firstProject.id}/services/${firstService.id}/github` : '/projects/project-id/services/service-id/github', state.context)} className="card stack">
            <div className="card-title"><h2>Attach repository to service</h2><span className="badge info">Service</span></div>
            <input name="integrationId" placeholder="integration id" defaultValue={state.integrations[0]?.id || ''} /><input name="repoUrl" placeholder="https://github.com/org/repo.git" defaultValue={firstRepository?.repoUrl || ''} /><input name="branch" placeholder="main" defaultValue={firstRepository?.defaultBranch || 'main'} /><button type="submit">POST /projects/:projectId/services/:serviceId/github</button><p className="muted">Current default target: {firstProject?.name || 'project-id'} / {firstService?.name || 'service-id'}</p>
          </form>
          <form method="post" action={apiAction(firstRepository ? `/github/repositories/${encodeURIComponent(firstRepository.fullName)}/sync` : '/github/repositories/owner%2Frepo/sync', state.context)} className="card stack">
            <div className="card-title"><h2>Sync repository metadata</h2><span className="badge warn">Queue</span></div><p className="muted">Queues `github-repository-sync` for attached services and keeps installation repository evidence fresh.</p><button type="submit">POST /github/repositories/:repositoryId/sync</button>
          </form>
        </section>
        <section className="grid grid-3" style={{ marginTop: 16 }}>
          <JsonCard title="Installations" value={state.installations} /><JsonCard title="Installation repositories" value={state.repositoriesByInstallation} /><JsonCard title="Integrations" value={state.integrations} /><JsonCard title="Projects for import" value={state.projects.map((project: any) => ({ id: project.id, name: project.name || project.slug }))} /><JsonCard title="Attachable services" value={state.services.map((service: any) => ({ projectId: service.projectId, serviceId: service.id, name: service.name || service.slug, repository: service.githubRepository || service.repoUrl }))} /><JsonCard title="Webhook / Preview contract" value={{ webhookEndpoint: 'POST /github/webhooks', requiredHeaders: ['x-github-event', 'x-github-delivery', 'x-hub-signature-256'], push: 'build-and-deploy WorkflowJob', pullRequest: 'preview-deploy WorkflowJob with pr-N workload', closed: 'preview-cleanup WorkflowJob' }} />
        </section>
      </section>
    </ConsoleShell>
  );
}
