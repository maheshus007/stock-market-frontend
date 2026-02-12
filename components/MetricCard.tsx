import React from 'react';
import { fmt2 } from '@/lib/format';

type Props = {
  title: string;
  value: string | number | null | undefined;
  hint?: string;
  loading?: boolean;
  error?: string | null;
};

export function MetricCard({ title, value, hint, loading, error }: Props) {
  return (
    <div className="card p-4">
      <div className="card-title">{title}</div>
      <div className="mt-2 text-2xl font-bold">
        {loading ? '…' : error ? '—' : (typeof value === 'number' ? fmt2(value) : (value ?? '—'))}
      </div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
      {error && <div className="text-xs text-red-400 mt-1">{String(error)}</div>}
    </div>
  );
}
