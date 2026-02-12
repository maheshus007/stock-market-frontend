"use client";
import { ReactNode, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ToastProvider } from '@/components/Toast';

export default function AppProviders({ children }: { children: ReactNode }) {
  // Migrate old localStorage keys to unified keys to avoid default RELIANCE
  useEffect(() => {
    try {
      const ds = window.localStorage.getItem('dashboard:symbol');
      const dq = window.localStorage.getItem('dashboard:query');
      const as = window.localStorage.getItem('app:symbol');
      const aq = window.localStorage.getItem('app:query');
      if (!as && ds) window.localStorage.setItem('app:symbol', ds);
      if (!aq && dq) window.localStorage.setItem('app:query', dq);
    } catch {}
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
