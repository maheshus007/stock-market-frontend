"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOHLCV } from '@/lib/hooks/useOHLCV';
import { useMarketBrief } from '@/lib/hooks/useMarketBrief';
import { useSentiment } from '@/lib/hooks/useSentiment';
import { useRisk } from '@/lib/hooks/useRisk';
import { PriceChart, type RangeKey } from '@/components/PriceChart';
import { MetricCard } from '@/components/MetricCard';
import { fmt2 } from '@/lib/format';
import { orchestratorApi } from '@/lib/api/orchestrator';
import { useToast } from '@/components/Toast';
import { sentimentApi } from '@/lib/api/sentiment';
import { riskApi } from '@/lib/api/risk';
import Markdown from '@/components/Markdown';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { Copy, Check, Download } from 'lucide-react';
import OrchestratorSummary from '@/components/OrchestratorSummary';
import TradeSignal from '@/components/TradeSignal';
import { symbolsApi } from '@/lib/api/symbols';
import type { SymbolRef } from '@/types/api';
import { useQuery } from '@tanstack/react-query';
import { listSignals, type TradeSignalScreenerItem } from '@/lib/api/tradeSignal';
import Link from 'next/link';
import { getTradeSignalSettings, type TradeSignalSettings as TSSettings } from '@/lib/api/settings';
import { marketDataApi } from '@/lib/api/marketData';
import { useTodayLiveSeries, useTodayWindow } from '@/lib/hooks/useTodayLiveSeries';

export default function DashboardPage() {
  const [symbol, setSymbol] = useLocalStorage<string>('app:symbol', 'RELIANCE');
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefExpanded, setBriefExpanded] = useLocalStorage<boolean>(`briefExpanded:${symbol}`, false);
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sentBusy, setSentBusy] = useState(false);
  const [riskBusy, setRiskBusy] = useState(false);
  const { show } = useToast();
  const [query, setQuery] = useLocalStorage<string>('app:query', 'RELIANCE');
  const [suggestions, setSuggestions] = useState<SymbolRef[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const sugTimeout = useRef<number | null>(null);

  // Range selection for server-side filtering of OHLCV
  const [range, setRange] = useState<RangeKey>('1d');
  const [todayLive, setTodayLive] = useState(false);

  // If user navigates away from intraday range, disable live mode.
  useEffect(() => {
    if (range !== '1d' && todayLive) {
      setTodayLive(false);
    }
  }, [range, todayLive]);
  function computeRangeDates(r: RangeKey): { from?: string; to?: string } {
    const today = new Date();
    const to = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const daysMap: Record<RangeKey, number> = {
      '5y': 365 * 5,
      '3y': 365 * 3,
      '2y': 365 * 2,
      '1y': 365,
      '5m': 30 * 5,
      '3m': 30 * 3,
      '1m': 30,
      '2w': 14,
      '1w': 7,
      // "1d" should still include the last trading day even on weekends/holidays.
      // Fetch a small window and let the chart pick the latest candle.
      '1d': 14,
    };
    const days = daysMap[r] || 90;
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - days);
    const toStr = to.toISOString().slice(0, 10);
    const fromStr = from.toISOString().slice(0, 10);
    return { from: fromStr, to: toStr };
  }
  const { from, to } = computeRangeDates(range);
  function limitForRange(r: RangeKey): number {
    switch (r) {
      case '5y': return 1600; // ~320 trading days/year * 5
      case '3y': return 1000;
      case '2y': return 700;
      case '1y': return 360;
      case '5m': return 110; // monthly approx
      case '3m': return 70;
      case '1m': return 30;
      case '2w': return 14;
      case '1w': return 7;
      case '1d': return 500; // allow intraday candles
      default: return 200;
    }
  }
  function aggForRange(r: RangeKey): 'weekly' | 'monthly' | undefined {
    if (r === '1y') return 'weekly';
    if (r === '2y' || r === '3y' || r === '5y') return 'monthly';
    return undefined;
  }
  const agg = aggForRange(range);
  const fromTime = range === '1d' ? '09:15' : undefined;
  const toTime = range === '1d' ? '15:30' : undefined;
  // For 1d we want intraday series, so apply market-hours filtering.
  // For longer ranges, we avoid market-hours filtering because daily candles can be timestamped outside hours.
  const liveEnabled = range === '1d' && todayLive;
  const todayWindow = useTodayWindow(liveEnabled);
  const fromForOhlcv = liveEnabled && todayWindow ? todayWindow.fromOffset : from;
  const toForOhlcv = liveEnabled && todayWindow ? todayWindow.toOffset : to;
  const ohlcvQ = useOHLCV(symbol, limitForRange(range), fromForOhlcv, toForOhlcv, agg, fromTime, toTime, true, true);
  const todaySeries = useTodayLiveSeries(symbol, liveEnabled, todayWindow, ohlcvQ.data?.data, ohlcvQ.refetch);
  const chartData = useMemo(() => {
    if (liveEnabled) return todaySeries.data;
    return ohlcvQ.data?.data || [];
  }, [liveEnabled, todaySeries.data, ohlcvQ.data?.data]);
  const briefQ = useMarketBrief(symbol);
  const brief = briefQ.data;
  const sentimentQ = useSentiment(symbol, { refetchInterval: 180000, refetchOnWindowFocus: false });
  const riskQ = useRisk(symbol, { refetchInterval: 180000, refetchOnWindowFocus: false });

  const briefMd = brief?.data?.brief_markdown || '';
  function downloadBriefMd() {
    if (!briefMd) return;
    const created = brief?.data?.created_at || new Date().toISOString();
    const stamp = created.replace(/[:T]/g, '-').slice(0, 19);
    const filename = `${symbol}_market_brief_${stamp}.md`;
    const blob = new Blob([briefMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function generateBrief() {
    try {
      setBriefBusy(true);
      await orchestratorApi.runFullPipeline({ symbol, crawl: true });
      await briefQ.refetch();
      show('Market brief generated', 'success');
    } catch (e: any) {
      show(`Brief failed: ${e?.message || 'Unknown error'}`, 'error', 5000);
    } finally {
      setBriefBusy(false);
    }
  }

  async function refreshSentiment() {
    try {
      setSentBusy(true);
      await sentimentApi.analyzeSymbol(symbol);
      await sentimentQ.refetch();
      show('Sentiment updated', 'success');
    } catch (e: any) {
      show(`Sentiment failed: ${e?.message || 'Unknown error'}`, 'error', 5000);
    } finally {
      setSentBusy(false);
    }
  }

  async function refreshRisk() {
    try {
      setRiskBusy(true);
      await riskApi.evaluate({ symbol });
      await riskQ.refetch();
      show('Risk updated', 'success');
    } catch (e: any) {
      show(`Risk failed: ${e?.message || 'Unknown error'}`, 'error', 5000);
    } finally {
      setRiskBusy(false);
    }
  }

  useEffect(() => {
    if (sugTimeout.current) {
      clearTimeout(sugTimeout.current);
      sugTimeout.current = null;
    }
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    sugTimeout.current = window.setTimeout(async () => {
      try {
        const res = await symbolsApi.search(q, 10);
        const list = res?.data || [];
        setSuggestions(list);
        setActiveIdx(list.length ? 0 : -1);
      } catch {
        setSuggestions([]);
        setActiveIdx(-1);
      }
    }, 300);
    return () => {
      if (sugTimeout.current) {
        clearTimeout(sugTimeout.current);
        sugTimeout.current = null;
      }
    };
  }, [query]);
  useEffect(() => { setMounted(true); }, []);

  // Today backfill+merge is handled by useTodayLiveSeries

  const schedQ = useQuery({
    queryKey: ['scheduler-status'],
    queryFn: () => sentimentApi.schedulerStatus(),
    refetchInterval: 60000,
  });

  const last = schedQ.data?.data || null;
  const [schedBusy, setSchedBusy] = useState(false);

  // Trade Signal Screener
  const [screenDecision, setScreenDecision] = useState<'BUY' | 'SELL'>('BUY');
  const [binaryMode, setBinaryMode] = useState<boolean>(true);
  const [tsCfg, setTsCfg] = useState<TSSettings | null>(null);
  useEffect(() => { (async () => { try { const s = await getTradeSignalSettings(); setTsCfg(s); } catch {} })(); }, []);
  const screenerQ = useQuery({
    queryKey: ['ts-screener', screenDecision, binaryMode],
    queryFn: () => listSignals(screenDecision, 50, binaryMode ? 'binary' : 'ternary'),
    refetchInterval: 180000,
  });

  // Inline data availability summary (compact)
  const [availBusy, setAvailBusy] = useState(false);
  const [availShow, setAvailShow] = useState(false);
  const [avail, setAvail] = useState<{ items: Array<{ symbol: string; first: string; last: string; count: number }>; totalSymbols: number } | null>(null);
  const [availSort, setAvailSort] = useState<'recent' | 'count' | 'symbol'>('recent');
  async function loadAvail() {
    try {
      setAvailBusy(true);
      const res = await marketDataApi.getAvailability();
      if ((res as any)?.error) {
        // eslint-disable-next-line no-alert
        alert(`Failed: ${String((res as any).error)}`);
        return;
      }
      setAvail(res.data);
      setAvailShow(true);
    } finally {
      setAvailBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <input
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2"
            value={query}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setQuery(v);
              setShowSug(true);
            }}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (activeIdx >= 0 && activeIdx < suggestions.length) {
                  const sel = suggestions[activeIdx];
                  setSymbol(sel.ticker);
                  setQuery(sel.ticker);
                } else {
                  const v = query.trim();
                  if (v) setSymbol(v);
                }
                setShowSug(false);
              } else if (e.key === 'Escape') {
                setShowSug(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (suggestions.length) setActiveIdx((i) => (i + 1) % suggestions.length);
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (suggestions.length) setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
              }
            }}
            placeholder="Enter symbol (e.g., RELIANCE)"
          />
          {showSug && query.length >= 1 && suggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-gray-900 border border-gray-800 rounded shadow-lg">
              {suggestions.map((s, idx) => (
                <button
                  key={s.ticker}
                  onClick={() => {
                    setSymbol(s.ticker);
                    setQuery(s.ticker);
                    setShowSug(false);
                  }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-800 ${idx === activeIdx ? 'bg-gray-800' : ''}`}
                >
                  <div className="text-sm text-gray-100">{s.ticker}</div>
                  <div className="text-xs text-gray-400">{s.name}{s.sector ? ` • ${s.sector}` : ''}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {ohlcvQ.isLoading ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="card-title">Price (Close)</div>
              </div>
              <div className="flex items-center justify-center h-64">
                <svg className="animate-spin h-8 w-8 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                </svg>
              </div>
            </div>
          ) : ohlcvQ.data?.error ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="card-title">Price (Close)</div>
              </div>
              <div className="text-sm text-red-400">{String(ohlcvQ.data.error)}</div>
            </div>
          ) : (
            <PriceChart
              data={chartData || null}
              range={range}
              setRange={(r) => {
                setRange(r);
                if (r !== '1d') setTodayLive(false);
              }}
              serverAgg={agg}
              onToday={() => {
                setRange('1d');
                setTodayLive(true);
              }}
              todayActive={liveEnabled}
            />
          )}
        </div>
        <div className="space-y-4">
          <TradeSignal symbol={symbol} />
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="card-title">Sentiment</div>
              <button onClick={refreshSentiment} disabled={sentBusy} className={`px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 ${sentBusy ? 'opacity-60 cursor-not-allowed' : ''}`}>{sentBusy ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            <div className="mt-2 text-2xl font-bold">
              {sentimentQ?.isLoading ? '…' : (sentimentQ?.data?.error ? '—' : (sentimentQ?.data?.data?.result?.label ?? '—'))}
            </div>
            <div className="text-xs text-gray-500 mt-1">Score: {fmt2(sentimentQ?.data?.data?.result?.score as number)}</div>
            {sentimentQ?.data?.error && <div className="text-xs text-red-400 mt-1">{String(sentimentQ?.data?.error)}</div>}
          </div>
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="card-title">Risk</div>
              <button onClick={refreshRisk} disabled={riskBusy} className={`px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 ${riskBusy ? 'opacity-60 cursor-not-allowed' : ''}`}>{riskBusy ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            <div className="mt-2 text-2xl font-bold">
              {riskQ?.isLoading ? '…' : (riskQ?.data?.error ? '—' : (fmt2(riskQ?.data?.data?.snapshot?.risk_score as number)))}
            </div>
            <div className="text-xs text-gray-500 mt-1">{(riskQ?.data?.data?.snapshot?.volatility_regime || '—').toUpperCase()}</div>
            {riskQ?.data?.error && <div className="text-xs text-red-400 mt-1">{String(riskQ?.data?.error)}</div>}
          </div>
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="card-title">News Scheduler</div>
              <button
                onClick={async () => {
                  try {
                    setSchedBusy(true);
                    const res = await sentimentApi.crawlAndOrchestrate();
                    if (res.error) {
                      const msg = typeof res.error === 'string' ? res.error : (res.error?.detail || JSON.stringify(res.error));
                      show(`Cycle failed: ${msg}`, 'error', 6000);
                    } else {
                      show('Cycle completed', 'success');
                    }
                    await schedQ.refetch();
                  } finally {
                    setSchedBusy(false);
                  }
                }}
                disabled={schedBusy}
                className={`px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 ${schedBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
              >{schedBusy ? 'Running…' : 'Run Now'}</button>
            </div>
            <div className="text-xs text-gray-400 mt-1">{last?.timestamp ? `Last: ${last.timestamp}` : 'No run yet'}</div>
            {last && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-300">
                <div className="bg-gray-900/40 rounded px-2 py-2">
                  <div className="text-gray-400">Impacted</div>
                  <div className="font-semibold">{Array.isArray(last.impacted) ? last.impacted.length : 0}</div>
                </div>
                <div className="bg-gray-900/40 rounded px-2 py-2">
                  <div className="text-gray-400">Orchestrated</div>
                  <div className="font-semibold">{Array.isArray(last.orchestrated) ? last.orchestrated.length : 0}</div>
                </div>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-900/40 rounded px-2 py-2">
                <div className="text-gray-400 text-xs">Created</div>
                <div className="font-semibold">{last?.crawl?.created ?? 0}</div>
              </div>
              <div className="bg-gray-900/40 rounded px-2 py-2">
                <div className="text-gray-400 text-xs">Processed</div>
                <div className="font-semibold">{last?.crawl?.processed ?? 0}</div>
              </div>
              <div className="bg-gray-900/40 rounded px-2 py-2">
                <div className="text-gray-400 text-xs">Backfilled</div>
                <div className="font-semibold">{last?.backfill_updated ?? 0}</div>
              </div>
              <div className="bg-gray-900/40 rounded px-2 py-2">
                <div className="text-gray-400 text-xs">Orchestrated</div>
                <div className="font-semibold">{last?.orchestrated?.length ?? 0}</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs text-gray-400 mb-1">Impacted Symbols</div>
              {last?.impacted?.length ? (
                <div className="flex flex-wrap gap-1">
                  {last.impacted.slice(0, 20).map((t: string) => {
                    const label: string | undefined = last?.impact_sentiment?.[t];
                    const cls = label === 'negative'
                      ? 'bg-red-900/60 text-red-300 border border-red-700/50'
                      : label === 'positive'
                      ? 'bg-green-900/60 text-green-300 border border-green-700/50'
                      : label === 'neutral'
                      ? 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/50'
                      : 'bg-gray-800 text-gray-200';
                    return (
                      <span key={t} className={`px-2 py-0.5 text-xs rounded ${cls}`}>{t}</span>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-gray-500">None</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="card-title">Trade Signal Screener</div>
          <select className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-sm" value={screenDecision} onChange={(e) => setScreenDecision(e.target.value as 'BUY' | 'SELL')}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <label className="ml-2 inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={binaryMode} onChange={(e) => setBinaryMode(e.target.checked)} />
            Binary decisions
          </label>
          <button
            onClick={() => screenerQ.refetch()}
            className="ml-2 px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700"
            title="Refresh screener"
          >Refresh</button>
          <Link href="/settings" className="ml-2 px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700" title="View data availability">Data Availability</Link>
        </div>
        {screenerQ.isLoading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : (
          (() => {
            const items = screenerQ.data?.items || [];
            const count = items.length;
            const usingFallback = items.length > 0 && items.every((it: TradeSignalScreenerItem) => (it.ml_up == null) && (it.risk == null) && (!it.sentiment_label) && (it.rsi == null));
            if (!items.length) {
              return (
                <div className="text-sm text-gray-400">
                  No {screenDecision} signals found. Try seeding symbols in Settings and running ML/Sentiment/Risk pipelines.
                  <div className="mt-2">
                    <Link href="/settings" className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700 text-xs inline-block">Go to Settings → Admin Actions</Link>
                  </div>
                </div>
              );
            }
            return (
              <>
                {usingFallback && (
                  <div className="mb-2 text-xs text-yellow-300">
                    No recent data found — showing defaults from selected symbols. Seed symbols and run ML/Sentiment/Risk for richer signals.
                    <span className="ml-2">
                      <Link href="/settings" className="px-2 py-1 bg-yellow-900/40 border border-yellow-700/40 rounded hover:bg-yellow-800/40 text-xs inline-block">Seed Symbols</Link>
                    </span>
                  </div>
                )}
                <div className="mb-2 text-xs text-gray-400">Showing {count} items</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {items.map((it: TradeSignalScreenerItem) => {
                    const badgeClsActive = 'bg-green-900/60 text-green-300 border border-green-700/50';
                    const badgeClsInactive = 'bg-gray-800 text-gray-300 border border-gray-700/50';
                    const hasML = it.ml_up != null;
                    const hasRisk = it.risk != null;
                    const hasSent = !!it.sentiment_label;
                    const hasTech = it.rsi != null;
                    return (
                      <button key={it.ticker} onClick={() => { setSymbol(it.ticker); setQuery(it.ticker); }} className="bg-gray-900/40 rounded px-2 py-2 text-left hover:bg-gray-800 border border-gray-800">
                        <div className="font-semibold text-sm">{it.ticker}</div>
                        <div className="text-xs text-gray-400 truncate">{it.name}</div>
                        <div className="mt-1 text-xs text-gray-300">Conf: {it.confidence}%</div>
                        <div className="mt-2 flex items-center gap-1">
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${hasML ? badgeClsActive : badgeClsInactive}`}>ML</span>
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${hasRisk ? badgeClsActive : badgeClsInactive}`}>Risk</span>
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${hasSent ? badgeClsActive : badgeClsInactive}`}>Sent</span>
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${hasTech ? badgeClsActive : badgeClsInactive}`}>Tech</span>
                        </div>
                        {binaryMode && it.coerced && (
                          <div
                            className="mt-1 text-[10px] text-gray-400"
                            title={(() => {
                              const buy = tsCfg?.buy_threshold ?? 0.6;
                              const sell = tsCfg?.sell_threshold ?? 0.4;
                              const mid = ((buy + sell) / 2).toFixed(2);
                              const cap = tsCfg?.risk_cap ?? 0.3;
                              const minUp = tsCfg?.min_up_prob ?? 0.55;
                              if ((it.reason || '').includes('risk')) {
                                const r = (it.risk ?? null);
                                return `Coerced (risk > cap): risk=${r != null ? r.toFixed(2) : 'N/A'} cap=${cap}`;
                              }
                              return `Coerced via mid compare: buy=${buy} sell=${sell} mid=${mid} min_up=${minUp} cap=${cap}`;
                            })()}
                          >
                            Coerced: {it.reason || 'binary mode'}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()
        )}
      </div>

      {/* Inline Data Availability Summary */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="card-title">Data Availability (compact)</div>
          <div className="flex items-center gap-2">
            <select
              className="px-2 py-1 text-xs bg-gray-900 border border-gray-800 rounded"
              value={availSort}
              onChange={(e) => setAvailSort(e.target.value as 'recent' | 'count' | 'symbol')}
              title="Sort"
            >
              <option value="recent">Most Recent</option>
              <option value="count">Highest Count</option>
              <option value="symbol">Symbol A→Z</option>
            </select>
            <button onClick={loadAvail} disabled={availBusy} className={`px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700 ${availBusy ? 'opacity-60 cursor-not-allowed' : ''}`}>{availBusy ? 'Loading…' : 'Show'}</button>
            {availShow && <button onClick={() => setAvailShow(false)} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">Hide</button>}
          </div>
        </div>
        {availShow && avail ? (
          <div>
            <div className="text-xs text-gray-400 mb-1">Symbols: {avail.totalSymbols}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {[...avail.items]
                  .sort((a, b) => {
                    if (availSort === 'recent') {
                      return new Date(b.last).getTime() - new Date(a.last).getTime();
                    }
                    if (availSort === 'count') {
                      return (b.count || 0) - (a.count || 0);
                    }
                    return a.symbol.localeCompare(b.symbol);
                  })
                  .slice(0, 9)
                  .map((it) => (
                <div key={it.symbol} className="bg-gray-900/40 rounded px-2 py-2 border border-gray-800">
                  <div className="font-semibold text-sm">{it.symbol}</div>
                  <div className="text-xs text-gray-400">{new Date(it.first).toLocaleDateString()} → {new Date(it.last).toLocaleDateString()}</div>
                  <div className="text-xs text-gray-300">Count: {it.count}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-gray-400">Showing up to 9 items. Full list in Settings → Data Availability.</div>
            <div className="mt-2">
              <Link href="/settings?availability=1" className="px-2 py-1 bg-gray-800 rounded hover:bg-gray-700 text-xs inline-block">View All →</Link>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400">Click Show to view a compact summary of available symbols and date ranges.</div>
        )}
      </div>
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="card-title">Market Brief</div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadBriefMd}
              disabled={!briefMd}
              title="Download brief as Markdown"
              className={`px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700 flex items-center gap-1 ${!briefMd ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <Download size={14} />
              Download
            </button>
            <button
              onClick={async () => {
                if (!briefMd) return;
                try { await navigator.clipboard.writeText(briefMd); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
              }}
              title="Copy brief to clipboard"
              className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700 flex items-center gap-1"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => setBriefExpanded(v => !v)} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700"><span suppressHydrationWarning>{mounted ? (briefExpanded ? 'Collapse' : 'Read more') : 'Read more'}</span></button>
            <button onClick={generateBrief} disabled={briefBusy} className={`px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 ${briefBusy ? 'opacity-60 cursor-not-allowed' : ''}`}>
              {briefBusy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-400 mb-2">{brief?.data?.created_at ? `Created: ${brief.data.created_at}` : ''}</div>
        <OrchestratorSummary metadata={brief?.data?.metadata as any} />
        {briefMd ? (
          <Markdown content={briefExpanded ? briefMd : (briefMd.split(/\n\s*\n/)[0] || briefMd)} className={`prose prose-invert max-w-none text-sm transition-all duration-200`} />
        ) : (
          <div className="text-gray-400 text-sm">No brief yet.</div>
        )}
      </div>
    </div>
  );
}
