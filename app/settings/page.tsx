"use client";
import { marketDataApi } from '@/lib/api/marketData';
import { Suspense, useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { symbolsApi } from '@/lib/api/symbols';
import { useQuery } from '@tanstack/react-query';
import { sentimentApi } from '@/lib/api/sentiment';
import { fmt2, formatISTDateTime } from '@/lib/format';
import type { SymbolRef } from '@/types/api';
import { getTradeSignalSettings, updateTradeSignalSettings, getDataSchedulerSettings, updateDataSchedulerSettings, type TradeSignalSettings as TSSettings, type DataSchedulerSettings as DSSettings } from '@/lib/api/settings';
import BackendRestartButton from '../../components/BackendRestartButton';
import { tradingApi, type TradeLogRecord } from '@/lib/api/trading';
import { DEFAULT_UI_PREFERENCES, UI_FEATURE_FLAGS, UI_PREFERENCES_STORAGE_KEY, type UiPreferences } from '@/lib/config/ui';

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-400">Loading…</div>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const search = useSearchParams();
  const [uiPrefs, setUiPrefs] = useLocalStorage<UiPreferences>(UI_PREFERENCES_STORAGE_KEY, DEFAULT_UI_PREFERENCES);
  const [message, setMessage] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [dataCfg, setDataCfg] = useState<DSSettings | null>(null);
  const [dataCfgMsg, setDataCfgMsg] = useState<string>('');

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await getDataSchedulerSettings();
        if (alive) setDataCfg(cfg);
      } catch {
        if (alive) setDataCfg(null);
      }
    })();
    return () => { alive = false; };
  }, []);

  function updateDataCfg<K extends keyof DSSettings>(k: K, v: DSSettings[K]) {
    setDataCfg((prev) => {
      if (!prev) {
        return {
          enabled: true,
          interval_minutes: 1440,
          interval: 'day',
          lookback_days: 365,
          selected_symbols: '',
          daily_run_time: null,
          [k]: v,
        } as DSSettings;
      }
      return { ...prev, [k]: v };
    });
  }

  async function saveDataCfg() {
    if (!dataCfg) return;
    try {
      const d = await updateDataSchedulerSettings(dataCfg);
      setDataCfg(d);
      setDataCfgMsg('Saved');
    } catch (e: any) {
      setDataCfgMsg(`Failed: ${e?.message || 'Unknown'}`);
    }
  }

  const effectiveUiPrefs = mounted ? uiPrefs : DEFAULT_UI_PREFERENCES;

  async function refreshInstruments() {
    const res = await marketDataApi.refreshInstruments();
    setMessage(res.error ? 'Failed to refresh' : 'Instruments refreshed');
  }

  async function seedSymbols() {
    const res = await symbolsApi.seed();
    if (res.error) {
      setMessage('Failed to seed symbols');
      return;
    }
    const d = res.data!;
    setMessage(`Seeded: +${d.inserted_count}${d.updated_count ? `, updated: ${d.updated_count}` : ''}`);
  }

  async function seedNseTop() {
    const res = await symbolsApi.seedPreset('nse_top', true);
    if (res.error) {
      setMessage('Failed to seed NSE Top');
      return;
    }
    const d = res.data!;
    setMessage(`NSE Top: +${d.inserted_count}, updated: ${d.updated_count}`);
  }

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="card-title mb-2">UI Preferences</div>
        {!UI_FEATURE_FLAGS.trading_automation_enabled ? (
          <div className="text-sm text-gray-400">Trading Automation is disabled by the UI feature flags.</div>
        ) : (
          <>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!effectiveUiPrefs.show_trading_automation_sidebar}
                onChange={(e) => setUiPrefs({ ...effectiveUiPrefs, show_trading_automation_sidebar: e.target.checked })}
              />
              <span className="text-sm">Enable Trading Automation feature</span>
            </label>
            <div className="text-xs text-gray-500 mt-2">When disabled, the sidebar link is hidden and the route redirects to Settings.</div>
          </>
        )}
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Admin Actions</div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={refreshInstruments} className="px-3 py-2 bg-brand rounded hover:bg-brand-dark">Refresh Instruments Cache</button>
          <button onClick={seedSymbols} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600">Seed Common Symbols</button>
          <button onClick={seedNseTop} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600">Seed NSE Top</button>
          <BackendRestartButton />
        </div>
        {message && <div className="mt-2 text-sm text-gray-400">{message}</div>}
      </div>

      {/* News Scheduler Status */}
      <SchedulerCard />

      {/* Trade Signal Settings */}
      <TradeSignalSettingsCard />

      {/* Selected Symbols (canonical for batch operations) */}
      <SelectedSymbolsCard
        cfg={dataCfg}
        onUpdate={updateDataCfg}
        onSave={saveDataCfg}
        msg={dataCfgMsg}
      />

      {/* Data Scheduler Settings */}
      <DataSchedulerSettingsCard cfg={dataCfg} onUpdate={updateDataCfg} onSave={saveDataCfg} msg={dataCfgMsg} />

      {/* Kite Access Token */}
      <KiteAccessTokenCard />

      {/* Batch Fetch OHLCV */}
      <BatchFetchCard cfg={dataCfg} />

      {/* Data Availability */}
      <AvailabilityCard autoOpen={search.get('availability') === '1'} />

      {/* Recent Articles */}
      <ArticlesCard />

      {/* Trade Logs */}
      <TradeLogsCard />
    </div>
  );
}

function normalizeSymbolsText(text: string): string {
  const list = (text || '')
    .split(/[\,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    if (seen.has(s)) continue;
    seen.add(s);
    uniq.push(s);
  }
  return uniq.join(',');
}

function SelectedSymbolsCard({
  cfg,
  onUpdate,
  onSave,
  msg,
}: {
  cfg: DSSettings | null;
  onUpdate: <K extends keyof DSSettings>(k: K, v: DSSettings[K]) => void;
  onSave: () => Promise<void>;
  msg: string;
}) {
  const [query, setQuery] = useState('');
  const [showSug, setShowSug] = useState(false);
  const [suggestions, setSuggestions] = useState<SymbolRef[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const sugTimeout = useRef<number | null>(null);

  const selectedText = cfg?.selected_symbols || '';

  useEffect(() => {
    if (sugTimeout.current) {
      window.clearTimeout(sugTimeout.current);
      sugTimeout.current = null;
    }
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    sugTimeout.current = window.setTimeout(async () => {
      const res = await symbolsApi.search(q, 10);
      if ((res as any)?.error) {
        setSuggestions([]);
      } else {
        setSuggestions(res.data || []);
      }
      setActiveIdx(-1);
    }, 200);
    return () => {
      if (sugTimeout.current) {
        window.clearTimeout(sugTimeout.current);
        sugTimeout.current = null;
      }
    };
  }, [query]);

  function addSymbol(sym: string) {
    const s = (sym || '').trim().toUpperCase();
    if (!s) return;
    const current = normalizeSymbolsText(selectedText);
    const list = current ? current.split(',').filter(Boolean) : [];
    if (!list.includes(s)) list.push(s);
    onUpdate('selected_symbols', list.join(','));
    setQuery('');
    setShowSug(false);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="card-title">Selected Symbols</div>
          <div className="text-xs text-gray-500">Used for Data Scheduler Settings and Batch Fetch OHLCV.</div>
        </div>
        <button onClick={onSave} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm">Save</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <div className="text-xs text-gray-400 mb-1">Selected Symbols (comma separated)</div>
          <input
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2"
            value={selectedText}
            onChange={(e) => onUpdate('selected_symbols', normalizeSymbolsText(e.target.value))}
            placeholder="RELIANCE,TCS,INFY"
          />
        </div>

        <div>
          <div className="text-xs text-gray-400 mb-1">Add symbol (search)</div>
          <div className="relative">
            <input
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2"
              value={query}
              onChange={(e) => { setQuery(e.target.value.toUpperCase()); setShowSug(true); }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (activeIdx >= 0 && activeIdx < suggestions.length) {
                    addSymbol(suggestions[activeIdx].ticker);
                  } else {
                    const v = query.trim();
                    if (v) addSymbol(v);
                  }
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
              placeholder="Type to search (e.g., RELIANCE)"
            />
            {showSug && query.length >= 1 && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto bg-gray-900 border border-gray-800 rounded shadow-lg">
                {suggestions.map((s, idx) => (
                  <button
                    key={s.ticker}
                    onClick={() => { addSymbol(s.ticker); }}
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
      </div>

      {msg ? <div className="mt-2 text-xs text-gray-400">{msg}</div> : null}
    </div>
  );
}
function KiteAccessTokenCard() {
  const [reqToken, setReqToken] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [savedToken, setSavedToken] = useState<string>('');
  async function generate() {
    setMsg(''); setSavedToken('');
    if (!reqToken.trim()) { setMsg('Enter request token'); return; }
    try {
      setBusy(true);
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
      const res = await fetch(`${apiBase}/kite/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_token: reqToken.trim() }),
      });
      const d = await res.json();
      if (!d.ok) { setMsg(`Failed: ${d.error || 'Unknown error'}`); return; }
      setSavedToken(d.access_token || '');
      // Now refresh the token in backend
      const refreshRes = await fetch(`${apiBase}/kite/refresh-token`, { method: 'POST' });
      const refreshData = await refreshRes.json();
      if (refreshData.ok) {
        setMsg('Saved and backend token refreshed.');
      } else {
        setMsg(`Saved, but refresh failed: ${refreshData.error || 'Unknown'}`);
      }
    } catch (e: any) {
      setMsg(`Error: ${e?.message || 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card p-4">
      <div className="card-title mb-2">Kite Access Token</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <div className="text-xs text-gray-400 mb-1">Request Token</div>
          <input className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={reqToken} onChange={(e) => setReqToken(e.target.value)} placeholder="Paste request token" />
        </div>
        <div className="flex flex-col gap-2 justify-end">
          <a
            href="https://kite.trade/connect/login?api_key=mcyalsxgc3ppla5y&v=3"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 w-full text-center"
          >
            Open Kite Login
          </a>
          <button
            onClick={generate}
            disabled={busy}
            className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 w-full ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {busy ? 'Generating…' : 'Generate & Save'}
          </button>
        </div>
      </div>
      {savedToken && (
        <div className="mt-2 text-xs text-gray-300">Access Token: <span className="font-mono break-all">{savedToken}</span></div>
      )}
      {msg && <div className="mt-2 text-xs text-gray-400">{msg}</div>}
      <div className="text-xs text-gray-500 mt-2">After saving, restart backend:
        <pre className="mt-1 bg-gray-900 p-2 rounded">uvicorn main:app --host 0.0.0.0 --port 8000</pre>
      </div>
    </div>
  );
}

function TradeSignalSettingsCard() {
  const [cfg, setCfg] = useState<TSSettings | null>(null);
  const [msg, setMsg] = useState<string>('');
  useEffect(() => { (async () => { try { setCfg(await getTradeSignalSettings()); } catch { setCfg(null); } })(); }, []);
  function upd<K extends keyof TSSettings>(k: K, v: TSSettings[K]) { if (!cfg) return; setCfg({ ...cfg, [k]: v }); }
  async function save() {
    if (!cfg) return;
    try { const d = await updateTradeSignalSettings(cfg); setCfg(d); setMsg('Saved'); } catch (e: any) { setMsg(`Failed: ${e?.message || 'Unknown'}`); }
  }
  const c = cfg || { ml_weight: 0.4, sentiment_weight: 0.2, technical_weight: 0.3, risk_weight: 0.1, buy_threshold: 0.6, sell_threshold: 0.4, min_up_prob: 0.55, risk_cap: 0.3 } as TSSettings;
  return (
    <div className="card p-4">
      <div className="card-title mb-2">Trade Signal Settings</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Slider label="ML Weight" value={c.ml_weight} min={0} max={1} step={0.01} onChange={(v) => upd('ml_weight', v)} />
        <Slider label="Sentiment Weight" value={c.sentiment_weight} min={0} max={1} step={0.01} onChange={(v) => upd('sentiment_weight', v)} />
        <Slider label="Technical Weight" value={c.technical_weight} min={0} max={1} step={0.01} onChange={(v) => upd('technical_weight', v)} />
        <Slider label="Risk Weight" value={c.risk_weight} min={0} max={1} step={0.01} onChange={(v) => upd('risk_weight', v)} />
        <Slider label="Buy Threshold" value={c.buy_threshold} min={0} max={1} step={0.01} onChange={(v) => upd('buy_threshold', v)} />
        <Slider label="Sell Threshold" value={c.sell_threshold} min={0} max={1} step={0.01} onChange={(v) => upd('sell_threshold', v)} />
        <Slider label="Min Up Prob" value={c.min_up_prob} min={0} max={1} step={0.01} onChange={(v) => upd('min_up_prob', v)} />
        <Slider label="Risk Cap" value={c.risk_cap} min={0} max={1} step={0.01} onChange={(v) => upd('risk_cap', v)} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600">Save</button>
        {msg && <div className="text-sm text-gray-400">{msg}</div>}
      </div>
      <div className="text-xs text-gray-500 mt-2">Tip: Weights don't need to sum to 1; confidence uses these as multipliers.</div>
    </div>
  );
}

function DataSchedulerSettingsCard({
  cfg,
  onUpdate,
  onSave,
  msg,
}: {
  cfg: DSSettings | null;
  onUpdate: <K extends keyof DSSettings>(k: K, v: DSSettings[K]) => void;
  onSave: () => Promise<void>;
  msg: string;
}) {
  const [runMsg, setRunMsg] = useState<string>('');
  const [busy, setBusy] = useState(false);
  function upd<K extends keyof DSSettings>(k: K, v: DSSettings[K]) { onUpdate(k, v); }
  async function runNow() {
    try {
      setBusy(true);
      setRunMsg('');
      const res = await marketDataApi.schedulerRunNow();
      if ((res as any)?.error) {
        throw new Error(String((res as any).error));
      }
      const fetched = (res as any)?.data?.fetched;
      const failed = (res as any)?.data?.failed;
      const f = Array.isArray(fetched) ? fetched.length : 0;
      const b = Array.isArray(failed) ? failed.length : 0;
      setRunMsg(`Cycle complete. Fetched: ${f}, Failed: ${b}`);
    } catch (e: any) {
      setRunMsg(`Run failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  }
  const c = cfg || { enabled: true, interval_minutes: 1440, interval: 'day', lookback_days: 365, selected_symbols: '', daily_run_time: null } as DSSettings;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="card-title">Data Scheduler Settings</div>
        <button onClick={runNow} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Running…' : 'Run Now'}</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-gray-400 mb-1">Enabled</div>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={!!c.enabled} onChange={(e) => upd('enabled', e.target.checked)} />
            <span className="text-sm">Run Scheduler</span>
          </label>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Interval Minutes</div>
          <input type="number" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.interval_minutes} onChange={(e) => upd('interval_minutes', Number(e.target.value))} />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Interval</div>
          <select className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.interval} onChange={(e) => upd('interval', e.target.value as DSSettings['interval'])}>
            <option value="day">day</option>
            <option value="15minute">15minute</option>
            <option value="5minute">5minute</option>
            <option value="minute">minute</option>
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Lookback Days</div>
          <input type="number" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.lookback_days} onChange={(e) => upd('lookback_days', Number(e.target.value))} />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Daily Run Time (HH:MM, local)</div>
          <input className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.daily_run_time || ''} onChange={(e) => upd('daily_run_time', e.target.value)} placeholder="09:30" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={onSave} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600">Save</button>
        {msg && <div className="text-sm text-gray-400">{msg}</div>}
      </div>
      {runMsg && <div className="mt-2 text-xs text-gray-400">{runMsg}</div>}
      <div className="text-xs text-gray-500 mt-2">Note: If a daily run time is set, the scheduler runs once per day at that local time. Otherwise, it runs every N minutes.</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-400 mb-1">{label}</div>
        <div className="text-xs text-gray-300">{value.toFixed(2)}</div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

function TradeLogsCard() {
  const [symbol] = useLocalStorage<string>('app:symbol', 'RELIANCE');
  const [filterSymbol, setFilterSymbol] = useState<string>(symbol);
  const [limit, setLimit] = useState<number>(200);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [items, setItems] = useState<TradeLogRecord[]>([]);

  async function load() {
    try {
      setBusy(true);
      setMsg('');
      const res = await tradingApi.listLogs({ symbol: filterSymbol?.trim() || undefined, limit });
      if (res.error) throw new Error(typeof res.error === 'string' ? res.error : (res.error?.detail || 'Request failed'));
      const list = res.data?.items;
      setItems(Array.isArray(list) ? list : []);
      setMsg('');
    } catch (e: any) {
      setMsg(`Failed: ${e?.message || 'Unknown error'}`);
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="card-title">Trade Logs (Audit Trail)</div>
        <button onClick={load} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-400 mb-1">Symbol (optional)</div>
          <input className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)} placeholder="RELIANCE" />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Limit</div>
          <select className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={load} disabled={busy} className={`px-3 py-2 bg-brand rounded hover:bg-brand-dark w-full ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>Load</button>
        </div>
      </div>

      {msg && <div className="mb-2 text-xs text-gray-400">{msg}</div>}

      <div className="overflow-auto max-h-[420px] border border-gray-800 rounded">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-950">
            <tr className="text-xs text-gray-400">
              <th className="text-left px-3 py-2">Time</th>
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Conf</th>
              <th className="text-left px-3 py-2">Allowed</th>
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-gray-500" colSpan={7}>No logs found.</td>
              </tr>
            ) : items.map((row) => {
              const allowed = row.allowed;
              const allowedLabel = allowed == null ? '—' : (allowed ? 'YES' : 'NO');
              const actionStyle = row.action === 'BUY'
                ? 'text-emerald-300'
                : row.action === 'SELL'
                  ? 'text-rose-300'
                  : 'text-gray-300';
              return (
                <tr key={row.id} className="border-t border-gray-800">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-300">{row.created_at ? formatISTDateTime(row.created_at) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-gray-300">{row.symbol}</td>
                  <td className={`px-3 py-2 whitespace-nowrap font-semibold ${actionStyle}`}>{row.action}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-300">{typeof row.confidence === 'number' ? fmt2(row.confidence) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-300">{allowedLabel}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">
                    {row.order_status || row.order_id ? (
                      <span className="font-mono">{row.order_status || '—'}{row.order_id ? ` (${row.order_id})` : ''}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 max-w-[360px] truncate" title={row.error || ''}>{row.error || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-500 mt-2">Tip: Logs are written when the orchestrator pipeline runs.</div>
    </div>
  );
}

function SchedulerCard() {
  const schedQ = useQuery({
    queryKey: ['scheduler-status'],
    queryFn: () => sentimentApi.schedulerStatus(),
    refetchInterval: 60000,
  });
  const last = schedQ.data?.data || null;
  const [busy, setBusy] = useState(false);

  async function runNow() {
    try {
      setBusy(true);
      const res = await sentimentApi.crawlAndOrchestrate();
      if ((res as any)?.error) {
        // eslint-disable-next-line no-alert
        alert(`Cycle failed: ${typeof res.error === 'string' ? res.error : (res.error?.detail || JSON.stringify(res.error))}`);
      }
      await schedQ.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="card-title">News Scheduler</div>
        <div className="flex items-center gap-2">
          <button onClick={() => schedQ.refetch()} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm">Refresh</button>
          <button onClick={runNow} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Running…' : 'Run Now'}</button>
        </div>
      </div>
      <div className="text-xs text-gray-400 mt-1">{last?.timestamp ? `Last: ${formatISTDateTime(last.timestamp)}` : 'No run yet'}</div>
      {last && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="bg-gray-900/40 rounded px-2 py-2">
            <div className="text-gray-400 text-xs">Impacted</div>
            <div className="font-semibold">{Array.isArray(last.impacted) ? last.impacted.length : 0}</div>
          </div>
          <div className="bg-gray-900/40 rounded px-2 py-2">
            <div className="text-gray-400 text-xs">Orchestrated</div>
            <div className="font-semibold">{Array.isArray(last.orchestrated) ? last.orchestrated.length : 0}</div>
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
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
            {last.impacted.slice(0, 40).map((t: string) => {
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
          <div className="text-xs text-gray-500">None yet. Trigger a run to populate.</div>
        )}
      </div>
    </div>
  );
}

function ArticlesCard() {
  const limit = 50;
  const q = useQuery({
    queryKey: ['articles', limit],
    queryFn: () => sentimentApi.listArticles(limit),
    refetchInterval: 180000,
  });
  const rows = q.data?.data || [];
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string>('');

  async function backfill() {
    try {
      setBackfillBusy(true);
      setBackfillMsg('');
      const res = await sentimentApi.backfill(200);
      const d = res.data || {};
      setBackfillMsg(`Processed: ${d.processed ?? 0}, Updated: ${d.updated ?? 0}`);
      await q.refetch();
    } catch (e: any) {
      setBackfillMsg(`Failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setBackfillBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="card-title">Recent Articles</div>
        <div className="flex items-center gap-2">
          <button onClick={() => q.refetch()} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm">Refresh</button>
          <button onClick={backfill} disabled={backfillBusy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm ${backfillBusy ? 'opacity-60 cursor-not-allowed' : ''}`}>{backfillBusy ? 'Backfilling…' : 'Backfill Sentiment'}</button>
        </div>
      </div>
      {backfillMsg && <div className="text-xs text-gray-400 mb-2">{backfillMsg}</div>}
      <div className="text-xs text-gray-400 mb-2">Showing {rows.length} items</div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-gray-400">
              <tr>
                <th className="text-left py-2 pr-4">Time</th>
                <th className="text-left py-2 pr-4">Source</th>
                <th className="text-left py-2 pr-4">Title</th>
                <th className="text-left py-2 pr-4">Tickers</th>
                <th className="text-left py-2 pr-4">Stocks</th>
                <th className="text-left py-2 pr-4">Sentiment</th>
                <th className="text-left py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a: any) => (
                <tr key={a.id} className="border-t border-gray-800">
                  <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">{a.published_at || '—'}</td>
                  <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">{a.source?.replace(/^https?:\/\//, '') || '—'}</td>
                  <td className="py-2 pr-4 text-gray-200 max-w-[520px] truncate">
                    {a.url ? (
                      <a className="text-brand hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.title || a.url}</a>
                    ) : (
                      <span>{a.title || '—'}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-gray-200 whitespace-nowrap">
                    {Array.isArray(a.tickers) && a.tickers.length ? (
                      <div className="flex flex-wrap gap-1 max-w-[240px]">
                        {a.tickers.slice(0, 6).map((t: string) => (
                          <span key={t} className="px-1.5 py-0.5 text-xs bg-gray-800 rounded">{t}</span>
                        ))}
                        {a.tickers.length > 6 ? <span className="text-xs text-gray-400">+{a.tickers.length - 6}</span> : null}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">
                    {Array.isArray(a.stock_names) && a.stock_names.length ? (
                      <span className="truncate inline-block max-w-[260px] align-top">{a.stock_names.slice(0, 4).join(', ')}{a.stock_names.length > 4 ? `, +${a.stock_names.length - 4}` : ''}</span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-200 whitespace-nowrap">{a.sentiment_label || '—'}</td>
                  <td className="py-2 text-gray-200 whitespace-nowrap">{a.sentiment_score != null ? fmt2(Number(a.sentiment_score)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-gray-400">No articles yet.</div>
      )}
    </div>
  );
}

function BatchFetchCard({ cfg }: { cfg: DSSettings | null }) {
  const [interval, setInterval] = useState<string>('minute');
  const [from, setFrom] = useLocalStorage<string>('app:batchFrom', '2024-01-01');
  // Versioned key: ensures the default resets to today's date once even if an old value
  // was persisted previously.
  const [to, setTo] = useLocalStorage<string>('app:batchTo:v2', new Date().toISOString().slice(0, 10));
  const [toTouched, setToTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<string>('');

  // Default `to` should always be today's date when the Settings page is opened.
  // We avoid overriding if the user edits the field in the current session.
  useEffect(() => {
    if (toTouched) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    if (to !== todayStr) setTo(todayStr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toTouched]);

  const selectedText = normalizeSymbolsText(cfg?.selected_symbols || '');
  const selectedList = selectedText ? selectedText.split(',').filter(Boolean) : [];

  async function runBatch() {
    const syms = selectedList;
    if (!syms.length) { setResultMsg('No selected symbols found'); return; }
    try {
      setBusy(true);
      setResultMsg('');
      const res = await marketDataApi.batchFetch({ symbols: syms, interval, from, to });
      if (res.error) {
        setResultMsg(`Failed: ${String(res.error)}`);
        return;
      }
      const d = res.data || {};
      const ok = Array.isArray(d.fetched) ? d.fetched.length : 0;
      const failed = Array.isArray(d.failed) ? d.failed.length : 0;
      setResultMsg(`Completed. Fetched: ${ok}${failed ? `, Failed: ${failed}` : ''}`);
    } catch (e: any) {
      setResultMsg(`Error: ${e?.message || 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSelectedToToday() {
    try {
      setBusy(true);
      setResultMsg('');

      const syms = selectedList;
      if (!syms.length) { setResultMsg('No selected symbols found'); return; }

      const today = new Date();
      const toDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      const toStr = toDate.toISOString().slice(0, 10);

      const cfgInterval = (cfg?.interval as any) || 'day';
      const intervalSafe = ['minute', '5minute', '15minute', 'day'].includes(cfgInterval) ? cfgInterval : 'day';

      // Reflect in UI inputs so users can see what's being executed.
      setInterval(intervalSafe);
      setFrom('');
      setTo(toStr);

      // Incremental mode: backend will compute per-symbol 'from' using last stored OHLCV timestamp.
      const res = await marketDataApi.batchFetch({ symbols: syms, interval: intervalSafe, to: toStr });
      if (res.error) {
        setResultMsg(`Failed: ${String(res.error)}`);
        return;
      }
      const d = res.data || {};
      const ok = Array.isArray(d.fetched) ? d.fetched.length : 0;
      const failed = Array.isArray(d.failed) ? d.failed.length : 0;
      setResultMsg(`Refresh completed (incremental to today). Fetched: ${ok}${failed ? `, Failed: ${failed}` : ''}`);
    } catch (e: any) {
      setResultMsg(`Refresh error: ${e?.message || 'Unknown'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="card-title mb-2">Batch Fetch OHLCV</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-gray-400 mb-1">Interval</div>
          <select className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={interval} onChange={e => setInterval(e.target.value)}>
            <option value="day">day</option>
            <option value="15minute">15minute</option>
            <option value="5minute">5minute</option>
            <option value="minute">minute</option>
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">From (YYYY-MM-DD)</div>
          <input className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">To (YYYY-MM-DD)</div>
          <input
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2"
            value={to}
            onChange={(e) => {
              setToTouched(true);
              setTo(e.target.value);
            }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={refreshSelectedToToday} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Running…' : 'Refresh'}</button>
        <button onClick={runBatch} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Running…' : 'Run Batch'}</button>
        {resultMsg && <div className="text-sm text-gray-400">{resultMsg}</div>}
      </div>
    </div>
  );
}

function AvailabilityCard({ autoOpen = false }: { autoOpen?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ items: Array<{ symbol: string; first: string; last: string; count: number }>; totalSymbols: number } | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { if (autoOpen && !show) { void load(); } }, [autoOpen]);

  async function load() {
    try {
      setBusy(true);
      const res = await marketDataApi.getAvailability();
      if ((res as any)?.error) {
        // eslint-disable-next-line no-alert
        alert(`Failed: ${String((res as any).error)}`);
        return;
      }
      setData(res.data);
      setShow(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="card-title">Data Availability</div>
        <button onClick={load} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Loading…' : 'Show'}</button>
      </div>
      {show && data && (
        <div className="mt-2">
          <div className="text-xs text-gray-400 mb-1">Symbols: {data.totalSymbols}</div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto border border-gray-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="text-gray-400 sticky top-0 bg-gray-900">
                <tr>
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">First Date</th>
                  <th className="text-left py-2 px-2">Last Date</th>
                  <th className="text-left py-2 px-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.symbol} className="border-t border-gray-800">
                    <td className="py-2 px-2 text-gray-200">{it.symbol}</td>
                    <td className="py-2 px-2 text-gray-300">{new Date(it.first).toLocaleDateString()}</td>
                    <td className="py-2 px-2 text-gray-300">{new Date(it.last).toLocaleDateString()}</td>
                    <td className="py-2 px-2 text-gray-300">{it.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <button className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm" onClick={() => setShow(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
