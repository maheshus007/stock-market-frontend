"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OHLCVBar, OHLCVResponse } from '@/types/api';
import { marketDataApi } from '@/lib/api/marketData';
import { useLiveTicks } from '@/lib/hooks/useLiveTicks';

export type TodayWindow = {
  fromOffset: string;
  toOffset: string;
  fetchFromZ: string;
  fetchToZ: string;
  key: string;
};

export function computeTodayWindow(): TodayWindow {
  // Market opens 09:15 IST, which is 03:45 UTC (IST is fixed +5:30).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const y = Number(parts.find(p => p.type === 'year')?.value);
  const m = Number(parts.find(p => p.type === 'month')?.value);
  const d = Number(parts.find(p => p.type === 'day')?.value);

  const openUtcMs = Date.UTC(y, m - 1, d, 3, 45, 0);
  const fromDate = new Date(openUtcMs);
  const toDate = new Date();

  // /market-data/ohlcv uses datetime.fromisoformat, which does NOT accept trailing 'Z'.
  const fromOffset = fromDate.toISOString().replace('Z', '+00:00');
  const toOffset = toDate.toISOString().replace('Z', '+00:00');

  // /market-data/fetch is Pydantic datetime and accepts 'Z'.
  const fetchFromZ = fromDate.toISOString();
  const fetchToZ = toDate.toISOString();

  // Key should be stable per day (IST) so we can avoid spamming backfill.
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return { fromOffset, toOffset, fetchFromZ, fetchToZ, key };
}

export function useTodayWindow(enabled: boolean) {
  const [todayWindow, setTodayWindow] = useState<TodayWindow | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTodayWindow(null);
      return;
    }

    // Compute immediately, then keep updating the end timestamp.
    // Without this, the dashboard can get "stuck" showing only the data available
    // at the moment live mode was enabled (e.g., 09:15–10:00).
    setTodayWindow(computeTodayWindow());
    const id: ReturnType<typeof setInterval> = globalThis.setInterval(() => {
      setTodayWindow(computeTodayWindow());
    }, 30_000);
    return () => {
      globalThis.clearInterval(id);
    };
  }, [enabled]);

  return todayWindow;
}

export function useTodayLiveSeries(
  symbol: string,
  enabled: boolean,
  window: TodayWindow | null,
  baseSeries: OHLCVBar[] | null | undefined,
  refetchBase: () => Promise<any>,
) {
  const [backfillError, setBackfillError] = useState<any>(null);
  const lastBackfillRef = useRef<{ symbol: string; key: string; atMs: number } | null>(null);

  const livePoints = useLiveTicks(symbol, enabled);

  useEffect(() => {
    if (!enabled || !symbol || !window) {
      setBackfillError(null);
      return;
    }

    const nowMs = Date.now();
    const last = lastBackfillRef.current;
    const shouldRun = !last || last.symbol !== symbol || last.key !== window.key || (nowMs - last.atMs) > 60_000;
    if (!shouldRun) return;

    lastBackfillRef.current = { symbol, key: window.key, atMs: nowMs };

    (async () => {
      try {
        const resp = await marketDataApi.fetch({
          symbol,
          interval: '5minute',
          from_date: window.fetchFromZ,
          to_date: window.fetchToZ,
        });
        if (resp?.error) {
          setBackfillError(resp.error);
        } else {
          setBackfillError(null);
        }
      } catch (e: any) {
        setBackfillError(e);
      }

      await refetchBase();
    })();
  }, [enabled, symbol, window, refetchBase]);

  const data = useMemo<OHLCVResponse>(() => {
    const base = (baseSeries || []) as OHLCVBar[];
    if (!enabled) return base;
    if (!livePoints.length) return base;

    const merged = base.concat(livePoints);
    merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return merged;
  }, [baseSeries, enabled, livePoints]);

  return { data, backfillError };
}
