import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'RAIBITSERVER',
  description: 'Container-first PaaS + DBaaS for clubs, schools, and small teams.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
