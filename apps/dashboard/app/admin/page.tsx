import { apiAction, loadAdminConsole } from '../../lib/api';
import { JsonCard } from '../../components/console-ui';

export default async function AdminPage() {
  const state = await loadAdminConsole();
  return (
    <main style={pageStyle}>
      <header>
        <p style={eyebrowStyle}>Admin</p>
        <h1>Pending users, approvals, and quota</h1>
        <p>Reads user/quota state from the API snapshot and posts mutations to admin endpoints.</p>
      </header>
      <section style={cardStyle}>
        <h2>Pending users</h2>
        {state.pendingUsers.length ? state.pendingUsers.map((user: any) => <article key={user.id} style={miniCardStyle}>
          <strong>{user.email || user.name}</strong><span>{user.accountType} / {user.approvalStatus}</span>
          <form method="post" action={apiAction(`/admin/users/${user.id}/approve`, state.context)}><input type="hidden" name="accountType" value="CLUB_MEMBER" /><button type="submit">Approve</button></form>
          <form method="post" action={apiAction(`/admin/users/${user.id}/reject`, state.context)}><button type="submit">Reject</button></form>
          <form method="post" action={apiAction(`/admin/users/${user.id}/quota`, state.context)}><input name="maxProjects" placeholder="maxProjects" /><input name="maxServices" placeholder="maxServices" /><button type="submit">Quota edit</button></form>
        </article>) : <p>No pending users returned.</p>}
      </section>
      <section style={gridStyle}>
        <JsonCard title="Quotas" value={state.quotas} />
        <JsonCard title="Usage" value={state.usage} />
        <JsonCard title="Audit logs" value={(state.auditLogs || []).slice(-10)} />
      </section>
    </main>
  );
}

const pageStyle = { padding: 32, maxWidth: 1160, margin: '0 auto', display: 'grid', gap: 20 } as const;
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 } as const;
const cardStyle = { border: '1px solid #dbeafe', borderRadius: 16, padding: 20, background: '#fff' } as const;
const miniCardStyle = { border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, display: 'grid', gap: 8, margin: '10px 0' } as const;
const eyebrowStyle = { color: '#2563eb', fontWeight: 800 } as const;
