import { apiAction, dashboardApiContext } from '../../lib/api';

export default function LoginPage() {
  const context = dashboardApiContext();
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Auth</p>
        <h1>Login / Signup</h1>
        <p>Forms post directly to the RAIBITSERVER API. The first successful auth user becomes ADMIN / NON_CLUB / APPROVED; later signups also start as NON_CLUB / PENDING until an admin approves or switches them to CLUB_MEMBER. Copy the returned token into RAIBITSERVER_DASHBOARD_TOKEN for server-rendered console access.</p>
      </header>
      <section style={gridStyle}>
        <form method="post" action={apiAction('/auth/login', context)} style={cardStyle}>
          <h2>Login</h2>
          <label>Email <input name="email" type="email" required /></label>
          <label>Password <input name="password" type="password" required /></label>
          <button type="submit">POST /auth/login</button>
        </form>
        <form method="post" action={apiAction('/auth/signup', context)} style={cardStyle}>
          <h2>Signup</h2>
          <label>Email <input name="email" type="email" required /></label>
          <label>Password <input name="password" type="password" required /></label>
          <label>Organization slug <input name="organizationSlug" placeholder="club-dev" /></label>
          <button type="submit">POST /auth/signup</button>
        </form>
        <form method="get" action={apiAction('/auth/github/callback', context)} style={cardStyle}>
          <h2>GitHub link</h2>
          <p style={hintStyle}>Use GET /auth/github/login for a provider redirect plan, or this deterministic beta callback to attach a GitHub identity by email.</p>
          <a href={apiAction('/auth/github/login', context)}>GET /auth/github/login</a>
          <input name="localDev" type="hidden" value="1" />
          <label>Email <input name="email" type="email" required /></label>
          <label>GitHub ID <input name="githubId" placeholder="123456" /></label>
          <label>GitHub login <input name="login" placeholder="club-member" /></label>
          <label>Organization slug <input name="organizationSlug" placeholder="github-user-org" /></label>
          <button type="submit">GET /auth/github/callback</button>
        </form>
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 900, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 12 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
const hintStyle = { color: '#475569', fontSize: 14, lineHeight: 1.5 } as const;
