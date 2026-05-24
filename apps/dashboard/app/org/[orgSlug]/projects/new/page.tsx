import { apiAction, dashboardApiContext } from '../../../../../lib/api';
import { ConsoleShell } from '../../../../../components/console-ui';

export default function NewProjectPage({ params }: { params: { orgSlug: string } }) {
  const context = dashboardApiContext();
  return (
    <ConsoleShell active="Create project" orgValue={params.orgSlug} crumbs={`${params.orgSlug} / New project`}>
      <section className="page" data-od-id="create-project">
        <header className="page-header"><div><p className="eyebrow">Create project</p><h1 className="page-title">프로젝트 만들기</h1><p className="page-subtitle">처음 온 학생은 repo만 고르면 시작하고, 숙련자는 Dockerfile, image, resource plan을 펼쳐 조정합니다.</p></div><span className="badge info">3 steps</span></header>
        <div className="grid grid-main">
          <form method="post" action={apiAction('/projects', context)} className="card">
            <div className="tabs"><button type="button" className="tab active">1 Source</button><button type="button" className="tab">2 Service</button><button type="button" className="tab">3 Resource</button></div>
            <div className="form-grid">
              <label>Name <input name="name" required placeholder="Club Website" /></label>
              <label>Slug <input name="slug" placeholder="club-website" /></label>
              <label>Organization ID/slug <input name="organizationId" defaultValue={params.orgSlug} /></label>
              <label>Repository URL <input name="repoUrl" placeholder="https://github.com/rabbit-club/club-api" /></label>
            </div>
            <p className="callout" style={{ marginTop: 14 }}>Connection secret은 서비스 env에 masked 값으로 attach됩니다. 원문 secret은 콘솔에 표시하지 않습니다.</p>
            <div className="toolbar" style={{ marginTop: 18 }}><a className="btn" href={`/org/${params.orgSlug}/projects`}>초안 취소</a><button type="submit">POST /projects</button></div>
          </form>
          <aside className="stack">
            <article className="card"><h2>생성될 desired state</h2><pre className="code-panel" style={{ padding: 12, marginTop: 12 }}>project: club-api{`\n`}services:{`\n`}  - web: Dockerfile{`\n`}resources:{`\n`}  - postgresql{`\n`}  - redis{`\n`}security:{`\n`}  nonRoot: true{`\n`}  networkPolicy: default</pre></article>
            <article className="card"><div className="card-title"><h2>Quota preview</h2><span className="badge warn">주의</span></div><p className="muted">Project 8/10 · Services 15/20 · DB storage 4.2GB/10GB</p><div className="meter" style={{ '--value': '42%', marginTop: 12 } as any}><span></span></div></article>
          </aside>
        </div>
      </section>
    </ConsoleShell>
  );
}
