
"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { listSignals } from '@/lib/api/tradeSignal';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { queryClient } from '@/lib/queryClient';
import { marketDataApi } from '@/lib/api/marketData';
import { technicalApi } from '@/lib/api/technical';
import { mlApi } from '@/lib/api/ml';
import { sentimentApi } from '@/lib/api/sentiment';
import { riskApi } from '@/lib/api/risk';
import { useToast } from '@/components/Toast';
import { useOHLCV } from '@/lib/hooks/useOHLCV';
import { useTechnicalAnalysis } from '@/lib/hooks/useTechnicalAnalysis';
import { useMLPrediction } from '@/lib/hooks/useMLPrediction';
import { useSentiment } from '@/lib/hooks/useSentiment';
import { useRisk } from '@/lib/hooks/useRisk';
import { PriceChart } from '@/components/PriceChart';
import { MetricCard } from '@/components/MetricCard';
import { fmt2 } from '@/lib/format';
import { useMarketBrief } from '@/lib/hooks/useMarketBrief';
import { orchestratorApi } from '@/lib/api/orchestrator';
import { symbolsApi } from '@/lib/api/symbols';
import type { SymbolRef } from '@/types/api';
import TradeSignal from '@/components/TradeSignal';
import { useTodayLiveSeries, useTodayWindow } from '@/lib/hooks/useTodayLiveSeries';
import Markdown from '@/components/Markdown';


export default function SymbolsPage() {
  // Trade Signal Screener state
  const [screenerType, setScreenerType] = useState<'ALL' | 'BUY' | 'SELL' | 'HOLD'>('ALL');
  const [screenerData, setScreenerData] = useState<any[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerError, setScreenerError] = useState<string | null>(null);
  const [symbol, setSymbol] = useLocalStorage<string>('app:symbol', '');
  const [query, setQuery] = useLocalStorage<string>('app:query', '');
  const [range, setRange] = useState<'5y' | '3y' | '2y' | '1y' | '5m' | '3m' | '1m' | '2w' | '1w' | '1d'>('1d');
  const [todayLive, setTodayLive] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [suggestions, setSuggestions] = useState<SymbolRef[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const sugTimeout = useRef<number | null>(null);
  const [windowBars, setWindowBars] = useState<number>(50);
  // Range-aware OHLCV query (1d uses intraday data)
  function computeRangeDates(r: typeof range): { from?: string; to?: string } {
    const today = new Date();
    const toDt = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const daysMap: Record<typeof range, number> = {
      '5y': 365 * 5,
      '3y': 365 * 3,
      '2y': 365 * 2,
      '1y': 365,
      '5m': 30 * 5,
      '3m': 30 * 3,
      '1m': 30,
      '2w': 14,
      '1w': 7,
      '1d': 14,
    };
    const fromDt = new Date(toDt);
    fromDt.setUTCDate(fromDt.getUTCDate() - (daysMap[r] || 90));
    return { from: fromDt.toISOString().slice(0, 10), to: toDt.toISOString().slice(0, 10) };
  }
  function limitForRange(r: typeof range): number {
    switch (r) {
      case '5y': return 1600;
      case '3y': return 1000;
      case '2y': return 700;
      case '1y': return 360;
      case '5m': return 200;
      case '3m': return 200;
      case '1m': return 200;
      case '2w': return 200;
      case '1w': return 200;
      case '1d': return 500;
      default: return 200;
    }
  }
  function aggForRange(r: typeof range): 'weekly' | 'monthly' | undefined {
    if (r === '1y') return 'weekly';
    if (r === '2y' || r === '3y' || r === '5y') return 'monthly';
    return undefined;
  }
  const { from, to } = computeRangeDates(range);
  const agg = aggForRange(range);
  const fromTime = range === '1d' ? '09:15' : undefined;
  const toTime = range === '1d' ? '15:30' : undefined;

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

  // If user navigates away from intraday range, disable live mode.
  useEffect(() => {
    if (range !== '1d' && todayLive) {
      setTodayLive(false);
    }
  }, [range, todayLive]);
  const techQ = useTechnicalAnalysis(symbol, windowBars);
  const mlQ = useMLPrediction(symbol, 60);
  const sentimentQ = useSentiment(symbol);
  const riskQ = useRisk(symbol);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const briefQ = useMarketBrief(symbol, false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefMaximized, setBriefMaximized] = useState(false);
  const [sentBusy, setSentBusy] = useState(false);
  const [riskBusy, setRiskBusy] = useState(false);
  const { show } = useToast();

  function formatBriefMarkdown(md: string): string {
    if (!md) return '';
    return md
      .split(/\r?\n/)
      .map((line) => {
        const m = /^##\s*(.+)\s*$/.exec(line);
        if (!m) return line;
        return `**${m[1]}**`;
      })
      .join('\n');
  }

  // Fetch all symbols, BUY and SELL signals, merge, and mark missing as HOLD
  useEffect(() => {
    let mounted = true;
    async function fetchScreener() {
      setScreenerLoading(true);
      setScreenerError(null);
      try {
        const [buyRes, sellRes, allSymsRes] = await Promise.all([
          listSignals('BUY', 200, 'ternary'),
          listSignals('SELL', 200, 'ternary'),
          symbolsApi.all(500),
        ]);
        const buyMap = new Map((buyRes.items || []).map(item => [item.ticker, { ...item, decision: 'BUY' }]));
        const sellMap = new Map((sellRes.items || []).map(item => [item.ticker, { ...item, decision: 'SELL' }]));
        const allSyms = allSymsRes.data || [];
        const merged = allSyms.map((sym: any) => {
          if (buyMap.has(sym.ticker)) return buyMap.get(sym.ticker);
          if (sellMap.has(sym.ticker)) return sellMap.get(sym.ticker);
          // HOLD: minimal info
          return {
            ticker: sym.ticker,
            name: sym.name,
            decision: 'HOLD',
            confidence: null,
            ml_up: null,
            risk: null,
            sentiment_label: null,
            rsi: null,
            coerced: false,
            reason: null,
          };
        });
        if (mounted) setScreenerData(merged);
      } catch (e: any) {
        if (mounted) setScreenerError(e?.message || 'Failed to load screener');
      } finally {
        if (mounted) setScreenerLoading(false);
      }
    }
    fetchScreener();
    return () => { mounted = false; };
  }, []);

  // Filtered screener data
  const filteredScreener = useMemo(() => {
    if (screenerType === 'ALL') return screenerData;
    return screenerData.filter((row) => row.decision === screenerType);
  }, [screenerData, screenerType]);

  // On mount, ensure the selected symbol is a BUY signal; if not, auto-select the first BUY stock
  useEffect(() => {
    let isMounted = true;
    async function ensureBuySymbol() {
      // Fetch the current trade signal for the selected symbol
      let isBuy = false;
      if (symbol) {
        try {
          const res = await listSignals('BUY', 100, 'binary');
          isBuy = res?.items?.some((item: any) => item.ticker === symbol);
        } catch {}
      }
      if (!symbol || !isBuy) {
        try {
          const res = await listSignals('BUY', 1, 'binary');
          const first = res?.items?.[0]?.ticker;
          if (first && isMounted) {
            setSymbol(first);
            setQuery(first);
          }
        } catch {}
      }
    }
    ensureBuySymbol();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAllSignals() {
    setRunning(true);
    setRunMsg('Fetching market data…');
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      await marketDataApi.fetch({ symbol, interval: 'day', from_date: `${fromStr}T00:00:00Z`, to_date: `${toStr}T00:00:00Z` });
      setRunMsg('Computing technicals…');
      await technicalApi.analyze({ symbol, window: windowBars });
      setRunMsg('Running ML prediction…');
      await mlApi.predict({ symbol, horizon_minutes: 60 });
      setRunMsg('Analyzing sentiment…');
      await sentimentApi.analyzeSymbol(symbol);
      setRunMsg('Evaluating risk…');
      await riskApi.evaluate({ symbol });

      // Invalidate queries to refresh UI
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ohlcv', symbol] }),
        queryClient.invalidateQueries({ queryKey: ['technical', symbol, windowBars] }),
        queryClient.invalidateQueries({ queryKey: ['ml-predict', symbol] }),
        queryClient.invalidateQueries({ queryKey: ['sentiment', symbol] }),
        queryClient.invalidateQueries({ queryKey: ['risk', symbol] }),
      ]);
      setRunMsg('All signals updated');
      show('All signals updated', 'success');
    } catch (e: any) {
      const msg = `Failed: ${e?.message || 'Unknown error'}`;
      setRunMsg(msg);
      show(msg, 'error', 5000);
    } finally {
      setTimeout(() => setRunMsg(null), 4000);
      setRunning(false);
    }
  }

  // Today backfill+merge is handled by useTodayLiveSeries

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
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="relative w-64">
          <input
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2"
            value={query}
            onChange={(e) => { const v = e.target.value.toUpperCase(); setQuery(v); setShowSug(true); }}
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
                  onClick={() => { setSymbol(s.ticker); setQuery(s.ticker); setShowSug(false); }}
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
        <select
          className="bg-gray-900 border border-gray-800 rounded px-2 py-2 text-sm"
          value={windowBars}
          onChange={(e) => setWindowBars(Number(e.target.value))}
          title="Technical window"
        >
          <option value={50}>50 bars</option>
          <option value={100}>100 bars</option>
          <option value={200}>200 bars</option>
        </select>
        <button onClick={runAllSignals} disabled={running} className={`px-3 py-2 bg-brand rounded hover:bg-brand-dark ${running ? 'opacity-60 cursor-not-allowed' : ''}`}>
          {running ? 'Running…' : 'Run All Signals'}
        </button>
      </div>
      {runMsg && (
        <div className="text-xs text-gray-400">{runMsg}</div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="card-title">Market Brief</div>
          <button onClick={generateBrief} disabled={briefBusy} className={`px-2 py-1 text-xs bg-gray-700 rounded hover:bg-gray-600 ${briefBusy ? 'opacity-60 cursor-not-allowed' : ''}`}>
            {briefBusy ? 'Generating…' : 'Generate'}
          </button>
          <button onClick={() => setBriefMaximized(v => !v)} className="ml-2 px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">
            {briefMaximized ? 'Minimize' : 'Maximize'}
          </button>
        </div>
        <div className="text-xs text-gray-400 mb-2">{briefQ.data?.data?.created_at ? `Created: ${briefQ.data.data.created_at}` : 'No brief yet.'}</div>
        {(() => {
          const meta = (briefQ.data?.data as any)?.metadata || {};
          const rows: Array<[string, any]> = [
            ['Latest Live Price', meta.latest_live_price],
            ['Trade Action', meta.trade_action],
            ['Stop Loss', meta.trade_stop_loss],
            ['Take Profit', meta.trade_take_profit],
            ['Predicted High', meta.trade_predicted_high],
            ['Risk Score', meta.risk_score],
            ['Sentiment', meta.sentiment],
            ['OHLCV Points', meta.latest_ohlcv_points],
            ['Technical Points', meta.technical_points],
            ['ML Predictions', meta.ml_predictions],
            ['ML Model', meta.ml_model_selected],
            ['Runtime (ms)', meta.runtime_ms],
            ['Interval', meta.interval],
            ['From', meta.from],
            ['To', meta.to],
          ];
          const hasAny = rows.some(([, v]) => v !== undefined && v !== null && String(v).length > 0);
          if (!hasAny) return null;
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-300 mb-3">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <div className="text-gray-500">{k}</div>
                  <div className="text-right">{(v === undefined || v === null || String(v).length === 0) ? '—' : String(v)}</div>
                </div>
              ))}
            </div>
          );
        })()}

        <div className={`text-sm ${briefMaximized ? 'max-h-[70vh] overflow-auto' : 'max-h-40 overflow-hidden'}`}>
          <Markdown
            className="prose prose-invert max-w-none"
            content={formatBriefMarkdown(briefQ.data?.data?.brief_markdown || '')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {ohlcvQ.isLoading ? (
            <div className="flex items-center justify-center h-64">
              <svg className="animate-spin h-8 w-8 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
              </svg>
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
          {/* Trade Signal Screener Table */}
          {/* Trade Signal Screener with Maximize */}
          <ScreenerWithMaximize
            screenerType={screenerType}
            setScreenerType={setScreenerType}
            screenerLoading={screenerLoading}
            screenerError={screenerError}
            filteredScreener={filteredScreener}
            setSymbol={setSymbol}
            setQuery={setQuery}
          />
          {/* Existing TradeSignal and metrics */}
          <TradeSignal symbol={symbol} />
          {(() => {
            const snapshots = techQ?.data?.data?.snapshots || [];
            const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
            const recent = snapshots.slice(-25);
            const lastPA = [...recent].reverse().find((s: any) => s?.price_action) || null;
            const lastPattern = [...recent].reverse().find((s: any) => s?.chart_pattern) || null;
            const macdHist = latest && latest.macd != null && latest.macd_signal != null ? (latest.macd - latest.macd_signal) : null;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 pt-1 text-xs text-gray-400">Momentum</div>
                <MetricCard title="RSI" value={latest?.rsi ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <MetricCard title="ADX" value={latest?.adx ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <div className="sm:col-span-2">
                  <MetricCard
                    title="MACD"
                    value={latest?.macd ?? null}
                    hint={`Signal: ${fmt2(latest?.macd_signal as number)}${macdHist != null ? ` | Hist: ${fmt2(macdHist)}` : ''}`}
                    loading={techQ?.isLoading}
                    error={techQ?.data?.error as any}
                  />
                </div>

                <div className="sm:col-span-2 pt-1 text-xs text-gray-400">Trend</div>
                <MetricCard title="Supertrend" value={latest?.supertrend ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <MetricCard title="EMA 9" value={(latest as any)?.ema_9 ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <MetricCard title="EMA 21" value={(latest as any)?.ema_21 ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <MetricCard title="VWAP" value={(latest as any)?.vwap ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />

                <div className="sm:col-span-2 pt-1 text-xs text-gray-400">Moving Averages</div>
                <MetricCard title="SMA 20" value={(latest as any)?.sma_20 ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <MetricCard title="SMA 50" value={(latest as any)?.sma_50 ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <div className="sm:col-span-2">
                  <MetricCard
                    title="SMA 200"
                    value={(latest as any)?.sma_200 ?? null}
                    hint={snapshots.length < 200 ? `Need ≥200 candles (have ${snapshots.length}). Set window to 200.` : undefined}
                    loading={techQ?.isLoading}
                    error={techQ?.data?.error as any}
                  />
                </div>

                <div className="sm:col-span-2 pt-1 text-xs text-gray-400">Levels &amp; Volume</div>
                <MetricCard title="Support" value={(latest as any)?.support ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <MetricCard title="Resistance" value={(latest as any)?.resistance ?? null} loading={techQ?.isLoading} error={techQ?.data?.error as any} />
                <div className="sm:col-span-2">
                  <MetricCard
                    title="Volume Ratio"
                    value={(latest as any)?.volume_ratio ?? null}
                    hint={(latest as any)?.volume_sma_20 != null ? `Vol SMA20: ${fmt2((latest as any)?.volume_sma_20)}` : undefined}
                    loading={techQ?.isLoading}
                    error={techQ?.data?.error as any}
                  />
                </div>

                <div className="sm:col-span-2 pt-1 text-xs text-gray-400">Signals</div>
                <div className="sm:col-span-2">
                  <MetricCard
                    title="Price Action"
                    value={(latest as any)?.price_action ?? (lastPA as any)?.price_action ?? null}
                    hint={(latest as any)?.price_action ? undefined : ((lastPA as any)?.price_action ? 'Last seen in recent candles' : 'None detected in recent candles')}
                    loading={techQ?.isLoading}
                    error={techQ?.data?.error as any}
                  />
                </div>
                <div className="sm:col-span-2">
                  <MetricCard
                    title="Chart Pattern"
                    value={(latest as any)?.chart_pattern ?? (lastPattern as any)?.chart_pattern ?? null}
                    hint={(latest as any)?.chart_pattern ? undefined : ((lastPattern as any)?.chart_pattern ? 'Last seen in recent candles' : 'None detected in recent candles')}
                    loading={techQ?.isLoading}
                    error={techQ?.data?.error as any}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(() => {
          const latest = mlQ?.data?.data?.predictions?.[0];
          const direction = (latest?.direction_prob_up ?? 0) >= 0.5 ? 'up' : 'down';
          return (
            <>
              <MetricCard title="Prediction" value={latest ? direction : '—'} hint={`P(up): ${fmt2(latest?.direction_prob_up ?? 0)}`} loading={mlQ?.isLoading} error={mlQ?.data?.error as any} />
              <MetricCard title="Volatility" value={latest?.volatility ?? null} loading={mlQ?.isLoading} error={mlQ?.data?.error as any} />
              <MetricCard title="Anomaly Score" value={latest?.anomaly_score ?? null} loading={mlQ?.isLoading} error={mlQ?.data?.error as any} />
            </>
          );
        })()}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
      </div>
    </div>
  );
}

type ScreenerDecision = 'ALL' | 'BUY' | 'SELL' | 'HOLD';

type ScreenerRow = {
  ticker: string;
  name?: string | null;
  decision: Exclude<ScreenerDecision, 'ALL'>;
  confidence?: number | null;
  ml_up?: number | null;
  risk?: number | null;
  sentiment_label?: string | null;
  rsi?: number | null;
  reason?: string | null;
};

type ScreenerWithMaximizeProps = {
  screenerType: ScreenerDecision;
  setScreenerType: (value: ScreenerDecision) => void;
  screenerLoading: boolean;
  screenerError: string | null;
  filteredScreener: ScreenerRow[];
  setSymbol: (value: string) => void;
  setQuery: (value: string) => void;
};

function ScreenerWithMaximize({
  screenerType,
  setScreenerType,
  screenerLoading,
  screenerError,
  filteredScreener,
  setSymbol,
  setQuery,
}: ScreenerWithMaximizeProps) {
  const [maximized, setMaximized] = useState(false);

  type SortKey =
    | 'ticker'
    | 'name'
    | 'decision'
    | 'confidence'
    | 'ml_up'
    | 'risk'
    | 'sentiment_label'
    | 'rsi'
    | 'reason';

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function toggleSort(key: SortKey) {
    if (!maximized) return;
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }

  function compareNullable(a: any, b: any): number {
    const aNil = a == null;
    const bNil = b == null;
    if (aNil && bNil) return 0;
    if (aNil) return 1;
    if (bNil) return -1;

    const toMaybeNumber = (v: any): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const cleaned = v.replace(/[%,$]/g, '').trim();
        if (!cleaned) return Number.NaN;
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : Number.NaN;
      }
      return Number.NaN;
    };

    // Prefer numeric comparison when values are numeric or numeric-like strings (e.g., "78%", "0.42").
    const an = toMaybeNumber(a);
    const bn = toMaybeNumber(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      return an === bn ? 0 : an < bn ? -1 : 1;
    }

    const as = String(a).toLowerCase();
    const bs = String(b).toLowerCase();
    return as.localeCompare(bs);
  }

  const sortedRows = useMemo(() => {
    const rows = [...filteredScreener];
    if (!maximized || !sortKey) return rows;

    rows.sort((ra, rb) => {
      const cmp = compareNullable((ra as any)[sortKey], (rb as any)[sortKey]);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [filteredScreener, maximized, sortKey, sortDir]);

  function headerCell(label: string, key: SortKey, className: string) {
    const active = maximized && sortKey === key;
    const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
    if (!maximized) {
      return <th className={className}>{label}</th>;
    }
    return (
      <th
        className={`${className} cursor-pointer select-none`}
        onClick={() => toggleSort(key)}
        title="Click to sort"
      >
        <div className="inline-flex items-center gap-1 hover:text-gray-200">
          <span>{label}</span>
          {arrow ? <span className="text-gray-400">{arrow}</span> : null}
        </div>
      </th>
    );
  }

  const table = (
    <div className={maximized ? 'overflow-x-auto h-[80vh] overflow-y-auto' : 'overflow-x-auto max-h-80 overflow-y-auto'}>
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-gray-900 z-10">
          <tr>
            {headerCell('Symbol', 'ticker', 'text-left py-2 pr-4')}
            {headerCell('Name', 'name', 'text-left py-2 pr-4')}
            {headerCell('Decision', 'decision', 'text-center py-2 pr-4')}
            {headerCell('Confidence', 'confidence', 'text-right py-2 pr-4')}
            {headerCell('ML Up', 'ml_up', 'text-right py-2 pr-4')}
            {headerCell('Risk', 'risk', 'text-right py-2 pr-4')}
            {headerCell('Sentiment', 'sentiment_label', 'text-left py-2 pr-4')}
            {headerCell('RSI', 'rsi', 'text-right py-2 pr-4')}
            {headerCell('Reason', 'reason', 'text-left py-2')}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={row.ticker}
              className="border-t border-gray-800 hover:bg-gray-800 cursor-pointer"
              onClick={() => {
                setSymbol(row.ticker);
                setQuery(row.ticker);
                if (maximized) setMaximized(false);
              }}
            >
              <td className="py-2 pr-4 text-blue-300 font-semibold">{row.ticker}</td>
              <td className="py-2 pr-4 text-gray-200">{row.name ?? '—'}</td>
              <td
                className={`py-2 pr-4 text-center font-bold ${
                  row.decision === 'BUY' ? 'text-green-400' : row.decision === 'SELL' ? 'text-red-400' : 'text-yellow-300'
                }`}
              >
                {row.decision}
              </td>
              <td className="py-2 pr-4 text-right">{row.confidence != null ? `${row.confidence}%` : '—'}</td>
              <td className="py-2 pr-4 text-right">{row.ml_up != null ? fmt2(row.ml_up) : '—'}</td>
              <td className="py-2 pr-4 text-right">{row.risk != null ? fmt2(row.risk) : '—'}</td>
              <td className="py-2 pr-4">{row.sentiment_label ?? '—'}</td>
              <td className="py-2 pr-4 text-right">{row.rsi != null ? fmt2(row.rsi) : '—'}</td>
              <td className="py-2">{row.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sortedRows.length === 0 && <div className="text-xs text-gray-400 py-4">No signals found.</div>}
    </div>
  );

  return (
    <>
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="card-title">Trade Signal Screener</div>
          <div className="flex gap-2 items-center">
            {(['ALL', 'BUY', 'SELL', 'HOLD'] as const).map((type) => (
              <button
                key={type}
                className={`px-2 py-1 text-xs rounded ${screenerType === type ? 'bg-blue-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                onClick={() => setScreenerType(type)}
              >
                {type}
              </button>
            ))}
            <button
              className="ml-2 px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-white border border-gray-600"
              title="Maximize"
              onClick={() => setMaximized(true)}
            >
              ⛶
            </button>
          </div>
        </div>
        {screenerLoading ? (
          <div className="text-xs text-gray-400">Loading…</div>
        ) : screenerError ? (
          <div className="text-xs text-red-400">{screenerError}</div>
        ) : (
          table
        )}
      </div>
      {maximized && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
          <div className="bg-gray-900 rounded-lg shadow-lg p-6 w-[90vw] max-w-7xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold">Trade Signal Screener (Maximized)</div>
              <button
                className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-white text-sm"
                onClick={() => setMaximized(false)}
              >
                Close
              </button>
            </div>
            {table}
          </div>
        </div>
      )}
    </>
  );
}
