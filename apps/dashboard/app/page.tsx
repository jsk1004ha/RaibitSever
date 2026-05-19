type ApiState = {
  ok: boolean;
  baseUrl: string;
  me?: any;
  projects?: any[];
  error?: string;
};

async function loadApiState(): Promise<ApiState> {
  const baseUrl = (process.env.RAIBITSERVER_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
  const token = process.env.RAIBITSERVER_DASHBOARD_TOKEN || process.env.RAIBITSERVER_TOKEN;
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  try {
    const [health, me, projects] = await Promise.all([
      fetch(`${baseUrl}/health`, { cache: 'no-store' }).then((r) => r.json()),
      token ? fetch(`${baseUrl}/auth/me`, { headers, cache: 'no-store' }).then((r) => r.json()) : Promise.resolve({ user: null, subject: null }),
      token ? fetch(`${baseUrl}/projects`, { headers, cache: 'no-store' }).then((r) => r.json()) : Promise.resolve({ projects: [] }),
    ]);
    return { ok: health.status === 'ok', baseUrl, me, projects: projects.projects || [] };
  } catch (error) {
    return { ok: false, baseUrl, error: error instanceof Error ? error.message : String(error), projects: [] };
  }
}

export default async function HomePage() {
  const state = await loadApiState();
  const user = state.me?.user;
  const subject = state.me?.subject;
  return (
    <main style={{ padding: 32, maxWidth: 1160, margin: '0 auto', display: 'grid', gap: 24 }}>
      <header>
        <p style={{ color: '#2563eb', fontWeight: 700 }}>RAIBITSERVER</p>
        <h1>Local E2E PaaS + DBaaS Console</h1>
        <p>GitHub repo, Dockerfile/image, preview deployment, DB/resource, logs, quota를 실제 API contract로 관리합니다.</p>
      </header>

      <section style={cardStyle}>
        <h2>API 연결</h2>
        <p><b>Endpoint:</b> {state.baseUrl}</p>
        <p><b>Status:</b> {state.ok ? 'connected' : `offline (${state.error || 'token missing or API unavailable'})`}</p>
        <p><b>Current user:</b> {user?.email || subject?.id || '로그인 토큰 없음'}</p>
        <p><b>Account:</b> {subject?.accountType || user?.accountType || 'unknown'} / {subject?.approvalStatus || user?.approvalStatus || 'unknown'}</p>
      </section>

      <section style={gridStyle}>
        <Panel title="Projects" items={(state.projects || []).map((project) => `${project.name || project.slug} (${project.status || 'active'})`)} empty="No projects yet. Use POST /projects or CLI projects create." />
        <Panel title="Deployments" items={["Create: POST /services/:serviceId/deployments", "Logs: GET /deployments/:deploymentId/logs", "Runtime: GET /services/:serviceId/logs"]} />
        <Panel title="Resources / DB Console" items={["PostgreSQL/MySQL/MariaDB/Mongo/Redis/SQLite/Object/Qdrant/NATS catalog", "SQLite local console: /resources/:id/console/query", "Secrets are encrypted and masked"]} />
        <Panel title="GitHub / Preview" items={["Installations/repo import contract", "Webhook signature verification", "PR preview deployment fixture via dev:e2e"]} />
        <Panel title="Admin / Quota" items={["NON_CLUB starts PENDING", "Admin approve/reject/quota endpoints", "CLUB_MEMBER bypasses user-facing quota with hard safety caps"]} />
        <Panel title="Local E2E" items={["pnpm dev:up", "pnpm dev:seed", "pnpm dev:e2e", "pnpm dev:down"]} />
      </section>
    </main>
  );
}

function Panel({ title, items, empty }: { title: string; items?: string[]; empty?: string }) {
  return (
    <article style={cardStyle}>
      <h2>{title}</h2>
      {items?.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>{empty}</p>}
    </article>
  );
}

const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#ffffff', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)' } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 } as const;
