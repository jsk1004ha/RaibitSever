import type { ReactNode } from 'react';

type JsonCardProps = {
  title: string;
  value: any;
};

type ShellProps = {
  children: ReactNode;
  eyebrow?: string;
  orgLabel?: string;
  orgValue?: string;
  projectLabel?: string;
  projectValue?: string;
  active?: string;
  crumbs?: string;
  actions?: ReactNode;
};

const navItems = [
  { label: 'Dashboard', href: '/' },
  { label: 'Projects', href: '/org/default/projects' },
  { label: 'Create project', href: '/org/default/projects/new' },
  { label: 'GitHub', href: '/github' },
  { label: 'Admin', href: '/admin' },
  { label: 'Login / Signup', href: '/login' },
];

export function ConsoleShell({ children, eyebrow = 'Workspace', orgLabel = 'ORGANIZATION', orgValue = 'RAIBITSERVER', projectLabel = 'PROJECT', projectValue = 'All projects', active = 'Dashboard', crumbs = 'RAIBITSERVER / Console', actions }: ShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/"><span className="brand-mark">RS</span><span>RAIBITSERVER</span></a>
        <div className="switcher"><p className="switcher-label">{orgLabel}</p><div className="switcher-title">{orgValue}<span>⌄</span></div></div>
        <div className="switcher"><p className="switcher-label">{projectLabel}</p><div className="switcher-title">{projectValue}<span>⌄</span></div></div>
        <nav className="nav-group"><p className="nav-title">{eyebrow}</p>{navItems.map((item) => <a key={item.label} className={`nav-link ${active === item.label ? 'active' : ''}`} href={item.href}>{item.label}<span>›</span></a>)}</nav>
      </aside>
      <main className="main">
        <div className="topbar"><div className="crumbs">{crumbs}</div><div className="toolbar">{actions}</div></div>
        <nav className="mobile-nav">{navItems.slice(0, 5).map((item) => <a key={item.label} className={`btn ${active === item.label ? 'active' : ''}`} href={item.href}>{item.label}</a>)}</nav>
        {children}
      </main>
    </div>
  );
}

export function JsonCard({ title, value }: JsonCardProps) {
  return (
    <article className="card">
      <div className="card-title"><h2>{title}</h2><span className="badge info">API</span></div>
      <pre className="code-panel" style={{ padding: 12 }}>{JSON.stringify(value, null, 2)}</pre>
    </article>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  const text = String(status || 'active');
  return <span className={`badge ${statusTone(text)}`}>{text}</span>;
}

function statusTone(status: string) {
  const lower = status.toLowerCase();
  if (['fail', 'reject', 'blocked'].some((signal) => lower.includes(signal))) return 'danger';
  if (['queue', 'build', 'pending', 'pause'].some((signal) => lower.includes(signal))) return 'warn';
  if (['ready', 'healthy', 'active', 'running', 'approved'].some((signal) => lower.includes(signal))) return 'ok';
  return 'info';
}

export function MetricCard({ title, value, detail, tone = 'info' }: { title: string; value: number | string; detail?: string; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  return <article className="card"><div className="card-title"><h2>{title}</h2><span className={`badge ${tone}`}>Live</span></div><strong className="metric-value">{value}</strong>{detail ? <p className="muted">{detail}</p> : null}</article>;
}

export function LogViewer({ rows, field = 'line', empty = 'No rows returned.' }: { rows: any[]; field?: string; empty?: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return <div className="log-viewer">{rows.map((row, index) => <div className="log-line" key={row.id || index}><span>{row.createdAt || row.timestamp || 'event'}</span><span className="info">{row.level || row.type || 'info'}</span><span>{row[field] || row.message || row.line || JSON.stringify(row)}</span></div>)}</div>;
}
