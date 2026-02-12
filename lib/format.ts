export function fmt2(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  if (Number.isNaN(value) || !Number.isFinite(value)) return fallback;
  try {
    return value.toFixed(2);
  } catch {
    return fallback;
  }
}

export function formatISTDateTime(ts: string | number | Date): string {
  try {
    const d = typeof ts === 'string' ? new Date(ts) : new Date(ts as any);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(d);
  } catch {
    try {
      return new Date(Number(ts)).toLocaleString('en-IN');
    } catch {
      return String(ts);
    }
  }
}
