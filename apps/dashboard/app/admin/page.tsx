import { apiAction, loadAdminConsole } from '../../lib/api';
import { ConsoleShell, JsonCard, StatusBadge } from '../../components/console-ui';

export default async function AdminPage() {
  const state = await loadAdminConsole();
  return (
    <ConsoleShell active="Admin" eyebrow="Admin" orgLabel="ADMIN" orgValue="Beta operations" projectLabel="QUEUE" projectValue={`${state.pendingUsers.length} pending`} crumbs="Admin / Pending approvals" actions={<><a className="btn" href="/">Workspace</a><button className="btn btn-primary" type="button">Invite member</button></>}>
      <section className="page" data-od-id="admin-approval">
        <header className="page-header"><div><p className="eyebrow">Admin</p><h1 className="page-title">승인 대기 사용자</h1><p className="page-subtitle">Reads user/quota state from the API snapshot and lets admins approve users as club or non-club accounts. 승인, 거절, quota 변경은 모두 audit log에 남습니다.</p></div><span className="badge warn">{state.pendingUsers.length} pending</span></header>
        <div className="grid grid-main">
          <section className="card">
            <div className="card-title"><h2>Users</h2><div className="toolbar"><button className="btn" type="button">Filter</button><button className="btn" type="button">Export audit</button></div></div>
            <p className="muted">{state.pendingUsers.length} pending user(s). New signups start as NON_CLUB until an admin changes them.</p>
            <table className="table" style={{ marginTop: 12 }}><thead><tr><th>User</th><th>Role / Account</th><th>Status</th><th>Action</th></tr></thead><tbody>
              {state.users.length ? state.users.map((user: any) => <tr key={user.id}>
                <td><strong>{user.email || user.name}</strong><p className="muted mono">{user.id}</p></td><td>{user.role || 'USER'} / {user.accountType}</td><td><StatusBadge status={user.approvalStatus} /></td>
                <td className="table-actions"><form method="post" action={apiAction(`/admin/users/${user.id}/approve`, state.context)} className="inline-actions"><input type="hidden" name="accountType" value="CLUB_MEMBER" /><button type="submit">Set CLUB_MEMBER / approve</button></form><form method="post" action={apiAction(`/admin/users/${user.id}/approve`, state.context)} className="inline-actions" style={{ marginTop: 8 }}><input type="hidden" name="accountType" value="NON_CLUB" /><button type="submit">Set NON_CLUB / approve</button></form><form method="post" action={apiAction(`/admin/users/${user.id}/reject`, state.context)} style={{ marginTop: 8 }}><button type="submit">Reject</button></form></td>
              </tr>) : <tr><td colSpan={4}>No users returned.</td></tr>}
            </tbody></table>
          </section>
          <aside className="stack">
            <section className="card"><h2>Quota editor</h2><p className="muted" style={{ marginTop: 8 }}>quota 변경은 이전/이후 diff와 audit trail을 남깁니다.</p>{state.users[0] ? <form method="post" action={apiAction(`/admin/users/${state.users[0].id}/quota`, state.context)} className="form-grid" style={{ marginTop: 12 }}><label>Projects<input name="maxProjects" placeholder="maxProjects" /></label><label>Services<input name="maxServices" placeholder="maxServices" /></label><button type="submit">Quota edit</button></form> : null}</section>
            <section className="card danger-zone"><h2>Reject confirmation</h2><p className="muted" style={{ marginTop: 8 }}>거절하면 사용자는 project, service, deployment, resource 생성을 계속 할 수 없습니다. 사유는 사용자에게 표시됩니다.</p></section>
          </aside>
        </div>
        <section className="grid grid-3" style={{ marginTop: 16 }}><JsonCard title="Quotas" value={state.quotas} /><JsonCard title="Usage" value={state.usage} /><JsonCard title="Audit logs" value={(state.auditLogs || []).slice(-10)} /></section>
      </section>
    </ConsoleShell>
  );
}
