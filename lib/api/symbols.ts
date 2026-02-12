import { safeGet, safePost, safePut } from './client';
import type { SymbolRef } from '@/types/api';

export const symbolsApi = {
  search: (q: string, limit = 10) => safeGet<SymbolRef[]>(`/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  seed: (symbols?: SymbolRef[], upsert = false) =>
    safePost<{ inserted_count: number; updated_count: number; inserted: string[]; updated: string[] }>(
      `/symbols/seed`,
      symbols ? { symbols, upsert } : { upsert }
    ),
  seedPreset: (preset: string, upsert = false) =>
    safePost<{ inserted_count: number; updated_count: number; inserted: string[]; updated: string[] }>(
      `/symbols/seed`,
      { preset, upsert }
    ),
  all: (limit = 100) => safeGet<SymbolRef[]>(`/symbols/all?limit=${limit}`),
  update: (ticker: string, payload: { name: string; sector: string | null }) =>
    safePut<SymbolRef>(`/symbols/${encodeURIComponent((ticker || '').trim().toUpperCase())}`, payload),
  bulkDelete: (tickers: string[]) =>
    safePost<{ deleted: string[]; not_found: string[]; counts: Record<string, number> }>(`/symbols/delete`, { tickers }),
  delete: (tickers: string[]) =>
    safePost<{ deleted: string[]; not_found: string[]; counts: Record<string, number> }>(`/symbols/delete`, { tickers }),
};
