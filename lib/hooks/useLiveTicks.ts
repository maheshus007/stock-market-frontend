"use client";

import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api/client';
import type { OHLCVBar } from '@/types/api';

type TicksMessage = {
  type: 'ticks';
  received_at?: string;
  ticks?: Array<Record<string, any>>;
};

function toWsUrl(apiBase: string, pathWithQuery: string): string {
  const trimmed = (apiBase || '').trim().replace(/\/$/, '');

  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}${pathWithQuery}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}${pathWithQuery}`;

  // Fallback: treat as already ws(s) or host.
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return `${trimmed}${pathWithQuery}`;
  return `ws://${trimmed}${pathWithQuery}`;
}

export function useLiveTicks(symbol: string, enabled: boolean) {
  const [points, setPoints] = useState<OHLCVBar[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const lastEmitMsRef = useRef<number>(0);

  useEffect(() => {
    const cleanup = () => {
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };

    if (!enabled) {
      cleanup();
      setPoints([]);
      return;
    }

    const sym = (symbol || '').trim().toUpperCase();
    if (!sym) {
      cleanup();
      setPoints([]);
      return;
    }

    // Reset series on (re)connect.
    setPoints([]);
    lastEmitMsRef.current = 0;

    const path = `/market-data/ws/ticks?symbols=${encodeURIComponent(sym)}&mode=ltp`;
    const wsUrl = toWsUrl(API_BASE, path);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      let msg: TicksMessage | null = null;
      try {
        msg = JSON.parse(String(evt.data));
      } catch {
        return;
      }

      if (!msg || msg.type !== 'ticks') return;
      const ticks = Array.isArray(msg.ticks) ? msg.ticks : [];
      if (!ticks.length) return;

      // In dashboard we typically subscribe to a single symbol.
      const tick = ticks[0] || {};
      const lpRaw = (tick as any).last_price;
      const lp = typeof lpRaw === 'number' ? lpRaw : Number(lpRaw);
      if (!Number.isFinite(lp)) return;

      const nowMs = Date.now();
      // Throttle updates to keep chart performant.
      if (nowMs - lastEmitMsRef.current < 1000) return;
      lastEmitMsRef.current = nowMs;

      const tsIso = typeof msg.received_at === 'string' ? msg.received_at : new Date().toISOString();
      const bar: OHLCVBar = {
        timestamp: tsIso,
        open: lp,
        high: lp,
        low: lp,
        close: lp,
        volume: null as any,
      };

      setPoints((prev) => {
        const next = prev.concat(bar);
        // Keep enough points for a full market session.
        // At ~1 point/sec throttle, NSE cash market is ~6h15m => ~22,500 points.
        // Keep a bit more to be safe (reconnect bursts, pre/post market, etc.).
        const MAX_POINTS = 30000;
        if (next.length > MAX_POINTS) return next.slice(next.length - MAX_POINTS);
        return next;
      });
    };

    ws.onerror = () => {
      // Best-effort: UI will just stop updating.
    };

    ws.onclose = () => {
      // No reconnect loop here to avoid noisy behavior.
    };

    return () => {
      cleanup();
      setPoints([]);
    };
  }, [symbol, enabled]);

  return points;
}
