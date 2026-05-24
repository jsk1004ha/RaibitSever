import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function unauthorizedResponse() {
  return new NextResponse('Dashboard admin authentication required.', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="RAIBITSERVER Admin"' },
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
  if (!configured) {
    return new NextResponse('Set RAIBITSERVER_DASHBOARD_BASIC_AUTH to protect /admin.', { status: 503 });
  }
  const credentials = parseBasicHeader(request.headers.get('authorization'));
  if (!credentials || credentials !== configured) return unauthorizedResponse();
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
