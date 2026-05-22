import { apiAction, dashboardApiContext } from '../../lib/api';

export default function LoginPage() {
  const context = dashboardApiContext();
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Auth</p>
        <h1>Login / Signup</h1>
        <p>Forms post directly to the RAIBITSERVER API. Copy the returned token into RAIBITSERVER_DASHBOARD_TOKEN for server-rendered console access.</p>
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
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 900, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff', display: 'grid', gap: 12 } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
