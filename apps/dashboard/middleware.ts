import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function unauthorizedResponse() {
  return new NextResponse('Dashboard admin authentication required.', {
    status: 401,
    headers: hardeningHeaders({ 'www-authenticate': 'Basic realm="RAIBITSERVER Dashboard"' }),
  });
}

function parseBasicHeader(header: string | null) {
  if (!header || !header.startsWith('Basic ')) return null;
  const encoded = header.slice('Basic '.length).trim();
  try {
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const configured = process.env.RAIBITSERVER_DASHBOARD_BASIC_AUTH;
  const hasServerApiToken = Boolean(process.env.RAIBITSERVER_DASHBOARD_TOKEN || process.env.RAIBITSERVER_TOKEN);
  if (!configured) {
    const path = request.nextUrl.pathname;
    if (!hasServerApiToken && path !== '/admin' && !path.startsWith('/admin/')) return NextResponse.next();
    return new NextResponse('Set RAIBITSERVER_DASHBOARD_BASIC_AUTH to protect dashboard server-side API token access.', { status: 503, headers: hardeningHeaders() });
  }
  const credentials = parseBasicHeader(request.headers.get('authorization'));
  if (!credentials || credentials !== configured) return unauthorizedResponse();
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(hardeningHeaders())) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

function hardeningHeaders(extra: Record<string, string> = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    ...extra,
  };
}
