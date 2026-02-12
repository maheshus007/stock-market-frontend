import './globals.css';
import { ReactNode } from 'react';
import Layout from '@/components/Layout';
import AppProviders from '@/components/AppProviders';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          <Layout>
            {children}
          </Layout>
        </AppProviders>
      </body>
    </html>
  );
}
