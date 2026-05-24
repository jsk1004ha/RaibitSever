import { apiAction, dashboardApiContext } from '../../lib/api';

export default function LoginPage() {
  const context = dashboardApiContext();
  return (
    <main className="hero" data-od-id="landing-auth">
      <section className="hero-copy">
        <p className="eyebrow">RAIBITSERVER BETA</p>
        <h1>동아리 앱을 repo에서 runtime URL까지</h1>
        <p className="page-subtitle">GitHub 저장소, Dockerfile, 관리형 DB, preview deployment를 하나의 프로젝트로 관리합니다. 기본값은 안전하고, 필요할 때만 깊은 인프라 설정을 펼칩니다.</p>
        <div className="toolbar"><a className="btn btn-primary" href={apiAction('/auth/github/login', context)}>Continue with GitHub</a><a className="btn" href="/">데모 콘솔 보기</a></div>
        <div className="callout"><strong>승인 대기 안내</strong><p className="muted">Forms post directly to the RAIBITSERVER API. The first successful auth user becomes ADMIN / NON_CLUB / APPROVED; later signups also start as NON_CLUB / PENDING until an admin approves or switches them to CLUB_MEMBER. Copy the returned token into RAIBITSERVER_DASHBOARD_TOKEN for server-rendered console access.</p></div>
      </section>
      <aside className="console-preview">
        <div className="preview-bar"><span></span><span></span><span></span></div>
        <div className="preview-body grid">
          <form method="post" action={apiAction('/auth/login', context)} className="card">
            <div className="card-title"><h2>Login</h2><span className="badge info">Auth</span></div>
            <label>Email <input name="email" type="email" required /></label>
            <label>Password <input name="password" type="password" required /></label>
            <button type="submit">POST /auth/login</button>
          </form>
          <form method="post" action={apiAction('/auth/signup', context)} className="card">
            <div className="card-title"><h2>Signup</h2><span className="badge warn">Pending</span></div>
            <label>Email <input name="email" type="email" required /></label>
            <label>Password <input name="password" type="password" required /></label>
            <label>Organization slug <input name="organizationSlug" placeholder="club-dev" /></label>
            <button type="submit">POST /auth/signup</button>
          </form>
          <form method="get" action={apiAction('/auth/github/callback', context)} className="card">
            <div className="card-title"><h2>GitHub link</h2><span className="badge ok">OAuth</span></div>
            <p className="muted">Use GET /auth/github/login for a provider redirect plan, or this deterministic beta callback to attach a GitHub identity by email.</p>
            <input name="localDev" type="hidden" value="1" />
            <label>Email <input name="email" type="email" required /></label>
            <label>GitHub ID <input name="githubId" placeholder="123456" /></label>
            <label>GitHub login <input name="login" placeholder="club-member" /></label>
            <label>Organization slug <input name="organizationSlug" placeholder="github-user-org" /></label>
            <button type="submit">GET /auth/github/callback</button>
          </form>
        </div>
      </aside>
    </main>
  );
}
