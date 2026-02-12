import { safeGet, safePost } from './client';
import type { KiteHealthResponse, OHLCVResponse } from '@/types/api';

export type MarketDataAvailabilityResponse = {
  items: Array<{ symbol: string; first: string; last: string; count: number }>;
  totalSymbols: number;
};

export type LastCloseResponseItem = {
  symbol: string;
  timestamp: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

export type OptionGreeksMini = {
  option_type: string;
  expiry?: string | null;
  strike?: number | null;
  option_ltp?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  vega?: number | null;
  theta_per_day?: number | null;
};

export type FeatureSnapshotItem = LastCloseResponseItem & {
  india_vix?: number | null;
  pcr?: number | null;
  call_oi?: number | null;
  put_oi?: number | null;
  oi_change?: number | null;
  greeks_ce?: OptionGreeksMini | null;
  greeks_pe?: OptionGreeksMini | null;
};

export const marketDataApi = {
  kiteHealth: () => safeGet<KiteHealthResponse>('/market-data/kite-health'),
  ohlcv: (symbol: string, limit = 200, from?: string, to?: string, agg?: 'weekly' | 'monthly', fromTime?: string, toTime?: string, excludeNonTrading = true, excludeHolidays = true) => {
    const params = new URLSearchParams({ symbol: symbol, limit: String(limit) });
    if (from) params.set('from_', from);
    if (to) params.set('to', to);
    if (agg) params.set('agg', agg);
    if (fromTime) params.set('from_time', fromTime);
    if (toTime) params.set('to_time', toTime);
    if (excludeNonTrading) params.set('exclude_non_trading', 'true');
    if (excludeHolidays) params.set('exclude_holidays', 'true');
    return safeGet<OHLCVResponse>(`/market-data/ohlcv?${params.toString()}`);
  },
  fetch: (payload: { symbol: string; interval: 'minute' | '5minute' | '15minute' | 'day'; from_date: string; to_date: string }) => safePost<any>('/market-data/fetch', payload),
  batchFetch: (payload: { symbols: string[]; interval: string; from?: string; to?: string }) => safePost<any>('/market-data/batch-fetch', payload),
  refreshInstruments: () => safePost<any>('/market-data/refresh-instruments'),
  getAvailability: () => safeGet<MarketDataAvailabilityResponse>("/market-data/availability"),
  schedulerStatus: () => safeGet<any>("/market-data/scheduler/status"),
  schedulerRunNow: () => safePost<any>("/market-data/scheduler/run-now"),
  lastCloses: (symbols: string[], limit = 1000) => {
    const cleaned = (symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean);
    const params = new URLSearchParams();
    params.set('symbols', cleaned.join(','));
    params.set('limit', String(limit));
    return safeGet<LastCloseResponseItem[]>(`/market-data/last-closes?${params.toString()}`);
  },

  featureSnapshot: (symbols: string[], limit = 1000, includeOptions = false) => {
    const cleaned = (symbols || []).map((s) => (s || '').trim().toUpperCase()).filter(Boolean);
    const params = new URLSearchParams();
    params.set('symbols', cleaned.join(','));
    params.set('limit', String(limit));
    params.set('include_options', includeOptions ? 'true' : 'false');
    return safeGet<FeatureSnapshotItem[]>(`/market-data/feature-snapshot?${params.toString()}`);
  },
};
