"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getTradingAutomationSettings, updateTradingAutomationSettings, type TradingAutomationSettings as TASettings } from '@/lib/api/settings';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { DEFAULT_UI_PREFERENCES, UI_FEATURE_FLAGS, UI_PREFERENCES_STORAGE_KEY, type UiPreferences } from '@/lib/config/ui';
import { tradingApi } from '@/lib/api/trading';
import { fmt2 } from '@/lib/format';
import { symbolsApi } from '@/lib/api/symbols';
import { marketDataApi, type FeatureSnapshotItem, type LastCloseResponseItem } from '@/lib/api/marketData';
import {
  foApi,
  type FOContractOut,
  type FOInstrumentConfig,
  type FOSettings,
  type FOAutoPickResponse,
  type FOAdvancedTrainResponse,
  type FOPaperLoopStatusResponse,
  type FOOptionGreeksResponse,
  type FOVolPoint,
  type FOSVICalibrateResponse,
  type FOSABRCalibrateResponse,
} from '@/lib/api/fo';
import { useToast } from '@/components/Toast';
import type { SymbolRef } from '@/types/api';

const FO_EXEC_STATUS_STORAGE_KEY = 'marketintel:fo-exec-status';

// Empty default keeps the UI lightweight while still allowing the component
// to auto-load underlyings from Trading Automation Settings on first mount.
const DEFAULT_AUTO_PICK_UNDERLYINGS_TEXT = '';

function TableMaximizeButton(props: { maximized: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
    >
      {props.maximized ? 'Minimize' : 'Maximize'}
    </button>
  );
}

function formatApiError(err: any): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (typeof err?.detail === 'string') return err.detail;
  if (typeof err?.message === 'string') return err.message;

  const responseData = err?.response?.data;
  if (typeof responseData?.detail === 'string') return responseData.detail;
  if (typeof responseData === 'string') return responseData;
  if (responseData != null) {
    try {
      return JSON.stringify(responseData);
    } catch {
      // fall through
    }
  }

  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function TradingAutomationPage() {
  const router = useRouter();
  const [uiPrefs] = useLocalStorage<UiPreferences>(UI_PREFERENCES_STORAGE_KEY, DEFAULT_UI_PREFERENCES);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<'automation' | 'stocks' | 'settings' | 'fo'>('automation');

  useEffect(() => { setMounted(true); }, []);

  const enabled = UI_FEATURE_FLAGS.trading_automation_enabled && uiPrefs.show_trading_automation_sidebar;

  useEffect(() => {
    if (mounted && !enabled) {
      router.replace('/settings');
    }
  }, [enabled, mounted, router]);

  // Render a stable shell until hydration completes to avoid SSR/CSR mismatches
  // when localStorage-driven preferences differ from server defaults.
  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="card p-4">
          <div className="text-sm text-gray-400">Loading…</div>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div className="card p-4">
          <div className="card-title mb-2">Trading Automation</div>
          <div className="text-sm text-gray-300">This feature is disabled in UI settings.</div>
          <div className="mt-3">
            <Link className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 inline-block" href="/settings">Go to Settings</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab('automation')}
            className={
              tab === 'automation'
                ? 'px-3 py-2 rounded bg-gray-700 text-white'
                : 'px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700'
            }
          >
            Automation
          </button>
          <button
            type="button"
            onClick={() => setTab('stocks')}
            className={
              tab === 'stocks'
                ? 'px-3 py-2 rounded bg-gray-700 text-white'
                : 'px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700'
            }
          >
            Stocks
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={
              tab === 'settings'
                ? 'px-3 py-2 rounded bg-gray-700 text-white'
                : 'px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700'
            }
          >
            Settings
          </button>

          <button
            type="button"
            onClick={() => setTab('fo')}
            className={
              tab === 'fo'
                ? 'px-3 py-2 rounded bg-gray-700 text-white'
                : 'px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700'
            }
          >
            Futures &amp; Options
          </button>
        </div>
      </div>

      {tab === 'automation' ? (
        <div className="space-y-6">
          <TradingAutomationSettingsCard />
          <TradeExecutionStatusCard />
          <ForceExitAllCard />
          <LiveTradingCard />
          <PaperTradingCard />
        </div>
      ) : tab === 'stocks' ? (
        <StocksTab />
      ) : tab === 'settings' ? (
        <LiveAutomationSettingsTab />
      ) : (
        <FuturesOptionsTab />
      )}
    </div>
  );
}

type FoUiInstrument = {
  enabled: boolean;
  kind: 'FUT' | 'OPT';
  exchange: 'NFO';
  tradingsymbol: string;
  product: 'MIS' | 'NRML';
  quantity: number;
  strategy_action: 'BUY' | 'SELL' | 'HOLD' | 'AUTO';
};

function normalizeFoInstrument(row: Partial<FoUiInstrument> & { tradingsymbol?: string }): FoUiInstrument {
  return {
    enabled: row.enabled ?? true,
    kind: (row.kind === 'OPT' ? 'OPT' : 'FUT'),
    exchange: 'NFO',
    tradingsymbol: String(row.tradingsymbol || '').trim().toUpperCase(),
    product: (row.product === 'NRML' ? 'NRML' : 'MIS'),
    quantity: Math.max(1, Number.isFinite(Number(row.quantity)) ? Math.floor(Number(row.quantity)) : 1),
    strategy_action:
      row.strategy_action === 'BUY' || row.strategy_action === 'SELL' || row.strategy_action === 'HOLD' || row.strategy_action === 'AUTO'
        ? row.strategy_action
        : 'HOLD',
  };
}

function FuturesOptionsTab() {
  const { show } = useToast();

  const [msg, setMsg] = useState<string>('');

  const [persistedExecStatus, setPersistedExecStatus] = useLocalStorage<any>(FO_EXEC_STATUS_STORAGE_KEY, null);
  const foAnyLoopRunningRef = useRef<boolean>(false);

  // Main settings + instruments
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<FOSettings | null>(null);
  const [rows, setRows] = useState<FoUiInstrument[]>([]);

  // Paper auto-run loop
  const [foPaperAutoRunLoopBusy, setFoPaperAutoRunLoopBusy] = useState(false);
  const [foPaperAutoRunLoopStatus, setFoPaperAutoRunLoopStatus] = useState<FOPaperLoopStatusResponse | null>(null);
  const [foPaperAutoRunLoopIntervalSec, setFoPaperAutoRunLoopIntervalSec] = useState<number>(60);

  // Paper auto-pick loop
  const [foPaperAutoPickLoopBusy, setFoPaperAutoPickLoopBusy] = useState(false);
  const [foPaperAutoPickLoopStatus, setFoPaperAutoPickLoopStatus] = useState<FOPaperLoopStatusResponse | null>(null);
  const [foPaperAutoPickLoopIntervalSec, setFoPaperAutoPickLoopIntervalSec] = useState<number>(60);

  // Run-now
  const [runMode, setRunMode] = useState<'paper' | 'live'>('paper');
  const [allowSell, setAllowSell] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmSell, setConfirmSell] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [lastRun, setLastRun] = useState<any | null>(null);
  const [runNowPnl, setRunNowPnl] = useState<Record<string, { entry: number; ltp: number; qty: number; pnl: number }>>({});
  const [runNowPnlUpdatedAt, setRunNowPnlUpdatedAt] = useState<string>('');

  // Auto-pick
  const [autoPickMode, setAutoPickMode] = useState<'paper' | 'live'>('paper');
  const [autoPickConfirmLive, setAutoPickConfirmLive] = useState(false);
  const [autoPickConfirmSell, setAutoPickConfirmSell] = useState(false);
  const [autoPickAllowSell, setAutoPickAllowSell] = useState(false);
  const [autoPickBusy, setAutoPickBusy] = useState(false);
  const [autoPickMsg, setAutoPickMsg] = useState<string>('');
  const [autoPickRes, setAutoPickRes] = useState<FOAutoPickResponse | null>(null);
  const [autoPickUnderlyingsText, setAutoPickUnderlyingsText] = useState<string>(DEFAULT_AUTO_PICK_UNDERLYINGS_TEXT);
  const [autoPickMaxPicksText, setAutoPickMaxPicksText] = useState<string>('1');
  const [autoPickMinConfidenceText, setAutoPickMinConfidenceText] = useState<string>('0');
  const [autoPickLotsText, setAutoPickLotsText] = useState<string>('1');
  const [autoPickProduct, setAutoPickProduct] = useState<'MIS' | 'NRML'>('MIS');
  const [autoPickPnl, setAutoPickPnl] = useState<Record<string, { entry: number; ltp: number; qty: number; pnl: number }>>({});
  const [autoPickPnlUpdatedAt, setAutoPickPnlUpdatedAt] = useState<string>('');

  // Advanced model training (manual)
  const [advTrainBusy, setAdvTrainBusy] = useState(false);
  const [advTrainMsg, setAdvTrainMsg] = useState<string>('');
  const [advTrainRes, setAdvTrainRes] = useState<FOAdvancedTrainResponse | null>(null);

  // Risk controls (Auto-Pick)
  const [riskEnabled, setRiskEnabled] = useState(true);
  const [riskMaxOpenPositionsText, setRiskMaxOpenPositionsText] = useState<string>('0');
  const [riskMinOptionLtpText, setRiskMinOptionLtpText] = useState<string>('0');
  const [riskMaxPremiumPerTradeText, setRiskMaxPremiumPerTradeText] = useState<string>('0');
  const [riskMaxDailyLossText, setRiskMaxDailyLossText] = useState<string>('0');
  const [riskStopLossPctText, setRiskStopLossPctText] = useState<string>('0');
  const [riskTakeProfitPctText, setRiskTakeProfitPctText] = useState<string>('0');

  // Table maximize controls
  const [maxInstrumentsTable, setMaxInstrumentsTable] = useState(false);
  const [maxContractsTable, setMaxContractsTable] = useState(false);
  const [maxAutoPickTable, setMaxAutoPickTable] = useState(false);
  const [maxRunNowTable, setMaxRunNowTable] = useState(false);
  const [maxPaperPositionsTable, setMaxPaperPositionsTable] = useState(false);

  async function refreshFoPaperLoopStatuses(opts?: { silent?: boolean }) {
    try {
      const [runRes, pickRes] = await Promise.all([foApi.paperAutoRunLoopStatus(), foApi.paperAutoPickLoopStatus()]);
      setFoPaperAutoRunLoopStatus((runRes.data as any) ?? null);
      setFoPaperAutoPickLoopStatus((pickRes.data as any) ?? null);
      const anyRunning = !!(runRes.data as any)?.running || !!(pickRes.data as any)?.running;
      foAnyLoopRunningRef.current = anyRunning;
      if (!opts?.silent) show(anyRunning ? 'Loop status refreshed' : 'No loops running');
    } catch (e: any) {
      if (!opts?.silent) setMsg(`Failed to refresh loop status: ${formatApiError(e)}`);
    }
  }

  async function startFoPaperAutoRunLoop() {
    setFoPaperAutoRunLoopBusy(true);
    setMsg('');
    try {
      const interval = Math.max(5, Math.min(3600, Math.floor(Number(foPaperAutoRunLoopIntervalSec) || 60)));
      const res = await foApi.paperAutoRunLoopStart({ interval_seconds: interval, allow_sell: !!allowSell } as any);
      if (res.error) {
        setMsg(`Failed to start paper auto-run loop: ${formatApiError(res.error)}`);
        return;
      }
      setFoPaperAutoRunLoopStatus(res.data as any);
      show('F&O paper auto-run loop started');
      await refreshFoPaperLoopStatuses({ silent: true });
    } catch (e: any) {
      setMsg(`Failed to start paper auto-run loop: ${formatApiError(e)}`);
    } finally {
      setFoPaperAutoRunLoopBusy(false);
    }
  }

  // NOTE: F&O logic continues below (loops, settings, tables, etc).

  async function stopFoPaperAutoRunLoop() {
    setFoPaperAutoRunLoopBusy(true);
    setMsg('');
    try {
      const res = await foApi.paperAutoRunLoopStop();
      if (res.error) {
        setMsg(`Failed to stop paper auto-run loop: ${formatApiError(res.error)}`);
        return;
      }
      setFoPaperAutoRunLoopStatus(res.data as any);
      show('F&O paper auto-run loop stopped');
      await refreshFoPaperLoopStatuses({ silent: true });
    } catch (e: any) {
      setMsg(`Failed to stop paper auto-run loop: ${formatApiError(e)}`);
    } finally {
      setFoPaperAutoRunLoopBusy(false);
    }
  }

  async function startFoPaperAutoPickLoop() {
    setFoPaperAutoPickLoopBusy(true);
    setAutoPickMsg('');
    try {
      const underlyings = parseUnderlyingsText(autoPickUnderlyingsText);
      if (underlyings.length === 0) {
        setAutoPickMsg('Please provide at least one underlying symbol (one per line).');
        return;
      }
      const interval = Math.max(5, Math.min(3600, Math.floor(Number(foPaperAutoPickLoopIntervalSec) || 60)));
      const res = await foApi.paperAutoPickLoopStart({
        interval_seconds: interval,
        underlyings,
        max_picks: Math.max(1, Math.floor(Number(autoPickMaxPicksText) || 1)),
        min_confidence: Math.max(0, Math.min(1, Number(autoPickMinConfidenceText) || 0)),
        lots: Math.max(1, Math.floor(Number(autoPickLotsText) || 1)),
        exchange: 'NFO',
        product: autoPickProduct,
        allow_sell: !!autoPickAllowSell,
      } as any);
      if (res.error) {
        setAutoPickMsg(`Failed to start paper auto-pick loop: ${formatApiError(res.error)}`);
        return;
      }
      setFoPaperAutoPickLoopStatus(res.data as any);
      show('F&O paper auto-pick loop started');
      await refreshFoPaperLoopStatuses({ silent: true });
    } catch (e: any) {
      setAutoPickMsg(`Failed to start paper auto-pick loop: ${formatApiError(e)}`);
    } finally {
      setFoPaperAutoPickLoopBusy(false);
    }
  }

  async function runAdvancedTrainNow() {
    setAdvTrainBusy(true);
    setAdvTrainMsg('');
    try {
      const underlyings = parseUnderlyingsText(autoPickUnderlyingsText);
      if (underlyings.length === 0) {
        setAdvTrainMsg('Please provide at least one underlying symbol (one per line).');
        return;
      }
      const res = await foApi.advancedTrain({ underlyings });
      if (res.error) {
        setAdvTrainMsg(`Advanced train failed: ${formatApiError(res.error)}`);
        return;
      }
      setAdvTrainRes((res.data as any) ?? null);
      show('Advanced model training started');
    } catch (e: any) {
      setAdvTrainMsg(`Advanced train failed: ${formatApiError(e)}`);
    } finally {
      setAdvTrainBusy(false);
    }
  }

  async function stopFoPaperAutoPickLoop() {
    setFoPaperAutoPickLoopBusy(true);
    setAutoPickMsg('');
    try {
      const res = await foApi.paperAutoPickLoopStop();
      if (res.error) {
        setAutoPickMsg(`Failed to stop paper auto-pick loop: ${formatApiError(res.error)}`);
        return;
      }
      setFoPaperAutoPickLoopStatus(res.data as any);
      show('F&O paper auto-pick loop stopped');
      await refreshFoPaperLoopStatuses({ silent: true });
    } catch (e: any) {
      setAutoPickMsg(`Failed to stop paper auto-pick loop: ${formatApiError(e)}`);
    } finally {
      setFoPaperAutoPickLoopBusy(false);
    }
  }

  async function loadAutoPickUnderlyingsFromSettings(opts?: { silent?: boolean }) {
    try {
      const cfg = await getTradingAutomationSettings();
      const syms = (cfg as any)?.live_selected_symbols as string[] | null | undefined;
      const list = Array.isArray(syms) ? syms.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().toUpperCase()) : [];
      if (list.length === 0) {
        if (!opts?.silent) setAutoPickMsg('No Live Trading Automation stocks configured in Settings. Add some in the Settings tab first.');
        return;
      }
      setAutoPickUnderlyingsText(list.join('\n'));
      if (!opts?.silent) show('Loaded underlyings from Trading Automation Settings');
    } catch (e: any) {
      if (!opts?.silent) setAutoPickMsg(`Failed to load from settings: ${formatApiError(e)}`);
    }
  }

  const [paperPositions, setPaperPositions] = useState<any[]>([]);

  // Contract picker (optional helper)
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerUnderlying, setPickerUnderlying] = useState<string>('');
  const [pickerKind, setPickerKind] = useState<'FUT' | 'OPT'>('FUT');
  const [pickerExpiry, setPickerExpiry] = useState<string>('');
  const [pickerOptionType, setPickerOptionType] = useState<'CE' | 'PE'>('CE');
  const [pickerExpiries, setPickerExpiries] = useState<string[]>([]);
  const [pickerContracts, setPickerContracts] = useState<FOContractOut[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setBusy(true);
      setMsg('');
      try {
        const res = await foApi.getSettings();
        const s = res.data as FOSettings;
        if (!mounted) return;
        setSettings(s);
        const normalized = (s?.instruments || [])
          .map((x: FOInstrumentConfig) => normalizeFoInstrument(x as any))
          .filter((x) => !!x.tradingsymbol);
        setRows(normalized);

        const ap = (s as any)?.auto_pick_defaults || {};
        if (ap) {
          if (ap.max_picks !== undefined && ap.max_picks !== null) {
            const v = Math.max(1, Math.floor(Number(ap.max_picks) || 1));
            setAutoPickMaxPicksText(String(v));
          }
          if (ap.min_confidence !== undefined && ap.min_confidence !== null) {
            const v = Math.max(0, Math.min(1, Number(ap.min_confidence) || 0));
            setAutoPickMinConfidenceText(String(v));
          }
          if (ap.lots !== undefined && ap.lots !== null) {
            const v = Math.max(1, Math.floor(Number(ap.lots) || 1));
            setAutoPickLotsText(String(v));
          }
          if (ap.product === 'MIS' || ap.product === 'NRML') {
            setAutoPickProduct(ap.product);
          }
        }

        const rc = (s as any)?.risk_controls || {};
        setRiskEnabled(!!(rc.enabled ?? true));
        if (rc.max_open_positions !== undefined && rc.max_open_positions !== null) {
          setRiskMaxOpenPositionsText(String(Math.max(0, Math.floor(Number(rc.max_open_positions) || 0))));
        }
        if (rc.min_option_ltp !== undefined && rc.min_option_ltp !== null) {
          setRiskMinOptionLtpText(String(Math.max(0, Number(rc.min_option_ltp) || 0)));
        }
        if (rc.max_premium_per_trade !== undefined && rc.max_premium_per_trade !== null) {
          setRiskMaxPremiumPerTradeText(String(Math.max(0, Number(rc.max_premium_per_trade) || 0)));
        }
        if (rc.max_daily_loss !== undefined && rc.max_daily_loss !== null) {
          setRiskMaxDailyLossText(String(Math.max(0, Number(rc.max_daily_loss) || 0)));
        }
        if (rc.stop_loss_pct !== undefined && rc.stop_loss_pct !== null) {
          setRiskStopLossPctText(String(Math.max(0, Math.min(1, Number(rc.stop_loss_pct) || 0))));
        }
        if (rc.take_profit_pct !== undefined && rc.take_profit_pct !== null) {
          setRiskTakeProfitPctText(String(Math.max(0, Math.min(1, Number(rc.take_profit_pct) || 0))));
        }
      } catch (e: any) {
        if (mounted) setMsg(`Failed to load F&O settings: ${formatApiError(e)}`);
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function refreshPaperPositions() {
    try {
      const res = await foApi.paperPositions();
      setPaperPositions((res.data as any[]) || []);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshPaperPositions();
    refreshFoPaperLoopStatuses({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function parseUnderlyingsText(text: string): string[] {
    const tokens = String(text || '')
      .split(/[\s,]+/g)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.toUpperCase());
    // unique
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  function inferKindFromTradingsymbol(ts: string): 'FUT' | 'OPT' {
    const sym = String(ts || '').trim().toUpperCase();
    if (!sym) return 'FUT';
    if (sym.endsWith('CE') || sym.endsWith('PE')) return 'OPT';
    return 'FUT';
  }

  function addRow(tradingsymbol: string) {
    const ts = String(tradingsymbol || '').trim().toUpperCase();
    setRows((prev) => {
      if (ts && prev.some((r) => String(r.tradingsymbol || '').trim().toUpperCase() === ts)) return prev;
      const next = normalizeFoInstrument({
        tradingsymbol: ts,
        kind: inferKindFromTradingsymbol(ts),
      });
      return [...prev, next];
    });
  }

  async function save() {
    setBusy(true);
    setMsg('');
    try {
      const autoPickDefaults = {
        max_picks: Math.max(1, Math.floor(Number(autoPickMaxPicksText) || 1)),
        min_confidence: Math.max(0, Math.min(1, Number(autoPickMinConfidenceText) || 0)),
        lots: Math.max(1, Math.floor(Number(autoPickLotsText) || 1)),
        product: autoPickProduct,
      };

      const riskControls = {
        enabled: !!riskEnabled,
        max_open_positions: Math.max(0, Math.floor(Number(riskMaxOpenPositionsText) || 0)),
        min_option_ltp: Math.max(0, Number(riskMinOptionLtpText) || 0),
        max_premium_per_trade: Math.max(0, Number(riskMaxPremiumPerTradeText) || 0),
        max_daily_loss: Math.max(0, Number(riskMaxDailyLossText) || 0),
        stop_loss_pct: Math.max(0, Math.min(1, Number(riskStopLossPctText) || 0)),
        take_profit_pct: Math.max(0, Math.min(1, Number(riskTakeProfitPctText) || 0)),
      };

      const instruments = rows
        .map((r) => normalizeFoInstrument(r))
        .filter((r) => !!r.tradingsymbol) as any;

      const next: FOSettings = {
        enable_paper: settings?.enable_paper ?? true,
        enable_live: settings?.enable_live ?? false,
        auto_pick_defaults: autoPickDefaults as any,
        risk_controls: riskControls as any,
        instruments,
      };

      const res = await foApi.updateSettings(next);
      if (res.error) {
        setMsg(`Save failed: ${formatApiError(res.error)}`);
        return;
      }

      const saved = res.data as FOSettings;
      setSettings(saved);
      setRows(
        (saved?.instruments || [])
          .map((x: FOInstrumentConfig) => normalizeFoInstrument(x as any))
          .filter((x) => !!x.tradingsymbol)
      );
      show('Saved F&O settings');
    } catch (e: any) {
      setMsg(`Save failed: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setRunBusy(true);
    setMsg('');
    setLastRun(null);
    setRunNowPnl({});
    setRunNowPnlUpdatedAt('');

    try {
      try {
        window.dispatchEvent(new Event('marketintel:fo-exec-status-refresh'));
        window.dispatchEvent(new CustomEvent('marketintel:fo-exec-status-poll', { detail: { enabled: true } }));
      } catch {
        // ignore
      }

      const res = await foApi.runLiveAuto({
        confirm: !!confirmLive,
        allow_sell: !!allowSell,
        confirm_sell: !!confirmSell,
      });
      if (res.error) {
        setMsg(`Run failed: ${formatApiError(res.error)}`);
        return;
      }

      setLastRun(res.data as any);
      setPersistedExecStatus({
        ...((persistedExecStatus as any) || {}),
        lastRun: res.data,
        updatedAt: new Date().toISOString(),
      });
      show('Live run completed');
    } catch (e: any) {
      setMsg(`Run failed: ${formatApiError(e)}`);
    } finally {
      setRunBusy(false);
      try {
        window.dispatchEvent(new CustomEvent('marketintel:fo-exec-status-poll', { detail: { enabled: !!foAnyLoopRunningRef.current } }));
      } catch {
        // ignore
      }
    }
  }

  function executionSummary(it: any): string {
    const steps = Array.isArray(it?.execution_steps) ? it.execution_steps : [];
    if (!steps.length) return it?.executed ? 'EXECUTED' : 'SKIPPED';

    // If a risk-control gate blocked execution, make it obvious.
    for (const s of steps) {
      const t = String(s?.type || '').trim().toLowerCase();
      const st = String(s?.status || '').trim().toUpperCase();
      const err = String(s?.error || s?.reason || '').trim();
      if (t === 'open' && st === 'ERROR' && err && /^risk\s*:/i.test(err)) {
        return `RISK BLOCK: ${err.replace(/^risk\s*:\s*/i, '').trim()}`;
      }
      if (t === 'risk' && err) {
        return `RISK BLOCK: ${err.replace(/^risk\s*:\s*/i, '').trim()}`;
      }
    }

    const parts = steps
      .map((s: any) => {
        const t = String(s?.type || '').trim();
        const st = String(s?.status || '').trim();
        if (!t && !st) return '';
        return `${t}:${st}`;
      })
      .filter(Boolean);
    return parts.join(' · ');
  }

  function extractAnalytics(it: any): any | null {
    const steps = Array.isArray(it?.execution_steps) ? it.execution_steps : [];
    const a = steps.find((s: any) => String(s?.type || '').toLowerCase() === 'analytics' && s?.data != null);
    return a?.data ?? null;
  }

  async function refreshRunNowPnlSnapshot() {
    if (!lastRun) return;
    try {
      const posRes = await foApi.paperPositions();
      const positions = (posRes.data as any[]) || [];
      const entryByTs = new Map<string, { entry: number; qty: number }>();
      for (const p of positions) {
        const ts = String(p?.tradingsymbol || '').trim().toUpperCase();
        const entry = Number(p?.entry_price);
        const qty = Number(p?.quantity);
        if (!ts) continue;
        if (!Number.isFinite(entry) || entry <= 0) continue;
        if (!Number.isFinite(qty) || qty === 0) continue;
        entryByTs.set(ts, { entry, qty });
      }

      const tss: string[] = ((lastRun.items || []) as any[])
        .map((it: any) => String(it?.tradingsymbol || '').trim().toUpperCase())
        .filter(Boolean);
      const uniq = Array.from(new Set<string>(tss)) as string[];
      if (!uniq.length) {
        setMsg('No tradingsymbols found to refresh P/L.');
        return;
      }

      const ltpRes = await foApi.ltp(uniq.map((ts) => `NFO:${ts}`));
      const items = (ltpRes.data as any)?.items || {};

      const next: Record<string, { entry: number; ltp: number; qty: number; pnl: number }> = {};
      for (const ts of uniq) {
        const sym = String(ts);
        const k = `NFO:${sym}`.toUpperCase();
        const ltp = Number(items?.[k]);
        const e = entryByTs.get(sym);
        if (!e) continue;
        if (!Number.isFinite(ltp) || ltp <= 0) continue;
        const pnl = (ltp - e.entry) * e.qty;
        next[sym] = { entry: e.entry, ltp, qty: e.qty, pnl };
      }
      setRunNowPnl(next);
      setRunNowPnlUpdatedAt(new Date().toISOString());
      show('P/L snapshot refreshed');
    } catch (e: any) {
      setMsg(`Failed to refresh P/L: ${formatApiError(e)}`);
    }
  }

  async function refreshAutoPickPnlSnapshot() {
    if (!autoPickRes) return;
    try {
      const posRes = await foApi.paperPositions();
      const positions = (posRes.data as any[]) || [];
      const entryByTs = new Map<string, { entry: number; qty: number }>();
      for (const p of positions) {
        const ts = String(p?.tradingsymbol || '').trim().toUpperCase();
        const entry = Number(p?.entry_price);
        const qty = Number(p?.quantity);
        if (!ts) continue;
        if (!Number.isFinite(entry) || entry <= 0) continue;
        if (!Number.isFinite(qty) || qty === 0) continue;
        entryByTs.set(ts, { entry, qty });
      }

      const tss = (autoPickRes.items || [])
        .map((it: any) => String(it?.tradingsymbol || '').trim().toUpperCase())
        .filter(Boolean);
      const uniq = Array.from(new Set(tss));
      if (!uniq.length) {
        setAutoPickMsg('No tradingsymbols found to refresh P/L.');
        return;
      }

      const ltpRes = await foApi.ltp(uniq.map((ts) => `NFO:${ts}`));
      const items = (ltpRes.data as any)?.items || {};

      const next: Record<string, { entry: number; ltp: number; qty: number; pnl: number }> = {};
      for (const ts of uniq) {
        const k = `NFO:${ts}`.toUpperCase();
        const ltp = Number(items?.[k]);
        const e = entryByTs.get(ts);
        if (!e) continue;
        if (!Number.isFinite(ltp) || ltp <= 0) continue;
        const pnl = (ltp - e.entry) * e.qty;
        next[ts] = { entry: e.entry, ltp, qty: e.qty, pnl };
      }
      setAutoPickPnl(next);
      setAutoPickPnlUpdatedAt(new Date().toISOString());
      show('P/L snapshot refreshed');
    } catch (e: any) {
      setAutoPickMsg(`Failed to refresh P/L: ${formatApiError(e)}`);
    }
  }

  async function runAutoPickNow() {
    setAutoPickBusy(true);
    setAutoPickMsg('');
    setAutoPickRes(null);
    setAutoPickPnl({});
    setAutoPickPnlUpdatedAt('');

    try {
      try {
        window.dispatchEvent(new Event('marketintel:fo-exec-status-refresh'));
        window.dispatchEvent(new CustomEvent('marketintel:fo-exec-status-poll', { detail: { enabled: true } }));
      } catch {
        // ignore
      }

      const underlyings = parseUnderlyingsText(autoPickUnderlyingsText);
      if (underlyings.length === 0) {
        setAutoPickMsg('Please provide at least one underlying symbol (one per line).');
        return;
      }

      const payload = {
        underlyings,
        max_picks: Math.max(1, Math.floor(Number(autoPickMaxPicksText) || 1)),
        min_confidence: Math.max(0, Math.min(1, Number(autoPickMinConfidenceText) || 0)),
        lots: Math.max(1, Math.floor(Number(autoPickLotsText) || 1)),
        exchange: 'NFO',
        product: autoPickProduct,
        allow_sell: !!autoPickAllowSell,
        confirm: autoPickMode === 'live' ? !!autoPickConfirmLive : false,
        confirm_sell: autoPickMode === 'live' ? !!autoPickConfirmSell : false,
      } as any;

      const res = autoPickMode === 'paper' ? await foApi.runPaperAutoPick(payload) : await foApi.runLiveAutoPick(payload);
      if (res.error) {
        setAutoPickMsg(`Auto-pick failed: ${formatApiError(res.error)}`);
        return;
      }

      setAutoPickRes(res.data as any);
      setPersistedExecStatus({
        ...((persistedExecStatus as any) || {}),
        autoPickRes: res.data,
        updatedAt: new Date().toISOString(),
      });
      show('Auto-pick completed');

      if (autoPickMode === 'paper') {
        await refreshPaperPositions();
      }
      try {
        window.dispatchEvent(new Event('marketintel:fo-exec-status-refresh'));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setAutoPickMsg(`Auto-pick failed: ${formatApiError(e)}`);
    } finally {
      setAutoPickBusy(false);
      try {
        window.dispatchEvent(
          new CustomEvent('marketintel:fo-exec-status-poll', { detail: { enabled: !!foAnyLoopRunningRef.current || !!runBusy } })
        );
      } catch {
        // ignore
      }
    }
  }

  async function loadExpiries() {
    setPickerExpiries([]);
    setPickerContracts([]);
    setPickerExpiry('');
    if (!pickerUnderlying) return;
    try {
      const res = await foApi.expiries(pickerUnderlying, pickerKind);
      const items = (res.data?.items || []) as string[];
      setPickerExpiries(items);
      if (items.length > 0) setPickerExpiry(items[0]);
    } catch (e: any) {
      setMsg(`Failed to load expiries: ${formatApiError(e)}`);
    }
  }

  async function loadContracts() {
    setPickerContracts([]);
    if (!pickerUnderlying) return;
    if (!pickerExpiry) return;
    try {
      const res = await foApi.contracts({
        underlying: pickerUnderlying,
        kind: pickerKind,
        expiry: pickerExpiry,
        option_type: pickerKind === 'OPT' ? pickerOptionType : null,
        limit: 200,
      });
      setPickerContracts((res.data || []) as FOContractOut[]);
    } catch (e: any) {
      setMsg(`Failed to load contracts: ${formatApiError(e)}`);
    }
  }

  async function searchUnderlyings() {
    if (!pickerQuery.trim()) return;
    setMsg('');
    try {
      const res = await foApi.underlyings(pickerQuery.trim(), 20);
      const items = (res.data?.items || []) as string[];
      if (items.length > 0) {
        setPickerUnderlying(items[0]);
      } else {
        show('No underlyings found');
      }
    } catch (e: any) {
      setMsg(`Underlying search failed: ${formatApiError(e)}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="card-title mb-2">Futures &amp; Options</div>
        <div className="text-sm text-gray-300">
          Configure NFO contracts, then run paper/live execution. Live mode requires confirmation.
        </div>
        {msg ? <div className="mt-3 text-sm text-red-300">{msg}</div> : null}
      </div>

      <FOExecutionStatusCard
        lastRun={lastRun || (persistedExecStatus as any)?.lastRun || null}
        autoPickRes={autoPickRes || (persistedExecStatus as any)?.autoPickRes || null}
      />

      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="card-title">Instruments</div>
          <div className="flex items-center gap-2">
            <TableMaximizeButton
              maximized={maxInstrumentsTable}
              onClick={() => setMaxInstrumentsTable((v) => !v)}
              title="Show extra columns and per-row details"
            />
            <button
              type="button"
              onClick={() => addRow('')}
              className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Add
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className={
                busy
                  ? 'px-3 py-2 rounded bg-gray-700 text-gray-300 cursor-not-allowed'
                  : 'px-3 py-2 rounded bg-gray-700 text-white hover:bg-gray-600'
              }
            >
              Save
            </button>
          </div>
        </div>

        <div className={`mt-3 overflow-auto ${maxInstrumentsTable ? 'max-h-screen' : ''}`}>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-300">
                <th className="py-2 pr-3">On</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Tradingsymbol</th>
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Action</th>
                {maxInstrumentsTable ? <th className="py-2 pr-3">Exchange</th> : null}
                {maxInstrumentsTable ? <th className="py-2 pr-3">Details</th> : null}
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody className="text-gray-100">
              {rows.length === 0 ? (
                <tr>
                  <td className="py-3 text-gray-400" colSpan={maxInstrumentsTable ? 9 : 7}>
                    No instruments configured.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.tradingsymbol}-${idx}`} className="border-t border-gray-800">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={!!r.enabled}
                        onChange={(e) =>
                          setRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], enabled: e.target.checked };
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={r.kind}
                        onChange={(e) =>
                          setRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], kind: e.target.value as any };
                            return next;
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      >
                        <option value="FUT">FUT</option>
                        <option value="OPT">OPT</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        value={r.tradingsymbol}
                        onChange={(e) =>
                          setRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], tradingsymbol: e.target.value };
                            return next;
                          })
                        }
                        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1"
                        placeholder="e.g. NIFTY24DEC25000CE"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={r.product}
                        onChange={(e) =>
                          setRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], product: e.target.value as any };
                            return next;
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      >
                        <option value="MIS">MIS</option>
                        <option value="NRML">NRML</option>
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min={1}
                        value={r.quantity}
                        onChange={(e) =>
                          setRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                            return next;
                          })
                        }
                        className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={r.strategy_action}
                        onChange={(e) =>
                          setRows((prev) => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], strategy_action: e.target.value as any };
                            return next;
                          })
                        }
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1"
                      >
                        <option value="HOLD">HOLD</option>
                        <option value="AUTO">AUTO</option>
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </td>
                    {maxInstrumentsTable ? <td className="py-2 pr-3 font-mono">{r.exchange}</td> : null}
                    {maxInstrumentsTable ? (
                      <td className="py-2 pr-3 text-xs text-gray-300">
                        <details>
                          <summary className="cursor-pointer select-none">Row</summary>
                          <pre className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded overflow-auto">{prettyJson(r)}</pre>
                        </details>
                      </td>
                    ) : null}
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 border-t border-gray-800 pt-4">
          <div className="card-title mb-2">Contract picker (from instruments cache)</div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-2 md:col-span-2"
              placeholder="Underlying search (e.g. NIFTY)"
            />
            <button
              type="button"
              onClick={searchUnderlyings}
              className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Find
            </button>

            <input
              value={pickerUnderlying}
              onChange={(e) => setPickerUnderlying(e.target.value.toUpperCase())}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-2 md:col-span-2"
              placeholder="Underlying (exact)"
            />

            <select
              value={pickerKind}
              onChange={(e) => setPickerKind(e.target.value as any)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-2"
            >
              <option value="FUT">FUT</option>
              <option value="OPT">OPT</option>
            </select>

            {pickerKind === 'OPT' ? (
              <select
                value={pickerOptionType}
                onChange={(e) => setPickerOptionType(e.target.value as any)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-2"
              >
                <option value="CE">CE</option>
                <option value="PE">PE</option>
              </select>
            ) : null}

            <button
              type="button"
              onClick={loadExpiries}
              className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Load expiries
            </button>

            <select
              value={pickerExpiry}
              onChange={(e) => setPickerExpiry(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-2 md:col-span-2"
            >
              {pickerExpiries.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={loadContracts}
              className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Load contracts
            </button>
          </div>

          <div className="mt-3 overflow-auto">
            <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-gray-500">Shows cached contracts (first 50).</div>
              <TableMaximizeButton
                maximized={maxContractsTable}
                onClick={() => setMaxContractsTable((v) => !v)}
                title="Show extra columns and per-row details"
              />
            </div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-300">
                  <th className="py-2 pr-3">Tradingsymbol</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Expiry</th>
                  <th className="py-2 pr-3">Strike</th>
                  <th className="py-2 pr-3">Lot</th>
                  {maxContractsTable ? <th className="py-2 pr-3">Exchange</th> : null}
                  {maxContractsTable ? <th className="py-2 pr-3">Token</th> : null}
                  {maxContractsTable ? <th className="py-2 pr-3">Name</th> : null}
                  {maxContractsTable ? <th className="py-2 pr-3">Details</th> : null}
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody className="text-gray-100">
                {pickerContracts.slice(0, 50).map((c) => (
                  <tr key={`${c.exchange}:${c.tradingsymbol}`} className="border-t border-gray-800">
                    <td className="py-2 pr-3">{c.tradingsymbol}</td>
                    <td className="py-2 pr-3">{c.instrument_type || '-'}</td>
                    <td className="py-2 pr-3">{c.expiry || '-'}</td>
                    <td className="py-2 pr-3">{typeof c.strike === 'number' ? fmt2(c.strike) : '-'}</td>
                    <td className="py-2 pr-3">{c.lot_size ?? '-'}</td>
                    {maxContractsTable ? <td className="py-2 pr-3 font-mono">{c.exchange || '-'}</td> : null}
                    {maxContractsTable ? <td className="py-2 pr-3 font-mono">{(c as any).instrument_token ?? '-'}</td> : null}
                    {maxContractsTable ? <td className="py-2 pr-3">{(c as any).name ?? '-'}</td> : null}
                    {maxContractsTable ? (
                      <td className="py-2 pr-3 text-xs text-gray-300">
                        <details>
                          <summary className="cursor-pointer select-none">Row</summary>
                          <pre className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded overflow-auto">{prettyJson(c)}</pre>
                        </details>
                      </td>
                    ) : null}
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => addRow(c.tradingsymbol)}
                        className="px-2 py-1 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pickerContracts.length > 50 ? (
              <div className="mt-2 text-xs text-gray-400">Showing first 50 contracts.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Auto-Picker (CE/PE)</div>
        <div className="text-sm text-gray-300">
          Provide an allow-list of underlyings. The system ranks them using the decision pipeline, selects nearest-expiry ATM CE/PE, and places BUY orders to open.
          Optional SELL is used only to exit when switching contracts.
        </div>
        {autoPickMsg ? <div className="mt-3 text-sm text-red-300">{autoPickMsg}</div> : null}

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-300">
              Underlyings allow-list (one per line)
              <textarea
                className="mt-1 w-full px-2 py-2 bg-gray-900 border border-gray-800 rounded font-mono text-xs"
                rows={6}
                value={autoPickUnderlyingsText}
                onChange={(e) => setAutoPickUnderlyingsText(e.target.value)}
                placeholder="NIFTY\nBANKNIFTY\nRELIANCE"
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadAutoPickUnderlyingsFromSettings()}
                className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
              >
                Load from Settings
              </button>
              <div className="text-xs text-gray-500">Uses Settings → Live Trading Automation Stocks.</div>
            </div>

            <div className="mt-4 border-t border-gray-800 pt-4">
              <div className="text-sm text-gray-200 font-medium">Advanced Models (Manual Train)</div>
              <div className="text-xs text-gray-500 mt-1">
                Trains XGB/HMM/GARCH/PPO for the underlyings currently listed above.
              </div>
              {advTrainMsg ? <div className="mt-2 text-sm text-red-300">{advTrainMsg}</div> : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={advTrainBusy}
                  onClick={runAdvancedTrainNow}
                  className={
                    advTrainBusy
                      ? 'px-3 py-2 rounded bg-gray-700 text-gray-300 cursor-not-allowed'
                      : 'px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700'
                  }
                >
                  {advTrainBusy ? 'Training…' : 'Train now'}
                </button>
                <div className="text-xs text-gray-500">
                  Selected: {parseUnderlyingsText(autoPickUnderlyingsText).length}
                </div>
              </div>

              {advTrainRes ? (
                <div className="mt-3">
                  <div className="text-xs text-gray-500">Last train result</div>
                  <div className="mt-2 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-300">
                          <th className="py-2 pr-3">Symbol</th>
                          <th className="py-2 pr-3">Trained</th>
                          <th className="py-2 pr-3">Bars</th>
                          <th className="py-2 pr-3">Horizon</th>
                          <th className="py-2 pr-3">XGB Acc</th>
                          <th className="py-2 pr-3">XGB F1</th>
                          <th className="py-2 pr-3">XGB AUC</th>
                          <th className="py-2 pr-3">GARCH</th>
                          <th className="py-2 pr-3">PPO</th>
                          <th className="py-2 pr-3">Error</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-100">
                        {(advTrainRes.items || []).map((it: any, idx: number) => (
                          <tr key={`${it?.symbol || 'sym'}-${idx}`} className="border-t border-gray-800">
                            <td className="py-2 pr-3 font-mono">{it?.symbol || '-'}</td>
                            <td className="py-2 pr-3">{it?.trained ? 'YES' : 'NO'}</td>
                            <td className="py-2 pr-3">{it?.n_bars ?? '-'}</td>
                            <td className="py-2 pr-3">{it?.horizon_minutes ?? '-'}</td>
                            <td className="py-2 pr-3">{typeof it?.xgb_accuracy === 'number' ? fmt2(it.xgb_accuracy) : '-'}</td>
                            <td className="py-2 pr-3">{typeof it?.xgb_f1 === 'number' ? fmt2(it.xgb_f1) : '-'}</td>
                            <td className="py-2 pr-3">{typeof it?.xgb_roc_auc === 'number' ? fmt2(it.xgb_roc_auc) : '-'}</td>
                            <td className="py-2 pr-3">{it?.garch_trained ? 'YES' : 'NO'}</td>
                            <td className="py-2 pr-3">{it?.ppo_trained ? 'YES' : 'NO'}</td>
                            <td className="py-2 pr-3 text-red-300">{it?.error || ''}</td>
                          </tr>
                        ))}
                        {(advTrainRes.items || []).length === 0 ? (
                          <tr><td colSpan={10} className="py-2 text-gray-500">No training items returned.</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-2 text-xs text-gray-300">
                    <details>
                      <summary className="cursor-pointer select-none">Raw JSON</summary>
                      <pre className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded overflow-auto">{prettyJson(advTrainRes)}</pre>
                    </details>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="text-gray-300">
              Max picks
              <input
                className="mt-1 w-full px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                value={autoPickMaxPicksText}
                onChange={(e) => setAutoPickMaxPicksText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(1, Math.floor(Number(autoPickMaxPicksText) || 1));
                  setAutoPickMaxPicksText(String(v));
                }}
                type="number"
                min={1}
                step={1}
              />
            </label>
            <label className="text-gray-300">
              Min confidence
              <input
                className="mt-1 w-full px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                value={autoPickMinConfidenceText}
                onChange={(e) => setAutoPickMinConfidenceText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Math.min(1, Number(autoPickMinConfidenceText) || 0));
                  setAutoPickMinConfidenceText(String(v));
                }}
                type="number"
                min={0}
                max={1}
                step={0.01}
              />
            </label>
            <label className="text-gray-300">
              Lots
              <input
                className="mt-1 w-full px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                value={autoPickLotsText}
                onChange={(e) => setAutoPickLotsText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(1, Math.floor(Number(autoPickLotsText) || 1));
                  setAutoPickLotsText(String(v));
                }}
                type="number"
                min={1}
                step={1}
              />
            </label>
            <label className="text-gray-300">
              Product
              <select
                className="mt-1 w-full px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                value={autoPickProduct}
                onChange={(e) => setAutoPickProduct(e.target.value as any)}
              >
                <option value="MIS">MIS</option>
                <option value="NRML">NRML</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={autoPickMode}
            onChange={(e) => {
              const v = e.target.value as any;
              setAutoPickMode(v);
              if (v !== 'live') {
                setAutoPickConfirmLive(false);
                setAutoPickConfirmSell(false);
              }
            }}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-2"
          >
            <option value="paper">Paper</option>
            <option value="live">Live</option>
          </select>

          {autoPickMode === 'live' ? (
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input type="checkbox" checked={autoPickConfirmLive} onChange={(e) => setAutoPickConfirmLive(e.target.checked)} />
              I understand this places real orders
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={autoPickAllowSell}
              onChange={(e) => {
                const v = e.target.checked;
                setAutoPickAllowSell(v);
                if (!v) setAutoPickConfirmSell(false);
              }}
            />
            Allow SELL (exit on switch)
          </label>

          {autoPickMode === 'live' && autoPickAllowSell ? (
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input type="checkbox" checked={autoPickConfirmSell} onChange={(e) => setAutoPickConfirmSell(e.target.checked)} />
              Confirm SELL (extra safety)
            </label>
          ) : null}

          <button
            type="button"
            disabled={
              (autoPickMode === 'paper'
                ? (foPaperAutoPickLoopBusy || !(settings?.enable_paper ?? true))
                : autoPickBusy || (!(settings?.enable_live ?? false) || !autoPickConfirmLive || (autoPickAllowSell && !autoPickConfirmSell)))
            }
            onClick={async () => {
              if (autoPickMode === 'paper') {
                if (foPaperAutoPickLoopStatus?.running) {
                  await stopFoPaperAutoPickLoop();
                } else {
                  await startFoPaperAutoPickLoop();
                }
                return;
              }
              await runAutoPickNow();
            }}
            className={
              (autoPickMode === 'paper'
                ? (foPaperAutoPickLoopBusy || !(settings?.enable_paper ?? true))
                : autoPickBusy || (!(settings?.enable_live ?? false) || !autoPickConfirmLive || (autoPickAllowSell && !autoPickConfirmSell)))
                ? 'px-3 py-2 rounded bg-gray-700 text-gray-300 cursor-not-allowed'
                : 'px-3 py-2 rounded bg-gray-700 text-white hover:bg-gray-600'
            }
          >
            {autoPickMode === 'paper'
              ? (foPaperAutoPickLoopStatus?.running ? (foPaperAutoPickLoopBusy ? 'Stopping…' : 'Stop auto-pick') : (foPaperAutoPickLoopBusy ? 'Starting…' : 'Run auto-pick'))
              : (autoPickBusy ? 'Running…' : 'Run auto-pick')}
          </button>

          {autoPickMode === 'paper' ? (
            <label className="text-sm text-gray-300">
              Interval (sec)
              <input
                className="ml-2 w-24 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                type="number"
                min={5}
                max={3600}
                step={1}
                value={foPaperAutoPickLoopIntervalSec}
                onChange={(e) => setFoPaperAutoPickLoopIntervalSec(Number(e.target.value))}
              />
            </label>
          ) : null}
        </div>

        {autoPickRes ? (
          <div className="mt-4">
            <div className="text-sm text-gray-300">
              Considered: <span className="text-gray-100">{autoPickRes.considered}</span> · Picked:{' '}
              <span className="text-gray-100">{autoPickRes.picked}</span> · Executed: <span className="text-gray-100">{autoPickRes.executed}</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-gray-500">Maximize shows extra columns + per-row details.</div>
              <TableMaximizeButton
                maximized={maxAutoPickTable}
                onClick={() => setMaxAutoPickTable((v) => !v)}
                title="Show extra columns and per-row details"
              />
            </div>

            {autoPickMode === 'paper' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={refreshAutoPickPnlSnapshot}
                  className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
                >
                  Refresh P/L snapshot
                </button>
                <div className="text-xs text-gray-500">
                  Uses current option LTP vs paper entry price{autoPickPnlUpdatedAt ? ` · Updated: ${autoPickPnlUpdatedAt}` : ''}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-gray-500">Live P/L is not computed here (needs positions/trades reconciliation).</div>
            )}

            <div className={`mt-3 overflow-auto ${maxAutoPickTable ? 'max-h-screen' : ''}`}>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-300">
                    <th className="py-2 pr-3">Underlying</th>
                    <th className="py-2 pr-3">Decision</th>
                    <th className="py-2 pr-3">Conf</th>
                    <th className="py-2 pr-3">Why</th>
                    <th className="py-2 pr-3">XGB Up</th>
                    <th className="py-2 pr-3">Regime</th>
                    <th className="py-2 pr-3">GARCH σ</th>
                    <th className="py-2 pr-3">PPO</th>
                    <th className="py-2 pr-3">Option</th>
                    <th className="py-2 pr-3">Contract</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Req Amt</th>
                    <th className="py-2 pr-3">UL LTP</th>
                    <th className="py-2 pr-3">Opt LTP</th>
                    <th className="py-2 pr-3">Entry</th>
                    <th className="py-2 pr-3">P/L</th>
                    <th className="py-2 pr-3">IV</th>
                    <th className="py-2 pr-3">Δ</th>
                    <th className="py-2 pr-3">Θ/day</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Steps</th>
                    {maxAutoPickTable ? <th className="py-2 pr-3">Exchange</th> : null}
                    {maxAutoPickTable ? <th className="py-2 pr-3">Product</th> : null}
                    {maxAutoPickTable ? <th className="py-2 pr-3">Demand rank</th> : null}
                    {maxAutoPickTable ? <th className="py-2 pr-3">Demand score</th> : null}
                    {maxAutoPickTable ? <th className="py-2 pr-3">Details</th> : null}
                    <th className="py-2 pr-3">Error</th>
                  </tr>
                </thead>
                <tbody className="text-gray-100">
                  {(autoPickRes.items || []).map((it: any, i: number) => (
                    <tr key={`${it.underlying}:${it.tradingsymbol || ''}:${i}`} className="border-t border-gray-800">
                      {(() => {
                        const ts = String(it?.tradingsymbol || '').trim().toUpperCase();
                        const qty = Number(it?.quantity);
                        const optLtp = typeof it?.option_ltp === 'number' ? Number(it.option_ltp) : NaN;
                        const reqAmt = Number.isFinite(optLtp) && Number.isFinite(qty) ? optLtp * qty : NaN;
                        const pnlRow = ts ? autoPickPnl[ts] : undefined;
                        const analytics = extractAnalytics(it);
                        const iv = Number(analytics?.iv);
                        const delta = Number(analytics?.delta);
                        const thetaDay = Number(analytics?.theta_per_day);
                        const contractScore = Number(analytics?.score);

                        const demand = (() => {
                          const steps = Array.isArray(it?.execution_steps) ? (it.execution_steps as any[]) : [];
                          const s = steps.find((x) => x && typeof x === 'object' && String(x.type || '').toLowerCase() === 'demand');
                          const data = s && typeof (s as any).data === 'object' ? (s as any).data : null;
                          return data && typeof data === 'object' ? data : null;
                        })();
                        const xgbUp = typeof it?.xgb_direction_prob_up === 'number' ? Number(it.xgb_direction_prob_up) : NaN;
                        const regime = String(it?.hmm_regime_label || '').trim();
                        const garchVol = typeof it?.garch_vol_forecast === 'number' ? Number(it.garch_vol_forecast) : NaN;
                        const ppoAction = String(it?.ppo_action || '').trim();
                        const ppoTitle = (() => {
                          const probs = it?.ppo_action_probs;
                          if (!probs || typeof probs !== 'object') return '';
                          try {
                            const entries = Object.entries(probs as any)
                              .filter(([k, v]) => typeof k === 'string' && typeof v === 'number')
                              .sort((a, b) => (b[1] as number) - (a[1] as number));
                            return entries.map(([k, v]) => `${k}:${fmt2(v as number)}`).join(' · ');
                          } catch {
                            return '';
                          }
                        })();
                        const regimeTitle = (() => {
                          const probs = it?.hmm_regime_probs;
                          if (!probs || typeof probs !== 'object') return '';
                          try {
                            const entries = Object.entries(probs as any)
                              .filter(([k, v]) => typeof k === 'string' && typeof v === 'number')
                              .sort((a, b) => (b[1] as number) - (a[1] as number));
                            return entries.map(([k, v]) => `${k}:${fmt2(v as number)}`).join(' · ');
                          } catch {
                            return '';
                          }
                        })();
                        return (
                          <>
                      <td className="py-2 pr-3">{it.underlying}</td>
                      <td className="py-2 pr-3">{it.decision_action}</td>
                      <td className="py-2 pr-3">{typeof it.confidence === 'number' ? fmt2(it.confidence) : '-'}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">
                        <details>
                          <summary className="cursor-pointer select-none">Details</summary>
                          <div className="mt-1 space-y-1">
                            {Array.isArray(it?.reason) && it.reason.length ? (
                              <div>
                                <div className="text-gray-400">Decision reasons</div>
                                <div className="text-gray-200">{it.reason.join(' · ')}</div>
                              </div>
                            ) : (
                              <div className="text-gray-500">No reason provided</div>
                            )}

                            {demand ? (
                              <div>
                                <div className="text-gray-400">Demand filter</div>
                                <div className="text-gray-200">
                                  Rank: {typeof demand.rank === 'number' ? demand.rank : '-'} · Score:{' '}
                                  {typeof demand.score === 'number' ? fmt2(demand.score) : '-'}
                                  {demand.reason ? ` · Note: ${String(demand.reason)}` : ''}
                                </div>
                              </div>
                            ) : (
                              <div className="text-gray-500">Demand filter: -</div>
                            )}

                            <div>
                              <div className="text-gray-400">Contract selection</div>
                              <div className="text-gray-200">
                                Score: {Number.isFinite(contractScore) ? fmt2(contractScore) : '-'} · IV:{' '}
                                {Number.isFinite(iv) ? `${fmt2(iv * 100)}%` : '-'} · Δ: {Number.isFinite(delta) ? fmt2(delta) : '-'} · Θ/day:{' '}
                                {Number.isFinite(thetaDay) ? fmt2(thetaDay) : '-'}
                              </div>
                            </div>
                          </div>
                        </details>
                      </td>
                      <td className="py-2 pr-3">{Number.isFinite(xgbUp) ? fmt2(xgbUp) : '-'}</td>
                      <td className="py-2 pr-3" title={regimeTitle}>{regime || '-'}</td>
                      <td className="py-2 pr-3">{Number.isFinite(garchVol) ? `${fmt2(garchVol * 100)}%` : '-'}</td>
                      <td className="py-2 pr-3" title={ppoTitle}>{ppoAction || '-'}</td>
                      <td className="py-2 pr-3">{it.option_type || '-'}</td>
                      <td className="py-2 pr-3">{it.tradingsymbol || '-'}</td>
                      <td className="py-2 pr-3">{typeof it.quantity === 'number' ? it.quantity : '-'}</td>
                      <td className="py-2 pr-3">{Number.isFinite(reqAmt) ? fmt2(reqAmt) : '-'}</td>
                      <td className="py-2 pr-3">{typeof it.underlying_ltp === 'number' ? fmt2(it.underlying_ltp) : '-'}</td>
                      <td className="py-2 pr-3">{typeof it.option_ltp === 'number' ? fmt2(it.option_ltp) : '-'}</td>
                      <td className="py-2 pr-3">{pnlRow ? fmt2(pnlRow.entry) : '-'}</td>
                      <td className={`py-2 pr-3 ${pnlRow ? pnlTextClass(pnlRow.pnl) : ''}`}>{pnlRow ? fmt2(pnlRow.pnl) : '-'}</td>
                      <td className="py-2 pr-3">{Number.isFinite(iv) ? `${fmt2(iv * 100)}%` : '-'}</td>
                      <td className="py-2 pr-3">{Number.isFinite(delta) ? fmt2(delta) : '-'}</td>
                      <td className={`py-2 pr-3 ${Number.isFinite(thetaDay) ? pnlTextClass(thetaDay) : ''}`}>{Number.isFinite(thetaDay) ? fmt2(thetaDay) : '-'}</td>
                      <td className="py-2 pr-3">{it.executed ? 'EXECUTED' : 'SKIPPED'}</td>
                      <td className="py-2 pr-3 text-xs text-gray-300">{executionSummary(it)}</td>
                      {maxAutoPickTable ? <td className="py-2 pr-3 font-mono">{it.exchange || 'NFO'}</td> : null}
                      {maxAutoPickTable ? <td className="py-2 pr-3">{it.product || '-'}</td> : null}
                      {maxAutoPickTable ? <td className="py-2 pr-3">{demand && typeof demand.rank === 'number' ? demand.rank : '-'}</td> : null}
                      {maxAutoPickTable ? <td className="py-2 pr-3">{demand && typeof demand.score === 'number' ? fmt2(demand.score) : '-'}</td> : null}
                      {maxAutoPickTable ? (
                        <td className="py-2 pr-3 text-xs text-gray-300">
                          <details>
                            <summary className="cursor-pointer select-none">Row</summary>
                            <pre className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded overflow-auto">{prettyJson(it)}</pre>
                          </details>
                        </td>
                      ) : null}
                      <td className="py-2 pr-3 text-red-300">{it.error || ''}</td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3">
              <div className="text-xs text-gray-400">Raw response (includes execution steps)</div>
              <pre className="mt-1 p-2 bg-gray-900 border border-gray-800 rounded overflow-auto text-xs">{prettyJson(autoPickRes)}</pre>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Control</div>

        <div className="mb-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={!!(settings?.enable_paper ?? true)}
              onChange={(e) => setSettings((prev) => ({
                ...(prev as any || {}),
                enable_paper: e.target.checked,
                enable_live: prev?.enable_live ?? false,
                instruments: prev?.instruments ?? [],
              }))}
            />
            Enable paper
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={!!(settings?.enable_live ?? false)}
              onChange={(e) => setSettings((prev) => ({
                ...(prev as any || {}),
                enable_paper: prev?.enable_paper ?? true,
                enable_live: e.target.checked,
                instruments: prev?.instruments ?? [],
              }))}
            />
            Enable live
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={save}
            className={
              busy
                ? 'px-3 py-2 rounded bg-gray-700 text-gray-300 cursor-not-allowed'
                : 'px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700'
            }
          >
            Save control settings
          </button>
        </div>

        <div className="border-t border-gray-800 pt-3">
          <div className="text-sm text-gray-200">Risk controls</div>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input type="checkbox" checked={!!riskEnabled} onChange={(e) => setRiskEnabled(e.target.checked)} />
              Enable
            </label>

            <label className="text-sm text-gray-300">
              Max open positions
              <input
                className="ml-2 w-24 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                inputMode="numeric"
                value={riskMaxOpenPositionsText}
                onChange={(e) => setRiskMaxOpenPositionsText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Math.floor(Number(riskMaxOpenPositionsText) || 0));
                  setRiskMaxOpenPositionsText(String(v));
                }}
              />
            </label>

            <label className="text-sm text-gray-300">
              Min option LTP
              <input
                className="ml-2 w-28 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                inputMode="decimal"
                value={riskMinOptionLtpText}
                onChange={(e) => setRiskMinOptionLtpText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Number(riskMinOptionLtpText) || 0);
                  setRiskMinOptionLtpText(String(v));
                }}
              />
            </label>

            <label className="text-sm text-gray-300">
              Max premium / trade
              <input
                className="ml-2 w-32 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                inputMode="decimal"
                value={riskMaxPremiumPerTradeText}
                onChange={(e) => setRiskMaxPremiumPerTradeText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Number(riskMaxPremiumPerTradeText) || 0);
                  setRiskMaxPremiumPerTradeText(String(v));
                }}
              />
            </label>

            <label className="text-sm text-gray-300">
              Max daily loss
              <input
                className="ml-2 w-28 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                inputMode="decimal"
                value={riskMaxDailyLossText}
                onChange={(e) => setRiskMaxDailyLossText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Number(riskMaxDailyLossText) || 0);
                  setRiskMaxDailyLossText(String(v));
                }}
              />
            </label>

            <label className="text-sm text-gray-300">
              Stop-loss (0-1)
              <input
                className="ml-2 w-24 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                inputMode="decimal"
                value={riskStopLossPctText}
                onChange={(e) => setRiskStopLossPctText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Math.min(1, Number(riskStopLossPctText) || 0));
                  setRiskStopLossPctText(String(v));
                }}
              />
            </label>

            <label className="text-sm text-gray-300">
              Take-profit (0-1)
              <input
                className="ml-2 w-24 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                inputMode="decimal"
                value={riskTakeProfitPctText}
                onChange={(e) => setRiskTakeProfitPctText(e.target.value)}
                onBlur={() => {
                  const v = Math.max(0, Math.min(1, Number(riskTakeProfitPctText) || 0));
                  setRiskTakeProfitPctText(String(v));
                }}
              />
            </label>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Notes: set 0 to disable a limit. SL/TP only applies when SELL is allowed.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={runMode}
            onChange={(e) => setRunMode(e.target.value as any)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-2"
          >
            <option value="paper">Paper</option>
            <option value="live">Live</option>
          </select>

          {runMode === 'live' ? (
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} />
              I understand this places real orders
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={allowSell} onChange={(e) => setAllowSell(e.target.checked)} />
            Allow SELL
          </label>

          {runMode === 'live' && allowSell ? (
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input type="checkbox" checked={confirmSell} onChange={(e) => setConfirmSell(e.target.checked)} />
              Confirm SELL (extra safety)
            </label>
          ) : null}

          <button
            type="button"
            disabled={
              (runMode === 'paper'
                ? (foPaperAutoRunLoopBusy || !(settings?.enable_paper ?? true))
                : runBusy || (!(settings?.enable_live ?? false) || !confirmLive || (allowSell && !confirmSell)))
            }
            onClick={async () => {
              if (runMode === 'paper') {
                if (foPaperAutoRunLoopStatus?.running) {
                  await stopFoPaperAutoRunLoop();
                } else {
                  await startFoPaperAutoRunLoop();
                }
                return;
              }
              await runNow();
            }}
            className={
              (runMode === 'paper'
                ? (foPaperAutoRunLoopBusy || !(settings?.enable_paper ?? true))
                : runBusy || (!(settings?.enable_live ?? false) || !confirmLive || (allowSell && !confirmSell)))
                ? 'px-3 py-2 rounded bg-gray-700 text-gray-300 cursor-not-allowed'
                : 'px-3 py-2 rounded bg-gray-700 text-white hover:bg-gray-600'
            }
          >
            {runMode === 'paper'
              ? (foPaperAutoRunLoopStatus?.running ? (foPaperAutoRunLoopBusy ? 'Stopping…' : 'Stop') : (foPaperAutoRunLoopBusy ? 'Starting…' : 'Run now'))
              : (runBusy ? 'Running…' : 'Run now')}
          </button>

          {runMode === 'paper' ? (
            <label className="text-sm text-gray-300">
              Interval (sec)
              <input
                className="ml-2 w-24 px-2 py-1 bg-gray-900 border border-gray-800 rounded"
                type="number"
                min={5}
                max={3600}
                step={1}
                value={foPaperAutoRunLoopIntervalSec}
                onChange={(e) => setFoPaperAutoRunLoopIntervalSec(Number(e.target.value))}
              />
            </label>
          ) : null}
        </div>

        {lastRun ? (
          <div className="mt-4">
            <div className="text-sm text-gray-300">
              Considered: <span className="text-gray-100">{lastRun.considered}</span> · Executed:{' '}
              <span className="text-gray-100">{lastRun.executed}</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-gray-500">Maximize shows extra columns + per-row details.</div>
              <TableMaximizeButton
                maximized={maxRunNowTable}
                onClick={() => setMaxRunNowTable((v) => !v)}
                title="Show extra columns and per-row details"
              />
            </div>

            {runMode === 'paper' ? (
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={refreshRunNowPnlSnapshot}
                  className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
                >
                  Refresh P/L snapshot
                </button>
                {runNowPnlUpdatedAt ? <div className="text-xs text-gray-500">Updated: {runNowPnlUpdatedAt}</div> : null}
              </div>
            ) : null}

            <div className={`mt-3 overflow-auto ${maxRunNowTable ? 'max-h-screen' : ''}`}>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-300">
                    <th className="py-2 pr-3">Underlying</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Contract</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Req Amt</th>
                    <th className="py-2 pr-3">UL LTP</th>
                    <th className="py-2 pr-3">Opt LTP</th>
                    <th className="py-2 pr-3">Entry</th>
                    <th className="py-2 pr-3">P/L</th>
                    <th className="py-2 pr-3">IV</th>
                    <th className="py-2 pr-3">Δ</th>
                    <th className="py-2 pr-3">Θ/day</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Steps</th>
                    {maxRunNowTable ? <th className="py-2 pr-3">Exchange</th> : null}
                    {maxRunNowTable ? <th className="py-2 pr-3">Product</th> : null}
                    {maxRunNowTable ? <th className="py-2 pr-3">Kind</th> : null}
                    {maxRunNowTable ? <th className="py-2 pr-3">Option</th> : null}
                    {maxRunNowTable ? <th className="py-2 pr-3">Details</th> : null}
                    <th className="py-2 pr-3">Error</th>
                  </tr>
                </thead>
                <tbody className="text-gray-100">
                  {(lastRun.items || []).map((it: any, i: number) => (
                    <tr key={`${it.exchange}:${it.tradingsymbol}:${i}`} className="border-t border-gray-800">
                      {(() => {
                        const ts = String(it?.tradingsymbol || '').trim().toUpperCase();
                        const pnlRow = ts ? runNowPnl[ts] : null;
                        const a = extractAnalytics(it);
                        const iv = Number(a?.iv);
                        const delta = Number(a?.delta);
                        const thetaDay = Number(a?.theta_per_day);
                        const optLtp = typeof it.option_ltp === 'number' ? it.option_ltp : it.ltp;
                        const reqAmt =
                          typeof it.required_amount === 'number'
                            ? it.required_amount
                            : typeof optLtp === 'number'
                              ? optLtp * Number(it.quantity || 0)
                              : null;
                        const entry = pnlRow?.entry ?? (typeof it.entry_price === 'number' ? it.entry_price : null);
                        const pnl = pnlRow?.pnl ?? null;

                        return (
                          <>
                            <td className="py-2 pr-3 font-mono">{it.underlying || '—'}</td>
                            <td className="py-2 pr-3">{it.action}</td>
                            <td className="py-2 pr-3 font-mono">{it.tradingsymbol}</td>
                            <td className="py-2 pr-3">{it.quantity}</td>
                            <td className="py-2 pr-3">{typeof reqAmt === 'number' ? fmt2(reqAmt) : '-'}</td>
                            <td className="py-2 pr-3">{typeof it.underlying_ltp === 'number' ? fmt2(it.underlying_ltp) : '-'}</td>
                            <td className="py-2 pr-3">{typeof optLtp === 'number' ? fmt2(optLtp) : '-'}</td>
                            <td className="py-2 pr-3">{typeof entry === 'number' ? fmt2(entry) : '-'}</td>
                            <td className={`py-2 pr-3 ${typeof pnl === 'number' ? pnlTextClass(pnl) : ''}`}>{typeof pnl === 'number' ? fmt2(pnl) : '-'}</td>
                            <td className="py-2 pr-3">{Number.isFinite(iv) ? `${fmt2(iv * 100)}%` : '-'}</td>
                            <td className="py-2 pr-3">{Number.isFinite(delta) ? fmt2(delta) : '-'}</td>
                            <td className={`py-2 pr-3 ${Number.isFinite(thetaDay) ? pnlTextClass(thetaDay) : ''}`}>{Number.isFinite(thetaDay) ? fmt2(thetaDay) : '-'}</td>
                            <td className="py-2 pr-3">{it.executed ? 'EXECUTED' : 'SKIPPED'}</td>
                            <td className="py-2 pr-3 text-xs text-gray-300">{executionSummary(it)}</td>
                            {maxRunNowTable ? <td className="py-2 pr-3 font-mono">{it.exchange || '-'}</td> : null}
                            {maxRunNowTable ? <td className="py-2 pr-3">{it.product || '-'}</td> : null}
                            {maxRunNowTable ? <td className="py-2 pr-3">{it.kind || '-'}</td> : null}
                            {maxRunNowTable ? <td className="py-2 pr-3">{it.option_type || '-'}</td> : null}
                            {maxRunNowTable ? (
                              <td className="py-2 pr-3 text-xs text-gray-300">
                                <details>
                                  <summary className="cursor-pointer select-none">Row</summary>
                                  <pre className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded overflow-auto">{prettyJson(it)}</pre>
                                </details>
                              </td>
                            ) : null}
                            <td className="py-2 pr-3 text-red-300">{it.error || ''}</td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3">
              <div className="text-xs text-gray-400">Raw response (includes execution steps)</div>
              <pre className="mt-1 p-2 bg-gray-900 border border-gray-800 rounded overflow-auto text-xs">{prettyJson(lastRun)}</pre>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="card-title">Paper positions</div>
          <div className="flex items-center gap-2">
            <TableMaximizeButton
              maximized={maxPaperPositionsTable}
              onClick={() => setMaxPaperPositionsTable((v) => !v)}
              title="Show extra columns and per-row details"
            />
            <button
              type="button"
              onClick={refreshPaperPositions}
              className="px-3 py-2 rounded bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className={`mt-3 overflow-auto ${maxPaperPositionsTable ? 'max-h-screen' : ''}`}>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-300">
                <th className="py-2 pr-3">Contract</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Entry</th>
                <th className="py-2 pr-3">Opened</th>
                {maxPaperPositionsTable ? <th className="py-2 pr-3">Exchange</th> : null}
                {maxPaperPositionsTable ? <th className="py-2 pr-3">Source</th> : null}
                {maxPaperPositionsTable ? <th className="py-2 pr-3">Underlying</th> : null}
                {maxPaperPositionsTable ? <th className="py-2 pr-3">Details</th> : null}
              </tr>
            </thead>
            <tbody className="text-gray-100">
              {paperPositions.length === 0 ? (
                <tr>
                  <td className="py-3 text-gray-400" colSpan={maxPaperPositionsTable ? 8 : 4}>
                    No open paper positions.
                  </td>
                </tr>
              ) : (
                paperPositions.map((p: any, i: number) => (
                  <tr key={`${p.exchange}:${p.tradingsymbol}:${i}`} className="border-t border-gray-800">
                    <td className="py-2 pr-3">{p.tradingsymbol}</td>
                    <td className="py-2 pr-3">{p.quantity}</td>
                    <td className="py-2 pr-3">{typeof p.entry_price === 'number' ? fmt2(p.entry_price) : '-'}</td>
                    <td className="py-2 pr-3">{p.opened_at || '-'}</td>
                    {maxPaperPositionsTable ? <td className="py-2 pr-3 font-mono">{p.exchange || '-'}</td> : null}
                    {maxPaperPositionsTable ? <td className="py-2 pr-3">{p?.meta?.source || p?.metadata?.source || '-'}</td> : null}
                    {maxPaperPositionsTable ? <td className="py-2 pr-3">{p?.meta?.underlying || p?.metadata?.underlying || '-'}</td> : null}
                    {maxPaperPositionsTable ? (
                      <td className="py-2 pr-3 text-xs text-gray-300">
                        <details>
                          <summary className="cursor-pointer select-none">Row</summary>
                          <pre className="mt-1 p-2 bg-gray-950 border border-gray-800 rounded overflow-auto">{prettyJson(p)}</pre>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!text) return resolve(false);
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => resolve(true))
          .catch(() => resolve(false));
        return;
      }
    } catch {
      // fall through
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      resolve(ok);
    } catch {
      resolve(false);
    }
  });
}

type StockRow = {
  ticker: string;
  name: string;
  sector?: string | null;
  last?: LastCloseResponseItem;
};

function LiveAutomationSettingsTab() {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [symbols, setSymbols] = useState<SymbolRef[]>([]);
  const [pricesByTicker, setPricesByTicker] = useState<Record<string, FeatureSnapshotItem>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const headerRef = useRef<HTMLInputElement | null>(null);
  const fetchInFlightRef = useRef(false);

  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [selectedOnly, setSelectedOnly] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setBusy(true);
      setMsg('');
      try {
        const res = await symbolsApi.all(2000);
        const data = (res.data || []) as SymbolRef[];
        if (mounted) setSymbols(data);
      } catch (e: any) {
        if (mounted) setMsg(`Failed to load symbols: ${formatApiError(e)}`);
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await getTradingAutomationSettings();
        const saved = (cfg?.live_selected_symbols ?? null) as string[] | null;
        if (!mounted) return;

        // If not configured yet (null), keep all unchecked.
        if (saved === null) {
          setSelected({});
          return;
        }

        const next: Record<string, boolean> = {};
        for (const t of saved) {
          const k = (t || '').trim().toUpperCase();
          if (k) next[k] = true;
        }
        setSelected(next);
      } catch (e: any) {
        if (mounted) setMsg(`Failed to load trading settings: ${formatApiError(e)}`);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const rows = (symbols || [])
    .map((s) => {
      const t = (s.ticker || '').trim().toUpperCase();
      return {
        ticker: t,
        name: (s.name || '').toString(),
        sector: (((s as any)?.sector || '') as string).toString() || null,
      };
    })
    .filter((r) => !!r.ticker)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  useEffect(() => {
    if (!rows.length) return;
    if (Object.keys(pricesByTicker).length > 0) return;

    // Load prices once so price filters and price column work.
    // Uses local DB latest OHLCV (not live LTP).
    (async () => {
      try {
        if (fetchInFlightRef.current) return;
        fetchInFlightRef.current = true;
        setBusy(true);
        setMsg('Loading latest prices…');
        const tickers = rows.map((r) => r.ticker).filter(Boolean);
        // Initial load: keep it light (no options chain).
        const res = await marketDataApi.featureSnapshot(tickers, 2000, false);
        const items = (res.data || []) as FeatureSnapshotItem[];
        const next: Record<string, FeatureSnapshotItem> = {};
        for (const it of items) {
          if (it?.symbol) next[it.symbol.toUpperCase()] = it;
        }
        setPricesByTicker(next);
        setMsg(`Prices loaded for ${items.length} symbols.`);
      } catch (e: any) {
        setMsg(`Failed to load prices: ${formatApiError(e)}`);
      } finally {
        setBusy(false);
        fetchInFlightRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const sectors = useRef<string[]>([]);
  useEffect(() => {
    const uniq = new Set<string>();
    for (const r of rows) {
      const v = (r.sector || '').toString();
      if (v.trim()) uniq.add(v.trim());
    }
    sectors.current = Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = ((): Array<{ ticker: string; name: string; sector: string | null }> => {
    const text = q.trim().toLowerCase();
    const sec = sector.trim().toLowerCase();
    const minV = minPrice.trim() ? Number(minPrice) : null;
    const maxV = maxPrice.trim() ? Number(maxPrice) : null;

    return rows.filter((r) => {
      if (selectedOnly && !selected[r.ticker]) return false;

      if (text) {
        const t = (r.ticker || '').toLowerCase();
        const n = (r.name || '').toLowerCase();
        if (!(t.includes(text) || n.includes(text))) return false;
      }

      if (sec) {
        const secVal = (r.sector || '').toString().toLowerCase();
        if (secVal !== sec) return false;
      }

      if (minV != null || maxV != null) {
        const p = pricesByTicker[r.ticker]?.close;
        if (typeof p !== 'number') return false;
        if (minV != null && p < minV) return false;
        if (maxV != null && p > maxV) return false;
      }

      return true;
    });
  })();

  const allTickers = rows.map((r) => r.ticker);
  const visibleTickers = filteredRows.map((r) => r.ticker);

  const selectedCount = allTickers.reduce((acc, t) => acc + (selected[t] ? 1 : 0), 0);
  const visibleSelectedCount = visibleTickers.reduce((acc, t) => acc + (selected[t] ? 1 : 0), 0);

  const allSelected = visibleTickers.length > 0 && visibleSelectedCount === visibleTickers.length;
  const someSelected = visibleSelectedCount > 0 && !allSelected;

  useEffect(() => {
    if (!headerRef.current) return;
    headerRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleAll(checked: boolean) {
    setSelected(() => {
      const next: Record<string, boolean> = {};
      if (checked) {
        for (const t of visibleTickers) next[t] = true;
      }
      return next;
    });
  }

  async function refreshPricesForCurrentFilter() {
    try {
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      setBusy(true);
      setMsg('');

      const tickers = filteredRows.map((r) => r.ticker).filter(Boolean);
      if (!tickers.length) {
        setMsg('No symbols in current filter.');
        return;
      }
      // Filter refresh: include options-derived features when the batch is small.
      const includeOptions = tickers.length <= 25;
      const res = await marketDataApi.featureSnapshot(tickers, 2000, includeOptions);
      const items = (res.data || []) as FeatureSnapshotItem[];
      const next: Record<string, FeatureSnapshotItem> = {};
      for (const it of items) {
        if (it?.symbol) next[it.symbol.toUpperCase()] = it;
      }
      setPricesByTicker((prev) => ({ ...prev, ...next }));
      setMsg(`Prices updated for ${items.length} symbols.`);
    } catch (e: any) {
      setMsg(`Failed to load prices: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
      fetchInFlightRef.current = false;
    }
  }

  async function save() {
    try {
      setBusy(true);
      setMsg('');

      const current = await getTradingAutomationSettings();
      const tickers = Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => (k || '').trim().toUpperCase())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      const nextCfg: TASettings = {
        ...(current as TASettings),
        live_selected_symbols: tickers,
      };
      await updateTradingAutomationSettings(nextCfg);
      show(`Saved ${tickers.length} selected stock(s) for live automation`, 'success');
    } catch (e: any) {
      show(`Save failed: ${formatApiError(e)}`, 'error', 6000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="card-title">Live Trading Automation Stocks</div>
          <div className="text-xs text-gray-400">
            Select which stocks participate in live trading automation and click Save.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs text-gray-300">Selected: {selectedCount}/{rows.length}</div>
          <button
            type="button"
            onClick={save}
            className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm"
            disabled={busy}
          >
            Save
          </button>
        </div>
      </div>

      {msg ? <div className="text-sm text-gray-300">{msg}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm w-64"
          placeholder="Search code or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          className="px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm"
          value={sector}
          onChange={(e) => setSector(e.target.value)}
        >
          <option value="">All sectors</option>
          {sectors.current.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          className="px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm w-28"
          placeholder="Min price"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
        />
        <input
          className="px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm w-28"
          placeholder="Max price"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
        />

        <label className="text-sm text-gray-200 flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(e) => setSelectedOnly(e.target.checked)}
          />
          Selected only
        </label>

        <button
          type="button"
          onClick={refreshPricesForCurrentFilter}
          className="px-3 py-2 rounded bg-gray-800 hover:bg-gray-700 text-sm"
          disabled={busy}
        >
          Refresh prices
        </button>

        <div className="text-xs text-gray-400">
          Showing {filteredRows.length}/{rows.length}
        </div>
      </div>

      <div className="overflow-auto rounded border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-300">
            <tr>
              <th className="p-2 text-left w-10">
                <input
                  ref={headerRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <th className="p-2 text-left">Code</th>
              <th className="p-2 text-right">Price</th>
              <th className="p-2 text-left">Input Features</th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Sector</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => (
              <tr key={r.ticker} className="border-t border-gray-800">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={!!selected[r.ticker]}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        [r.ticker]: e.target.checked,
                      }))
                    }
                  />
                </td>
                <td className="p-2 font-mono text-xs">{r.ticker}</td>
                <td className="p-2 text-right tabular-nums">
                  {typeof pricesByTicker[r.ticker]?.close === 'number' ? fmt2(pricesByTicker[r.ticker]?.close) : '—'}
                </td>
                <td className="p-2 text-xs text-gray-200">
                  {(() => {
                    const d = pricesByTicker[r.ticker];
                    if (!d) return '—';

                    const parts: string[] = [];
                    // OHLCV
                    if (
                      typeof d.open === 'number' ||
                      typeof d.high === 'number' ||
                      typeof d.low === 'number' ||
                      typeof d.close === 'number' ||
                      typeof d.volume === 'number'
                    ) {
                      parts.push(
                        `OHLCV: ${typeof d.open === 'number' ? fmt2(d.open) : '—'} / ${typeof d.high === 'number' ? fmt2(d.high) : '—'} / ${typeof d.low === 'number' ? fmt2(d.low) : '—'} / ${typeof d.close === 'number' ? fmt2(d.close) : '—'} / ${typeof d.volume === 'number' ? fmt2(d.volume) : '—'}`
                      );
                    }

                    if (typeof d.oi_change === 'number') parts.push(`OI Δ: ${fmt2(d.oi_change)}`);
                    if (typeof d.pcr === 'number') parts.push(`PCR: ${d.pcr.toFixed(2)}`);
                    if (typeof d.india_vix === 'number') parts.push(`India VIX: ${fmt2(d.india_vix)}`);

                    const ce = d.greeks_ce;
                    if (ce && typeof ce.delta === 'number') {
                      const theta = typeof ce.theta_per_day === 'number' ? fmt2(ce.theta_per_day) : '—';
                      const gamma = typeof ce.gamma === 'number' ? fmt2(ce.gamma) : '—';
                      const vega = typeof ce.vega === 'number' ? fmt2(ce.vega) : '—';
                      parts.push(`Greeks(CE): Δ ${fmt2(ce.delta)} Θ/day ${theta} Γ ${gamma} Vega ${vega}`);
                    }

                    const pe = d.greeks_pe;
                    if (pe && typeof pe.delta === 'number') {
                      const theta = typeof pe.theta_per_day === 'number' ? fmt2(pe.theta_per_day) : '—';
                      const gamma = typeof pe.gamma === 'number' ? fmt2(pe.gamma) : '—';
                      const vega = typeof pe.vega === 'number' ? fmt2(pe.vega) : '—';
                      parts.push(`Greeks(PE): Δ ${fmt2(pe.delta)} Θ/day ${theta} Γ ${gamma} Vega ${vega}`);
                    }

                    return parts.length ? parts.join(' | ') : '—';
                  })()}
                </td>
                <td className="p-2">{r.name}</td>
                <td className="p-2">{r.sector || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StocksTab() {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [symbols, setSymbols] = useState<SymbolRef[]>([]);
  const [pricesByTicker, setPricesByTicker] = useState<Record<string, FeatureSnapshotItem>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, { name: string; sector: string }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string>('');
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const fetchInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setBusy(true);
      setMsg('');
      try {
        const res = await symbolsApi.all(1000);
        const data = (res.data || []) as SymbolRef[];
        if (mounted) setSymbols(data);
      } catch (e: any) {
        if (mounted) setMsg(`Failed to load symbols: ${formatApiError(e)}`);
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    // Keep draft values in sync with loaded symbols, without stomping in-progress edits.
    setDrafts((prev) => {
      const next: Record<string, { name: string; sector: string }> = { ...prev };
      const liveTickers = new Set<string>();
      for (const s of symbols) {
        const t = (s.ticker || '').trim().toUpperCase();
        if (!t) continue;
        liveTickers.add(t);
        if (!next[t]) {
          next[t] = {
            name: (s.name || '').toString(),
            sector: (((s as any)?.sector || '') as string).toString(),
          };
        }
      }
      for (const t of Object.keys(next)) {
        if (!liveTickers.has(t)) delete next[t];
      }
      return next;
    });
  }, [symbols]);

  function isDirty(ticker: string): boolean {
    const t = (ticker || '').trim().toUpperCase();
    const d = drafts[t];
    const orig = symbols.find((s) => (s.ticker || '').trim().toUpperCase() === t);
    if (!d || !orig) return false;
    const origName = (orig.name || '').toString().trim();
    const origSector = (((orig as any)?.sector || '') as string).toString().trim();
    return d.name.trim() !== origName || d.sector.trim() !== origSector;
  }

  async function saveRow(ticker: string) {
    const t = (ticker || '').trim().toUpperCase();
    const d = drafts[t];
    if (!d) return;
    if (!isDirty(t)) return;

    try {
      setSaving((prev) => ({ ...prev, [t]: true }));
      const payload = {
        name: d.name.trim(),
        sector: d.sector.trim() ? d.sector.trim() : null,
      };
      const res = await symbolsApi.update(t, payload);
      if (res.error) {
        show(`Save failed: ${formatApiError(res.error)}`, 'error', 6000);
        return;
      }

      const updated = res.data as any;
      setSymbols((prev) =>
        (prev || []).map((s) => {
          const st = (s.ticker || '').trim().toUpperCase();
          if (st !== t) return s;
          return {
            ...s,
            name: updated?.name ?? s.name,
            sector: updated?.sector ?? null,
          } as any;
        })
      );

      // Normalize draft to what server saved.
      setDrafts((prev) => ({
        ...prev,
        [t]: {
          name: (updated?.name ?? payload.name).toString(),
          sector: ((updated?.sector ?? payload.sector ?? '') as string).toString(),
        },
      }));

      show('Saved', 'success');
    } catch (e: any) {
      show(`Save failed: ${formatApiError(e)}`, 'error', 6000);
    } finally {
      setSaving((prev) => ({ ...prev, [t]: false }));
    }
  }

  useEffect(() => {
    if (!symbols.length) return;
    if (Object.keys(pricesByTicker).length > 0) return;

    // Load prices once so price filters work immediately.
    // Uses local DB latest OHLCV; should be fast.
    (async () => {
      try {
        if (fetchInFlightRef.current) return;
        fetchInFlightRef.current = true;
        setBusy(true);
        setMsg('Loading latest prices…');
        const tickers = symbols.map((s) => (s.ticker || '').trim().toUpperCase()).filter(Boolean);
        const res = await marketDataApi.featureSnapshot(tickers, 2000, false);
        const items = (res.data || []) as FeatureSnapshotItem[];
        const next: Record<string, FeatureSnapshotItem> = {};
        for (const it of items) {
          if (it?.symbol) next[it.symbol.toUpperCase()] = it;
        }
        setPricesByTicker(next);
        setMsg(`Prices loaded for ${items.length} symbols.`);
      } catch (e: any) {
        setMsg(`Failed to load prices: ${formatApiError(e)}`);
      } finally {
        setBusy(false);
        fetchInFlightRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols]);

  const sectors = useRef<string[]>([]);
  useEffect(() => {
    const uniq = new Set<string>();
    for (const s of symbols) {
      const v = (s as any)?.sector;
      if (typeof v === 'string' && v.trim()) uniq.add(v.trim());
    }
    sectors.current = Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [symbols]);

  const filtered = ((): SymbolRef[] => {
    const text = q.trim().toLowerCase();
    const sec = sector.trim().toLowerCase();
    const minV = minPrice.trim() ? Number(minPrice) : null;
    const maxV = maxPrice.trim() ? Number(maxPrice) : null;

    return (symbols || []).filter((s) => {
      const t = (s.ticker || '').toLowerCase();
      const n = (s.name || '').toLowerCase();
      const secVal = ((s as any)?.sector || '').toString().toLowerCase();

      if (text && !(t.includes(text) || n.includes(text))) return false;
      if (sec && secVal !== sec) return false;

      if (minV != null || maxV != null) {
        const p = pricesByTicker[(s.ticker || '').toUpperCase()]?.close;
        if (typeof p !== 'number') return false;
        if (minV != null && p < minV) return false;
        if (maxV != null && p > maxV) return false;
      }

      return true;
    });
  })();

  async function refreshPricesForCurrentFilter() {
    try {
      if (fetchInFlightRef.current) return;
      fetchInFlightRef.current = true;
      setBusy(true);
      setMsg('');

      const tickers = filtered.map((s) => (s.ticker || '').trim().toUpperCase()).filter(Boolean);
      if (tickers.length === 0) {
        setMsg('No symbols in current filter.');
        return;
      }
      const includeOptions = tickers.length <= 25;
      const res = await marketDataApi.featureSnapshot(tickers, 2000, includeOptions);
      const items = (res.data || []) as FeatureSnapshotItem[];
      const next: Record<string, FeatureSnapshotItem> = {};
      for (const it of items) {
        if (it?.symbol) next[it.symbol.toUpperCase()] = it;
      }
      setPricesByTicker((prev) => ({ ...prev, ...next }));
      setMsg(`Prices updated for ${items.length} symbols.`);
    } catch (e: any) {
      setMsg(`Failed to load prices: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
      fetchInFlightRef.current = false;
    }
  }

  async function copyFilteredCodes() {
    const codes = filtered.map((s) => (s.ticker || '').trim().toUpperCase()).filter(Boolean);
    const text = codes.join(',');
    const ok = await copyToClipboard(text);
    if (ok) show(`Copied ${codes.length} codes`, 'success');
    else show('Copy failed', 'error', 4000);
  }

  const selectedTickers = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .filter(Boolean);

  async function deleteSelected() {
    const tickers = selectedTickers;
    if (!tickers.length) return;
    const ok = window.confirm(`Delete ${tickers.length} stock(s) from all related tables? This cannot be undone.`);
    if (!ok) return;

    try {
      setBusy(true);
      setMsg('');
      const res = await symbolsApi.delete(tickers);
      const deleted = (res.data?.deleted || []) as string[];
      const notFound = (res.data?.not_found || []) as string[];

      if (deleted.length) {
        const deletedSet = new Set(deleted.map((t) => t.toUpperCase()));
        setSymbols((prev) => (prev || []).filter((s) => !deletedSet.has((s.ticker || '').toUpperCase())));
        setPricesByTicker((prev) => {
          const next = { ...prev };
          for (const t of deletedSet) delete next[t];
          return next;
        });
        setSelected((prev) => {
          const next = { ...prev };
          for (const t of deletedSet) delete next[t];
          return next;
        });
      }

      if (notFound.length) {
        show(`Deleted ${deleted.length}; not found: ${notFound.join(', ')}`, 'success');
      } else {
        show(`Deleted ${deleted.length} stock(s)`, 'success');
      }
    } catch (e: any) {
      show(`Delete failed: ${formatApiError(e)}`, 'error', 6000);
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(ticker: string) {
    const t = (ticker || '').trim().toUpperCase();
    if (!t) return;
    const ok = window.confirm(`Delete ${t} from all related tables? This cannot be undone.`);
    if (!ok) return;

    try {
      setBusy(true);
      setMsg('');
      const res = await symbolsApi.delete([t]);
      const deleted = (res.data?.deleted || []) as string[];
      if (!deleted.length) {
        show('Nothing deleted', 'error', 4000);
        return;
      }
      const deletedSet = new Set(deleted.map((x) => x.toUpperCase()));
      setSymbols((prev) => (prev || []).filter((s) => !deletedSet.has((s.ticker || '').toUpperCase())));
      setPricesByTicker((prev) => {
        const next = { ...prev };
        for (const x of deletedSet) delete next[x];
        return next;
      });
      setSelected((prev) => {
        const next = { ...prev };
        for (const x of deletedSet) delete next[x];
        return next;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const x of deletedSet) delete next[x];
        return next;
      });
      show(`Deleted ${deleted.length} stock(s)`, 'success');
    } catch (e: any) {
      show(`Delete failed: ${formatApiError(e)}`, 'error', 6000);
    } finally {
      setBusy(false);
    }
  }

  const rows: StockRow[] = filtered.map((s) => {
    const t = (s.ticker || '').trim().toUpperCase();
    return {
      ticker: t,
      name: s.name,
      sector: (s as any)?.sector ?? null,
      last: t ? pricesByTicker[t] : undefined,
    };
  });

  const allVisibleTickers = rows.map((r) => r.ticker).filter(Boolean);
  const allVisibleSelected = allVisibleTickers.length > 0 && allVisibleTickers.every((t) => selected[t]);
  const someVisibleSelected = allVisibleTickers.some((t) => selected[t]);

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="card-title">Stocks</div>
          <div className="text-xs text-gray-400">Filter symbols and copy comma-separated codes from the filtered list.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refreshPricesForCurrentFilter}
            className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm"
            disabled={busy}
          >
            Refresh prices
          </button>
          <button
            type="button"
            onClick={copyFilteredCodes}
            className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm"
            disabled={busy || filtered.length === 0}
          >
            Copy codes
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm"
            disabled={busy || selectedTickers.length === 0}
          >
            Delete selected
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <label className="text-xs text-gray-400">Search (code or name)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm"
            placeholder="e.g. RELIANCE or Reliance"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400">Sector</label>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm"
          >
            <option value="">All</option>
            {sectors.current.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400">Min price</label>
            <input
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm"
              placeholder="0"
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Max price</label>
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-800 text-sm"
              placeholder="99999"
              inputMode="decimal"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-gray-300">
          Showing <span className="text-white">{rows.length}</span> of <span className="text-white">{symbols.length}</span>
        </div>
        <div className="text-gray-400">
          Selected: <span className="text-white">{selectedTickers.length}</span>
        </div>
        {msg ? <div className="text-xs text-gray-400">{msg}</div> : null}
      </div>

      <div className="overflow-auto max-h-[70vh] border border-gray-800 rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-300 sticky top-0">
            <tr>
              <th className="text-left p-2 w-[42px]">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                  }}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSelected((prev) => {
                      const next = { ...prev };
                      for (const t of allVisibleTickers) next[t] = checked;
                      return next;
                    });
                  }}
                />
              </th>
              <th className="text-left p-2">Code</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Sector</th>
              <th className="text-right p-2">Close</th>
              <th className="text-right p-2">Open</th>
              <th className="text-right p-2">High</th>
              <th className="text-right p-2">Low</th>
              <th className="text-right p-2">Volume</th>
              <th className="text-left p-2">As of</th>
              <th className="text-right p-2 w-[170px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-t border-gray-800 hover:bg-gray-900/40">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={!!selected[r.ticker]}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelected((prev) => ({
                        ...prev,
                        [r.ticker]: checked,
                      }));
                    }}
                  />
                </td>
                <td className="p-2 font-mono text-gray-100">{r.ticker}</td>
                <td className="p-2 text-gray-100">
                  <input
                    value={drafts[r.ticker]?.name ?? r.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDrafts((prev) => ({
                        ...prev,
                        [r.ticker]: { name: v, sector: prev[r.ticker]?.sector ?? (r.sector || '') },
                      }));
                    }}
                    onBlur={() => {
                      if (isDirty(r.ticker)) saveRow(r.ticker);
                    }}
                    className="w-full px-2 py-1 rounded bg-gray-950 border border-gray-800 text-sm"
                  />
                </td>
                <td className="p-2 text-gray-300">
                  <input
                    value={drafts[r.ticker]?.sector ?? (r.sector || '')}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDrafts((prev) => ({
                        ...prev,
                        [r.ticker]: { name: prev[r.ticker]?.name ?? r.name, sector: v },
                      }));
                    }}
                    onBlur={() => {
                      if (isDirty(r.ticker)) saveRow(r.ticker);
                    }}
                    className="w-full px-2 py-1 rounded bg-gray-950 border border-gray-800 text-sm"
                    placeholder="—"
                  />
                </td>
                <td className="p-2 text-right text-gray-100">{typeof r.last?.close === 'number' ? fmt2(r.last.close) : '—'}</td>
                <td className="p-2 text-right text-gray-300">{typeof r.last?.open === 'number' ? fmt2(r.last.open) : '—'}</td>
                <td className="p-2 text-right text-gray-300">{typeof r.last?.high === 'number' ? fmt2(r.last.high) : '—'}</td>
                <td className="p-2 text-right text-gray-300">{typeof r.last?.low === 'number' ? fmt2(r.last.low) : '—'}</td>
                <td className="p-2 text-right text-gray-300">{typeof r.last?.volume === 'number' ? fmt2(r.last.volume) : '—'}</td>
                <td className="p-2 text-gray-400">{r.last?.timestamp ? new Date(r.last.timestamp).toLocaleString() : '—'}</td>
                <td className="p-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => saveRow(r.ticker)}
                      disabled={busy || !!saving[r.ticker] || !isDirty(r.ticker)}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs disabled:opacity-50"
                    >
                      {saving[r.ticker] ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteOne(r.ticker)}
                      disabled={busy}
                      className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-gray-400" colSpan={11}>
                  No symbols match your filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Note: price details come from the latest stored OHLCV candle in the database.
      </div>
    </div>
  );
}

function prettyJson(v: any): string {
  if (v == null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pnlTextClass(v: number | null | undefined): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '';
  if (v > 0) return 'text-green-300';
  if (v < 0) return 'text-red-300';
  return 'text-gray-200';
}

function FOExecutionStatusCard(props: { lastRun: any | null; autoPickRes: any | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [liveAutoLoop, setLiveAutoLoop] = useState<any>(null);
  const [liveSummary, setLiveSummary] = useState<any>(null);
  const [liveOrders, setLiveOrders] = useState<any>(null);
  const [paperAutoRunLoop, setPaperAutoRunLoop] = useState<any>(null);
  const [paperAutoPickLoop, setPaperAutoPickLoop] = useState<any>(null);
  const [paperOrders, setPaperOrders] = useState<any[]>([]);
  const [paperAccount, setPaperAccount] = useState<any>(null);
  const [paperPositions, setPaperPositions] = useState<any[]>([]);
  const [paperLtpByTs, setPaperLtpByTs] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const [externalPolling, setExternalPolling] = useState(false);

  async function refresh() {
    try {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      setBusy(true);
      setMsg('');

      const [loopRes, liveRes, ordersRes, paperRunLoopRes, paperPickLoopRes, paperOrdersRes, paperAcctRes, paperPosRes] = await Promise.all([
        tradingApi.liveAutoLoopStatus(),
        tradingApi.liveSummary(),
        tradingApi.liveOrders(100),
        foApi.paperAutoRunLoopStatus(),
        foApi.paperAutoPickLoopStatus(),
        foApi.paperOrders(100),
        foApi.getPaperAccount(),
        foApi.paperPositions(),
      ]);

      if (loopRes.error) {
        setMsg((m) => [m, `Live loop: ${formatApiError(loopRes.error)}`].filter(Boolean).join(' • '));
        setLiveAutoLoop(null);
      } else {
        setLiveAutoLoop(loopRes.data || null);
      }

      if (liveRes.error) {
        setMsg((m) => [m, `Live: ${formatApiError(liveRes.error)}`].filter(Boolean).join(' • '));
        setLiveSummary(null);
      } else {
        setLiveSummary(liveRes.data || null);
      }

      if (ordersRes.error) {
        setMsg((m) => [m, `Kite orders: ${formatApiError(ordersRes.error)}`].filter(Boolean).join(' • '));
        setLiveOrders(null);
      } else {
        setLiveOrders(ordersRes.data || null);
      }

      if (paperOrdersRes.error) {
        setMsg((m) => [m, `Paper orders: ${formatApiError(paperOrdersRes.error)}`].filter(Boolean).join(' • '));
        setPaperOrders([]);
      } else {
        const items = (paperOrdersRes.data as any)?.items;
        setPaperOrders(Array.isArray(items) ? items : []);
      }

      if (paperRunLoopRes.error) {
        setMsg((m) => [m, `Paper auto-run loop: ${formatApiError(paperRunLoopRes.error)}`].filter(Boolean).join(' • '));
        setPaperAutoRunLoop(null);
      } else {
        setPaperAutoRunLoop(paperRunLoopRes.data || null);
      }

      if (paperPickLoopRes.error) {
        setMsg((m) => [m, `Paper auto-pick loop: ${formatApiError(paperPickLoopRes.error)}`].filter(Boolean).join(' • '));
        setPaperAutoPickLoop(null);
      } else {
        setPaperAutoPickLoop(paperPickLoopRes.data || null);
      }

      if (paperAcctRes.error) {
        setMsg((m) => [m, `Paper acct: ${formatApiError(paperAcctRes.error)}`].filter(Boolean).join(' • '));
        setPaperAccount(null);
      } else {
        setPaperAccount(paperAcctRes.data || null);
      }

      if (paperPosRes.error) {
        setMsg((m) => [m, `Paper pos: ${formatApiError(paperPosRes.error)}`].filter(Boolean).join(' • '));
        setPaperPositions([]);
        setPaperLtpByTs({});
      } else {
        const pos = (paperPosRes.data as any[]) || [];
        setPaperPositions(pos);
        const uniqTs = Array.from(
          new Set(
            pos
              .map((p: any) => String(p?.tradingsymbol || '').trim().toUpperCase())
              .filter(Boolean),
          ),
        ) as string[];
        if (uniqTs.length === 0) {
          setPaperLtpByTs({});
        } else {
          try {
            const ltpRes = await foApi.ltp(uniqTs.map((ts) => `NFO:${ts}`));
            if (ltpRes.error) {
              setMsg((m) => [m, `Paper LTP: ${formatApiError(ltpRes.error)}`].filter(Boolean).join(' • '));
              setPaperLtpByTs({});
            } else {
              const items = (ltpRes.data as any)?.items || {};
              const next: Record<string, number> = {};
              uniqTs.forEach((ts) => {
                const k = `NFO:${ts}`.toUpperCase();
                const v = Number(items?.[k]);
                if (Number.isFinite(v) && v > 0) next[ts] = v;
              });
              setPaperLtpByTs(next);
            }
          } catch (e: any) {
            setMsg((m) => [m, `Paper LTP: ${formatApiError(e)}`].filter(Boolean).join(' • '));
            setPaperLtpByTs({});
          }
        }
      }

      setLastUpdated(new Date().toISOString());
    } catch (e: any) {
      setMsg(formatApiError(e));
      setLiveSummary(null);
      setLiveOrders(null);
      setPaperAutoRunLoop(null);
      setPaperAutoPickLoop(null);
      setPaperOrders([]);
      setPaperAccount(null);
      setPaperPositions([]);
      setPaperLtpByTs({});
    } finally {
      setBusy(false);
      refreshInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('marketintel:fo-exec-status-refresh', handler);
    return () => window.removeEventListener('marketintel:fo-exec-status-refresh', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ enabled?: boolean }>;
      setExternalPolling(Boolean(ce?.detail?.enabled));
    };
    window.addEventListener('marketintel:fo-exec-status-poll', handler as EventListener);
    return () => window.removeEventListener('marketintel:fo-exec-status-poll', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!externalPolling) {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    void refresh();
    if (pollTimerRef.current == null) {
      pollTimerRef.current = window.setInterval(() => {
        void refresh();
      }, 5000);
    }

    return () => {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPolling]);

  const bal = liveSummary?.balance;
  const liveLoopRunning = !!liveAutoLoop?.running;
  const paperAutoRunLoopRunning = !!paperAutoRunLoop?.running;
  const paperAutoPickLoopRunning = !!paperAutoPickLoop?.running;
  const lastRunItems: any[] = Array.isArray(props.lastRun?.items) ? props.lastRun.items : [];
  const autoPickItems: any[] = Array.isArray(props.autoPickRes?.items) ? props.autoPickRes.items : [];
  const kiteOrders: any[] = Array.isArray(liveOrders?.orders) ? liveOrders.orders : [];
  const paperAutoRunLoopItems: any[] = Array.isArray(paperAutoRunLoop?.last_items) ? paperAutoRunLoop.last_items : [];
  const paperAutoPickLoopItems: any[] = Array.isArray(paperAutoPickLoop?.last_items) ? paperAutoPickLoop.last_items : [];

  const paperCash = (paperAccount && typeof paperAccount?.cash === 'number') ? Number(paperAccount.cash) : null;
  const paperStartingCash = (paperAccount && typeof paperAccount?.starting_cash === 'number') ? Number(paperAccount.starting_cash) : null;
  let paperMtm = 0;
  let paperUnrealized = 0;
  if (Array.isArray(paperPositions) && paperPositions.length > 0) {
    paperPositions.forEach((p: any) => {
      const ts = String(p?.tradingsymbol || '').trim().toUpperCase();
      if (!ts) return;
      const qty = Number(p?.quantity);
      const entry = Number(p?.entry_price);
      const ltp = Number(paperLtpByTs?.[ts]);
      if (!Number.isFinite(qty) || qty === 0) return;
      if (!Number.isFinite(ltp) || ltp <= 0) return;
      paperMtm += ltp * qty;
      if (Number.isFinite(entry) && entry > 0) {
        paperUnrealized += (ltp - entry) * qty;
      }
    });
  }
  const paperEquity = (paperCash != null) ? (paperCash + paperMtm) : null;
  const paperTotalPnl = (paperEquity != null && paperStartingCash != null) ? (paperEquity - paperStartingCash) : null;

  function inferFoContractType(ts: string | null | undefined): string {
    const s = String(ts || '').trim().toUpperCase();
    if (!s) return '';
    if (s.endsWith('CE')) return 'OPT CE';
    if (s.endsWith('PE')) return 'OPT PE';
    if (s.includes('FUT')) return 'FUT';
    return '';
  }

  function foAutoRunTypeLabel(it: any): string {
    const kind = String(it?.kind || '').trim().toUpperCase();
    const opt = String(it?.option_type || '').trim().toUpperCase();
    if (kind) return opt && kind.includes('OPT') ? `${kind} ${opt}` : kind;
    return inferFoContractType(it?.tradingsymbol) || '';
  }

  function foAutoPickTypeLabel(it: any): string {
    const opt = String(it?.option_type || '').trim().toUpperCase();
    if (opt) return `OPT ${opt}`;
    return inferFoContractType(it?.tradingsymbol) || '';
  }

  // Merge paper orders into the "Recent Kite orders" table.
  // Paper orders are mapped into the same shape used by the table.
  const mappedPaperOrders: any[] = Array.isArray(paperOrders)
    ? paperOrders.map((o: any) => ({
        symbol: o?.tradingsymbol,
        tradingsymbol: o?.tradingsymbol,
        side: o?.side,
        filled_quantity: typeof o?.quantity === 'number' ? o.quantity : undefined,
        quantity: typeof o?.quantity === 'number' ? o.quantity : undefined,
        average_price: typeof o?.fill_price === 'number' ? o.fill_price : undefined,
        status: `PAPER ${o?.status || 'FILLED'}`,
        exchange_timestamp: o?.created_at,
        order_timestamp: o?.created_at,
        __mode: 'PAPER',
        __paper_meta: o?.metadata || null,
      }))
    : [];

  const mergedOrdersAll: any[] = [...mappedPaperOrders, ...kiteOrders]
    .map((o: any) => {
      const ts = o?.exchange_timestamp || o?.order_timestamp || o?.exchange_update_timestamp || null;
      const t = ts ? Date.parse(String(ts)) : NaN;
      return { ...o, __ts: Number.isFinite(t) ? t : 0 };
    })
    .sort((a: any, b: any) => (b.__ts || 0) - (a.__ts || 0))

  const mergedOrders: any[] = mergedOrdersAll.slice(0, 100);
  const mergedOrdersTop: any[] = mergedOrders.slice(0, 25);
  const mergedOrdersRest: any[] = mergedOrders.slice(25);

  const paperAutoRunLoopTop: any[] = paperAutoRunLoopItems.slice(0, 25);
  const paperAutoRunLoopRest: any[] = paperAutoRunLoopItems.slice(25, 100);
  const lastRunItemsTop: any[] = lastRunItems.slice(0, 25);
  const lastRunItemsRest: any[] = lastRunItems.slice(25, 100);

  const paperAutoPickLoopTop: any[] = paperAutoPickLoopItems.slice(0, 25);
  const paperAutoPickLoopRest: any[] = paperAutoPickLoopItems.slice(25, 100);
  const autoPickItemsTop: any[] = autoPickItems.slice(0, 25);
  const autoPickItemsRest: any[] = autoPickItems.slice(25, 100);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="card-title">Current Execution Status</div>
          <div className="text-xs text-gray-500">Shows live broker P/L + latest F&O run payloads (scrollable).</div>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {msg ? <div className="mb-2 text-sm text-red-300">{msg}</div> : null}

      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Paper Auto-Run Loop</div>
            <div className={`text-lg font-semibold ${paperAutoRunLoopRunning ? 'text-green-300' : ''}`}>{paperAutoRunLoopRunning ? 'Running' : 'Stopped'}</div>
            <div className="text-xs text-gray-500">Iterations: {paperAutoRunLoop?.iterations ?? 0}</div>
            <div className="text-xs text-gray-500">Last: {paperAutoRunLoop?.last_run_at || '—'}</div>
            {paperAutoRunLoop?.last_error ? <div className="text-xs text-red-300 mt-1">{String(paperAutoRunLoop.last_error)}</div> : null}
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Paper Auto-Pick Loop</div>
            <div className={`text-lg font-semibold ${paperAutoPickLoopRunning ? 'text-green-300' : ''}`}>{paperAutoPickLoopRunning ? 'Running' : 'Stopped'}</div>
            <div className="text-xs text-gray-500">Iterations: {paperAutoPickLoop?.iterations ?? 0}</div>
            <div className="text-xs text-gray-500">Last: {paperAutoPickLoop?.last_run_at || '—'}</div>
            {paperAutoPickLoop?.last_error ? <div className="text-xs text-red-300 mt-1">{String(paperAutoPickLoop.last_error)}</div> : null}
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Paper P/L (Total)</div>
            <div className={`text-lg font-semibold ${pnlTextClass(paperTotalPnl)}`}>{typeof paperTotalPnl === 'number' ? fmt2(paperTotalPnl) : '—'}</div>
            <div className="text-xs text-gray-500">Unrealized: {typeof paperUnrealized === 'number' ? fmt2(paperUnrealized) : '—'}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Paper equity</div>
            <div className="text-lg font-semibold">{typeof paperEquity === 'number' ? fmt2(paperEquity) : '—'}</div>
            <div className="text-xs text-gray-500">cash: {typeof paperCash === 'number' ? fmt2(paperCash) : '—'}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Live Auto Loop (Continuous)</div>
            <div className={`text-lg font-semibold ${liveLoopRunning ? 'text-green-300' : ''}`}>{liveLoopRunning ? 'Running' : 'Stopped'}</div>
            <div className="text-xs text-gray-500">Iterations: {liveAutoLoop?.iterations ?? 0}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Available margin</div>
            <div className="text-lg font-semibold">{typeof bal?.available_margin === 'number' ? fmt2(bal.available_margin) : '—'}</div>
            <div className="text-xs text-gray-500">cash: {typeof bal?.available_cash === 'number' ? fmt2(bal.available_cash) : '—'}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Live P/L</div>
            <div className={`text-lg font-semibold ${pnlTextClass(liveSummary?.total_pnl)}`}>{typeof liveSummary?.total_pnl === 'number' ? fmt2(liveSummary.total_pnl) : '—'}</div>
            <div className="text-xs text-gray-500">
              U: <span className={pnlTextClass(liveSummary?.unrealised_pnl)}>{typeof liveSummary?.unrealised_pnl === 'number' ? fmt2(liveSummary.unrealised_pnl) : '—'}</span>
              {' '}• R: <span className={pnlTextClass(liveSummary?.realised_pnl)}>{typeof liveSummary?.realised_pnl === 'number' ? fmt2(liveSummary.realised_pnl) : '—'}</span>
            </div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Open positions</div>
            <div className="text-lg font-semibold">{typeof liveSummary?.open_positions === 'number' ? liveSummary.open_positions : '—'}</div>
            <div className="text-xs text-gray-500">Updated: {liveSummary?.updated_at || '—'}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Last F&O auto-run</div>
            <div className="text-lg font-semibold">{props.lastRun ? `${props.lastRun.executed ?? 0}/${props.lastRun.considered ?? 0}` : '—'}</div>
            <div className="text-xs text-gray-500">Items: {lastRunItems.length}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Last F&O auto-pick</div>
            <div className="text-lg font-semibold">{props.autoPickRes ? `${props.autoPickRes.executed ?? 0}/${props.autoPickRes.picked ?? 0}` : '—'}</div>
            <div className="text-xs text-gray-500">Items: {autoPickItems.length}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Last refresh</div>
            <div className="text-xs text-gray-500">{lastUpdated || '—'}</div>
            <div className="text-xs text-gray-500">Orders loaded: {mergedOrders.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="tile p-3">
            <div className="text-xs text-gray-400 mb-2">Latest F&O auto-run items</div>
            <div className="border border-gray-800 rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-900 text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Act</th>
                    <th className="text-left p-2">Qty</th>
                    <th className="text-left p-2">Exec</th>
                    <th className="text-left p-2">Err</th>
                  </tr>
                </thead>
                <tbody>
                  {lastRunItems.length === 0 && paperAutoRunLoopItems.length === 0 ? (
                    <tr><td colSpan={6} className="p-2 text-gray-500">No F&O auto-run items yet.</td></tr>
                  ) : (
                    <>
                      {paperAutoRunLoopTop.length > 0 ? (
                        <tr className="border-t border-gray-800">
                          <td colSpan={6} className="p-2 text-xs text-gray-400">Paper auto-run (continuous loop) — latest items</td>
                        </tr>
                      ) : null}
                      {paperAutoRunLoopTop.map((it: any, idx: number) => (
                        <tr key={`paperloop-${idx}`} className="border-t border-gray-800">
                          <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                          <td className="p-2 text-gray-300">{foAutoRunTypeLabel(it) || '—'}</td>
                          <td className="p-2">{it.action || '—'}</td>
                          <td className="p-2">{typeof it.quantity === 'number' ? it.quantity : '—'}</td>
                          <td className="p-2">{it.executed ? 'Y' : 'N'}</td>
                          <td className="p-2 text-gray-300">{it.error ? String(it.error) : ''}</td>
                        </tr>
                      ))}

                      {lastRunItemsTop.length > 0 ? (
                        <tr className="border-t border-gray-800">
                          <td colSpan={6} className="p-2 text-xs text-gray-400">Last manual run payload — latest items</td>
                        </tr>
                      ) : null}
                      {lastRunItemsTop.map((it: any, idx: number) => (
                        <tr key={`manual-${idx}`} className="border-t border-gray-800">
                          <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                          <td className="p-2 text-gray-300">{foAutoRunTypeLabel(it) || '—'}</td>
                          <td className="p-2">{it.action || '—'}</td>
                          <td className="p-2">{typeof it.quantity === 'number' ? it.quantity : '—'}</td>
                          <td className="p-2">{it.executed ? 'Y' : 'N'}</td>
                          <td className="p-2 text-gray-300">{it.error ? String(it.error) : ''}</td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {(paperAutoRunLoopRest.length > 0 || lastRunItemsRest.length > 0) ? (
              <div className="border border-gray-800 rounded overflow-auto max-h-64 mt-2">
                <table className="min-w-full text-sm">
                  <tbody>
                    {paperAutoRunLoopRest.length > 0 ? (
                      <tr className="border-t border-gray-800">
                        <td colSpan={6} className="p-2 text-xs text-gray-400">Paper auto-run — more (scroll)</td>
                      </tr>
                    ) : null}
                    {paperAutoRunLoopRest.map((it: any, idx: number) => (
                      <tr key={`paperloop-rest-${idx}`} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                        <td className="p-2 text-gray-300">{foAutoRunTypeLabel(it) || '—'}</td>
                        <td className="p-2">{it.action || '—'}</td>
                        <td className="p-2">{typeof it.quantity === 'number' ? it.quantity : '—'}</td>
                        <td className="p-2">{it.executed ? 'Y' : 'N'}</td>
                        <td className="p-2 text-gray-300">{it.error ? String(it.error) : ''}</td>
                      </tr>
                    ))}

                    {lastRunItemsRest.length > 0 ? (
                      <tr className="border-t border-gray-800">
                        <td colSpan={6} className="p-2 text-xs text-gray-400">Last manual run payload — more (scroll)</td>
                      </tr>
                    ) : null}
                    {lastRunItemsRest.map((it: any, idx: number) => (
                      <tr key={`manual-rest-${idx}`} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                        <td className="p-2 text-gray-300">{foAutoRunTypeLabel(it) || '—'}</td>
                        <td className="p-2">{it.action || '—'}</td>
                        <td className="p-2">{typeof it.quantity === 'number' ? it.quantity : '—'}</td>
                        <td className="p-2">{it.executed ? 'Y' : 'N'}</td>
                        <td className="p-2 text-gray-300">{it.error ? String(it.error) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div className="tile p-3">
            <div className="text-xs text-gray-400 mb-2">Latest F&O auto-pick items</div>
            <div className="border border-gray-800 rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-900 text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Underlying</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Act</th>
                    <th className="text-left p-2">Conf</th>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Exec</th>
                  </tr>
                </thead>
                <tbody>
                  {autoPickItems.length === 0 && paperAutoPickLoopItems.length === 0 ? (
                    <tr><td colSpan={6} className="p-2 text-gray-500">No F&O auto-pick items yet.</td></tr>
                  ) : (
                    <>
                      {paperAutoPickLoopTop.length > 0 ? (
                        <tr className="border-t border-gray-800">
                          <td colSpan={6} className="p-2 text-xs text-gray-400">Paper auto-pick (continuous loop) — latest items</td>
                        </tr>
                      ) : null}
                      {paperAutoPickLoopTop.map((it: any, idx: number) => (
                        <tr key={`paperpick-${idx}`} className="border-t border-gray-800">
                          <td className="p-2 font-mono">{it.underlying || '—'}</td>
                          <td className="p-2 text-gray-300">{foAutoPickTypeLabel(it) || '—'}</td>
                          <td className="p-2">{it.decision_action || '—'}</td>
                          <td className="p-2">{typeof it.confidence === 'number' ? fmt2(it.confidence) : '—'}</td>
                          <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                          <td className="p-2">{it.executed ? 'Y' : (it.error ? 'Err' : 'N')}</td>
                        </tr>
                      ))}

                      {autoPickItemsTop.length > 0 ? (
                        <tr className="border-t border-gray-800">
                          <td colSpan={6} className="p-2 text-xs text-gray-400">Last manual auto-pick payload — latest items</td>
                        </tr>
                      ) : null}
                      {autoPickItemsTop.map((it: any, idx: number) => (
                        <tr key={`manualpick-${idx}`} className="border-t border-gray-800">
                          <td className="p-2 font-mono">{it.underlying || '—'}</td>
                          <td className="p-2 text-gray-300">{foAutoPickTypeLabel(it) || '—'}</td>
                          <td className="p-2">{it.decision_action || '—'}</td>
                          <td className="p-2">{typeof it.confidence === 'number' ? fmt2(it.confidence) : '—'}</td>
                          <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                          <td className="p-2">{it.executed ? 'Y' : (it.error ? 'Err' : 'N')}</td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {(paperAutoPickLoopRest.length > 0 || autoPickItemsRest.length > 0) ? (
              <div className="border border-gray-800 rounded overflow-auto max-h-64 mt-2">
                <table className="min-w-full text-sm">
                  <tbody>
                    {paperAutoPickLoopRest.length > 0 ? (
                      <tr className="border-t border-gray-800">
                        <td colSpan={6} className="p-2 text-xs text-gray-400">Paper auto-pick — more (scroll)</td>
                      </tr>
                    ) : null}
                    {paperAutoPickLoopRest.map((it: any, idx: number) => (
                      <tr key={`paperpick-rest-${idx}`} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{it.underlying || '—'}</td>
                        <td className="p-2 text-gray-300">{foAutoPickTypeLabel(it) || '—'}</td>
                        <td className="p-2">{it.decision_action || '—'}</td>
                        <td className="p-2">{typeof it.confidence === 'number' ? fmt2(it.confidence) : '—'}</td>
                        <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                        <td className="p-2">{it.executed ? 'Y' : (it.error ? 'Err' : 'N')}</td>
                      </tr>
                    ))}

                    {autoPickItemsRest.length > 0 ? (
                      <tr className="border-t border-gray-800">
                        <td colSpan={6} className="p-2 text-xs text-gray-400">Last manual auto-pick payload — more (scroll)</td>
                      </tr>
                    ) : null}
                    {autoPickItemsRest.map((it: any, idx: number) => (
                      <tr key={`manualpick-rest-${idx}`} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{it.underlying || '—'}</td>
                        <td className="p-2 text-gray-300">{foAutoPickTypeLabel(it) || '—'}</td>
                        <td className="p-2">{it.decision_action || '—'}</td>
                        <td className="p-2">{typeof it.confidence === 'number' ? fmt2(it.confidence) : '—'}</td>
                        <td className="p-2 font-mono">{it.tradingsymbol || '—'}</td>
                        <td className="p-2">{it.executed ? 'Y' : (it.error ? 'Err' : 'N')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="mt-2 text-xs text-gray-500">{props.autoPickRes?.items ? '' : 'Tip: Run Auto-pick to populate this table.'}</div>
          </div>
        </div>

        <div className="tile p-3">
          <div className="text-xs text-gray-400 mb-2">Recent Kite orders (last 100)</div>
          <div className="border border-gray-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900 text-gray-300 sticky top-0">
                <tr>
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Side</th>
                  <th className="text-left p-2">Qty</th>
                  <th className="text-left p-2">Avg</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {mergedOrdersTop.length === 0 ? (
                  <tr><td colSpan={7} className="p-2 text-gray-500">No recent orders loaded.</td></tr>
                ) : (
                  mergedOrdersTop.map((o: any, idx: number) => {
                    const ts = String(o.symbol || o.tradingsymbol || '').trim();
                    const inferred = inferFoContractType(ts);
                    const paperMeta = o.__paper_meta;
                    const kind = String(paperMeta?.kind || '').trim().toUpperCase();
                    const opt = String(paperMeta?.option_type || '').trim().toUpperCase();
                    const paperType = kind ? (opt && kind.includes('OPT') ? `${kind} ${opt}` : kind) : (opt ? `OPT ${opt}` : '');
                    const typeLabel = o.__mode === 'PAPER' ? (`PAPER ${paperType || inferred || ''}`.trim()) : (inferred || '');
                    return (
                      <tr key={idx} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{o.symbol || o.tradingsymbol || '—'}</td>
                        <td className="p-2 text-gray-300">{typeLabel || '—'}</td>
                        <td className="p-2">{o.side || '—'}</td>
                        <td className="p-2">{typeof o.filled_quantity === 'number' ? o.filled_quantity : (typeof o.quantity === 'number' ? o.quantity : '—')}</td>
                        <td className="p-2">{typeof o.average_price === 'number' ? fmt2(o.average_price) : '—'}</td>
                        <td className="p-2">{o.status || '—'}</td>
                        <td className="p-2 text-gray-400">{o.exchange_timestamp || o.order_timestamp || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {mergedOrdersRest.length > 0 ? (
            <div className="border border-gray-800 rounded overflow-auto max-h-64 mt-2">
              <table className="min-w-full text-sm">
                <tbody>
                  {mergedOrdersRest.map((o: any, idx: number) => {
                    const ts = String(o.symbol || o.tradingsymbol || '').trim();
                    const inferred = inferFoContractType(ts);
                    const paperMeta = o.__paper_meta;
                    const kind = String(paperMeta?.kind || '').trim().toUpperCase();
                    const opt = String(paperMeta?.option_type || '').trim().toUpperCase();
                    const paperType = kind ? (opt && kind.includes('OPT') ? `${kind} ${opt}` : kind) : (opt ? `OPT ${opt}` : '');
                    const typeLabel = o.__mode === 'PAPER' ? (`PAPER ${paperType || inferred || ''}`.trim()) : (inferred || '');
                    return (
                      <tr key={`rest-${idx}`} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{o.symbol || o.tradingsymbol || '—'}</td>
                        <td className="p-2 text-gray-300">{typeLabel || '—'}</td>
                        <td className="p-2">{o.side || '—'}</td>
                        <td className="p-2">{typeof o.filled_quantity === 'number' ? o.filled_quantity : (typeof o.quantity === 'number' ? o.quantity : '—')}</td>
                        <td className="p-2">{typeof o.average_price === 'number' ? fmt2(o.average_price) : '—'}</td>
                        <td className="p-2">{o.status || '—'}</td>
                        <td className="p-2 text-gray-400">{o.exchange_timestamp || o.order_timestamp || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TradeExecutionStatusCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [latest, setLatest] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loop, setLoop] = useState<any>(null);
  const [liveSummary, setLiveSummary] = useState<any>(null);
  const [liveOrders, setLiveOrders] = useState<any>(null);
  const [kiteOrderPnlSnapshot, setKiteOrderPnlSnapshot] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const liveRefreshInFlightRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const livePollTimerRef = useRef<number | null>(null);
  const [externalPolling, setExternalPolling] = useState(false);
  const [maxTables, setMaxTables] = useState<Record<string, boolean>>({});

  function toggleTableMax(id: string) {
    setMaxTables((prev) => ({
      ...prev,
      [id]: !prev?.[id],
    }));
  }

  function clearLoopItems() {
    setLoop((prev: any) => (prev ? { ...prev, last_items: [] } : prev));
  }

  function clearRecentLogs() {
    setLogs([]);
    setLatest(null);
  }

  function clearKiteOrders() {
    setLiveOrders((prev: any) => (prev ? { ...prev, orders: [] } : prev));
    setKiteOrderPnlSnapshot({});
  }

  function kiteOrderKey(o: any, idx: number): string {
    const orderId = String(o?.order_id || '').trim();
    if (orderId) return orderId;
    const sym = String(o?.symbol || '').trim();
    const ts = String(o?.exchange_timestamp || o?.order_timestamp || '').trim();
    const side = String(o?.side || '').trim();
    const qty = String(o?.filled_quantity ?? o?.quantity ?? '').trim();
    const avg = String(o?.average_price ?? '').trim();
    return [sym, ts, side, qty, avg, String(idx)].filter(Boolean).join('|') || String(idx);
  }

  function captureKiteOrderPnlSnapshot(liveResData: any, ordersResData: any) {
    const positions: any[] = Array.isArray(liveResData?.positions) ? liveResData.positions : [];
    const posBySymbol = new Map<string, { pnl: number | null; last: number | null; qty: number | null }>();
    positions.forEach((p: any) => {
      if (!p?.symbol) return;
      const sym = String(p.symbol);
      posBySymbol.set(sym, {
        pnl: typeof p?.pnl === 'number' ? p.pnl : null,
        last: typeof p?.last_price === 'number' ? p.last_price : null,
        qty: typeof p?.quantity === 'number' ? p.quantity : null,
      });
    });

    const orders: any[] = Array.isArray(ordersResData?.orders) ? ordersResData.orders : [];
    const executed = orders.filter((o: any) => {
      const status = String(o?.status || '').toUpperCase();
      const filledQty = typeof o?.filled_quantity === 'number' ? o.filled_quantity : null;
      return status === 'COMPLETE' || (filledQty != null && filledQty > 0);
    });

    if (executed.length === 0) return;

    setKiteOrderPnlSnapshot((prev) => {
      const next = { ...(prev || {}) };
      executed.slice(0, 50).forEach((o: any, idx: number) => {
        const key = kiteOrderKey(o, idx);
        if (typeof next[key] === 'number') return;

        const sym = String(o?.symbol || '');
        const side = String(o?.side || '').toUpperCase();
        const qty = (typeof o?.filled_quantity === 'number' && o.filled_quantity > 0)
          ? o.filled_quantity
          : (typeof o?.quantity === 'number' ? o.quantity : null);
        const avg = typeof o?.average_price === 'number' ? o.average_price : null;

        const pos = posBySymbol.get(sym);
        const last = pos?.last ?? null;
        const posPnl = pos?.pnl ?? null;
        const posQty = pos?.qty ?? null;

        let snap: number | null = null;
        if (qty != null && avg != null && last != null) {
          // Best-effort mark-to-market P/L snapshot at capture time.
          snap = side === 'SELL' ? (avg - last) * qty : (last - avg) * qty;
        } else if (qty != null && posPnl != null && posQty != null && posQty !== 0) {
          // Fallback: scale current position P/L to the order size.
          snap = posPnl * (qty / posQty);
        }

        if (typeof snap === 'number' && Number.isFinite(snap)) {
          next[key] = snap;
        }
      });
      return next;
    });
  }

  async function refresh() {
    try {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      setBusy(true);
      setMsg('');
      const [logsRes, loopRes, liveRes, ordersRes] = await Promise.all([
        tradingApi.listLogs({ limit: 50 }),
        tradingApi.liveAutoLoopStatus(),
        tradingApi.liveSummary(),
        tradingApi.liveOrders(50),
      ]);

      if (loopRes.error) {
        setMsg((m) => [m, `Loop: ${formatApiError(loopRes.error)}`].filter(Boolean).join(' • '));
        setLoop(null);
      } else {
        setLoop(loopRes.data || null);
      }

      if (liveRes.error) {
        setMsg((m) => [m, `Live: ${formatApiError(liveRes.error)}`].filter(Boolean).join(' • '));
        setLiveSummary(null);
      } else {
        setLiveSummary(liveRes.data || null);
      }

      if (ordersRes.error) {
        setMsg((m) => [m, `Kite orders: ${formatApiError(ordersRes.error)}`].filter(Boolean).join(' • '));
        setLiveOrders(null);
      } else {
        setLiveOrders(ordersRes.data || null);
      }

      // Capture per-order P/L snapshot using the same refresh payloads.
      if (!liveRes.error && !ordersRes.error) {
        captureKiteOrderPnlSnapshot(liveRes.data, ordersRes.data);
      }

      if (logsRes.error) {
        setMsg((m) => [m, `Logs: ${formatApiError(logsRes.error)}`].filter(Boolean).join(' • '));
        setLatest(null);
        setLogs([]);
      } else {
        const items = (logsRes.data?.items || []) as any[];
        setLogs(items);
        setLatest(items[0] || null);
      }

      setLastUpdated(new Date().toISOString());
      if (!logsRes.error) {
        const items = (logsRes.data?.items || []) as any[];
        if (items.length === 0) setMsg((m) => m || 'No trades logged yet.');
      }
    } catch (e: any) {
      setMsg(formatApiError(e));
      setLatest(null);
      setLogs([]);
      setLoop(null);
      setLiveSummary(null);
      setLiveOrders(null);
    } finally {
      setBusy(false);
      refreshInFlightRef.current = false;
    }
  }

  async function refreshLiveOnly() {
    // Lightweight refresh for broker truth: margins + positions + orders.
    // Avoid toggling the main busy spinner to keep UI calm.
    try {
      if (liveRefreshInFlightRef.current) return;
      // Don't overlap with a full refresh.
      if (refreshInFlightRef.current) return;
      liveRefreshInFlightRef.current = true;

      const [liveRes, ordersRes] = await Promise.all([
        tradingApi.liveSummary(),
        tradingApi.liveOrders(50),
      ]);

      if (liveRes.error) {
        setMsg((m) => [m, `Live: ${formatApiError(liveRes.error)}`].filter(Boolean).join(' • '));
      } else {
        setLiveSummary(liveRes.data || null);
      }

      if (ordersRes.error) {
        setMsg((m) => [m, `Kite orders: ${formatApiError(ordersRes.error)}`].filter(Boolean).join(' • '));
      } else {
        setLiveOrders(ordersRes.data || null);
      }

      // Keep capturing snapshots during lightweight polling too.
      if (!liveRes.error && !ordersRes.error) {
        captureKiteOrderPnlSnapshot(liveRes.data, ordersRes.data);
      }

      setLastUpdated(new Date().toISOString());
    } catch (e: any) {
      setMsg((m) => [m, `Live: ${formatApiError(e)}`].filter(Boolean).join(' • '));
    } finally {
      liveRefreshInFlightRef.current = false;
    }
  }

  useEffect(() => {
    // Allow other actions (Run/Start/Stop) to request an immediate refresh.
    const handler = () => {
      void refresh();
    };
    window.addEventListener('marketintel:exec-status-refresh', handler);
    return () => window.removeEventListener('marketintel:exec-status-refresh', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Allow other actions (Run/Start/Stop) to enable/disable polling.
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ enabled?: boolean }>;
      setExternalPolling(Boolean(ce?.detail?.enabled));
    };
    window.addEventListener('marketintel:exec-status-poll', handler as EventListener);
    return () => window.removeEventListener('marketintel:exec-status-poll', handler as EventListener);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Keep Live P/L + Open positions in sync with Kite even when the loop is stopped.
    // This only polls broker-derived endpoints, not logs/loop items.
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void refreshLiveOnly();
    };

    // Kick an initial light refresh shortly after mount.
    const t = window.setTimeout(tick, 1500);

    // Poll at a modest cadence to avoid hammering Kite.
    if (livePollTimerRef.current == null) {
      livePollTimerRef.current = window.setInterval(tick, 15000);
    }

    return () => {
      window.clearTimeout(t);
      if (livePollTimerRef.current != null) {
        window.clearInterval(livePollTimerRef.current);
        livePollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = latest?.metadata || {};
  const exec = meta?.execution || null;
  const riskCapital = meta?.risk_capital || null;
  const mode = meta?.execution_mode || meta?.mode || exec?.payload?.mode || null;
  const stopLossTrigger = exec?.payload?.stop_loss_trigger;

  const loopRunning = !!loop?.running;
  const loopLastItems: any[] = Array.isArray(loop?.last_items) ? loop.last_items : [];
  const bal = liveSummary?.balance;
  const shouldPoll = loopRunning || externalPolling;

  const executedLoopItems = loopLastItems.filter((it: any) => !!it?.executed);
  const kiteOrders: any[] = Array.isArray(liveOrders?.orders) ? liveOrders.orders : [];
  const executedKiteOrders = kiteOrders.filter((o: any) => {
    const status = String(o?.status || '').toUpperCase();
    const filledQty = typeof o?.filled_quantity === 'number' ? o.filled_quantity : null;
    return status === 'COMPLETE' || (filledQty != null && filledQty > 0);
  });
  const posPnlBySymbol = new Map<string, number>();
  (Array.isArray(liveSummary?.positions) ? liveSummary.positions : []).forEach((p: any) => {
    if (!p?.symbol) return;
    if (typeof p?.pnl !== 'number') return;
    posPnlBySymbol.set(String(p.symbol), p.pnl);
  });

  const maxLoopItems = !!maxTables['loop-items'];
  const maxRecentLogs = !!maxTables['recent-logs'];
  const maxExecutedLoop = !!maxTables['executed-loop'];
  const maxExecutedKite = true;

  useEffect(() => {
    // Poll only while something is actively running (loop or one-shot live auto).
    if (!shouldPoll) {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    // Kick an immediate refresh when polling becomes active.
    void refresh();
    if (pollTimerRef.current == null) {
      pollTimerRef.current = window.setInterval(() => {
        void refresh();
      }, 5000);
    }

    return () => {
      // If the component unmounts while polling, ensure we clean up.
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPoll]);
  const latestOneShotLiveAuto = (logs || []).find((r: any) => {
    const m = r?.metadata || {};
    return m?.pipeline === 'live-auto' && (m?.mode === 'live' || m?.execution_mode === 'live') && m?.auto === true;
  });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="card-title">Current Execution Status</div>
          <div className="text-xs text-gray-500">Shows continuous loop state + live P/L + recent activity (scrollable).</div>
        </div>
        <button
          onClick={refresh}
          disabled={busy}
          className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Live Auto Loop (Continuous)</div>
            <div className={`text-lg font-semibold ${loopRunning ? 'text-green-300' : ''}`}>{loopRunning ? 'Running' : 'Stopped'}</div>
            <div className="text-xs text-gray-500">Iterations: {loop?.iterations ?? 0}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Loop interval</div>
            <div className="text-lg font-semibold">{loop?.interval_seconds ?? '—'}s</div>
            <div className="text-xs text-gray-500">Auto max: {loop?.auto_max_symbols ? 'Yes' : 'No'}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Available margin</div>
            <div className="text-lg font-semibold">{typeof bal?.available_margin === 'number' ? fmt2(bal.available_margin) : '—'}</div>
            <div className="text-xs text-gray-500">cash: {typeof bal?.available_cash === 'number' ? fmt2(bal.available_cash) : '—'}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Live P/L</div>
            <div className={`text-lg font-semibold ${pnlTextClass(liveSummary?.total_pnl)}`}>{typeof liveSummary?.total_pnl === 'number' ? fmt2(liveSummary.total_pnl) : '—'}</div>
            <div className="text-xs text-gray-500">
              U: <span className={pnlTextClass(liveSummary?.unrealised_pnl)}>{typeof liveSummary?.unrealised_pnl === 'number' ? fmt2(liveSummary.unrealised_pnl) : '—'}</span>
              {' '}• R: <span className={pnlTextClass(liveSummary?.realised_pnl)}>{typeof liveSummary?.realised_pnl === 'number' ? fmt2(liveSummary.realised_pnl) : '—'}</span>
            </div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Open positions</div>
            <div className="text-lg font-semibold">{typeof liveSummary?.open_positions === 'number' ? liveSummary.open_positions : '—'}</div>
            <div className="text-xs text-gray-500">Updated: {liveSummary?.updated_at || '—'}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Last activity</div>
            <div className="text-xs text-gray-500">Loop: {loop?.last_run_at || '—'}</div>
            <div className="text-xs text-gray-500">One-shot: {latestOneShotLiveAuto?.created_at || '—'}</div>
            <div className="text-xs text-gray-500">Err: {loop?.last_error || '—'}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={`tile p-3 ${maxLoopItems ? 'md:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-400">Continuous loop last run items</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleTableMax('loop-items')}
                  className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
                >
                  {maxLoopItems ? 'Minimize' : 'Maximize'}
                </button>
                <button
                  onClick={clearLoopItems}
                  className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className={`border border-gray-800 rounded overflow-auto ${maxLoopItems ? 'max-h-[70vh]' : 'max-h-64'}`}>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-900 text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Act</th>
                    <th className="text-left p-2">Sel</th>
                    <th className="text-left p-2">Allow</th>
                    <th className="text-left p-2">Exec</th>
                    <th className="text-left p-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {loopLastItems.length === 0 ? (
                    <tr><td colSpan={6} className="p-2 text-gray-500">No loop items yet.</td></tr>
                  ) : (
                    loopLastItems.map((it: any, idx: number) => (
                      <tr key={idx} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{it.symbol || '—'}</td>
                        <td className="p-2">{it.action || '—'}</td>
                        <td className="p-2">{it.selected ? 'Y' : 'N'}</td>
                        <td className="p-2">{it.allowed == null ? '—' : (it.allowed ? 'Y' : 'N')}</td>
                        <td className="p-2">
                          {it.executed
                            ? (it.execution_status || 'Y')
                            : (it.selected
                              ? (it.allowed === false
                                ? 'Denied'
                                : (it.allowed === true
                                  ? (it.execution_status || 'Blocked')
                                  : 'Pending'))
                              : 'Not selected')}
                        </td>
                        <td className="p-2 text-gray-300">{it.error ? `Err: ${it.error}` : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-gray-500">Last summary: {loop?.last_summary ? JSON.stringify(loop.last_summary) : '—'}</div>
          </div>

          <div className={`tile p-3 ${maxRecentLogs ? 'md:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-400">Recent trade logs</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleTableMax('recent-logs')}
                  className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
                >
                  {maxRecentLogs ? 'Minimize' : 'Maximize'}
                </button>
                <button
                  onClick={clearRecentLogs}
                  className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className={`border border-gray-800 rounded overflow-auto ${maxRecentLogs ? 'max-h-[70vh]' : 'max-h-64'}`}>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-900 text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Act</th>
                    <th className="text-left p-2">Allowed</th>
                    <th className="text-left p-2">Order</th>
                    <th className="text-left p-2">Err</th>
                  </tr>
                </thead>
                <tbody>
                  {(logs || []).length === 0 ? (
                    <tr><td colSpan={6} className="p-2 text-gray-500">No logs yet.</td></tr>
                  ) : (
                    (logs || []).map((r: any) => (
                      <tr key={String(r.id)} className="border-t border-gray-800">
                        <td className="p-2 text-gray-400">{(r.created_at || '').replace('T', ' ').slice(0, 19) || '—'}</td>
                        <td className="p-2 font-mono">{r.symbol || '—'}</td>
                        <td className="p-2">{r.action || '—'}</td>
                        <td className="p-2">{r.allowed == null ? '—' : (r.allowed ? 'Y' : 'N')}</td>
                        <td className="p-2">{r.order_id || '—'}</td>
                        <td className="p-2 text-gray-300">{r.error ? String(r.error).slice(0, 80) : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={`tile p-3 ${maxExecutedLoop ? 'md:col-span-2' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-400">Executed stocks (last loop run)</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleTableMax('executed-loop')}
                  className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
                >
                  {maxExecutedLoop ? 'Minimize' : 'Maximize'}
                </button>
                <button
                  onClick={clearLoopItems}
                  className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className={`border border-gray-800 rounded overflow-auto ${maxExecutedLoop ? 'max-h-[70vh]' : 'max-h-64'}`}>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-900 text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Act</th>
                    <th className="text-right p-2">Qty</th>
                    <th className="text-right p-2">Last</th>
                    <th className="text-right p-2">Req cash</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Err</th>
                  </tr>
                </thead>
                <tbody>
                  {executedLoopItems.length === 0 ? (
                    <tr><td colSpan={7} className="p-2 text-gray-500">No executed items in the last loop run.</td></tr>
                  ) : (
                    executedLoopItems.map((it: any, idx: number) => (
                      <tr key={idx} className="border-t border-gray-800">
                        <td className="p-2 font-mono">{it.symbol || '—'}</td>
                        <td className="p-2">{it.action || '—'}</td>
                        <td className="p-2 text-right">{typeof it.quantity === 'number' ? it.quantity : '—'}</td>
                        <td className="p-2 text-right">{typeof it.last_price === 'number' ? fmt2(it.last_price) : '—'}</td>
                        <td className="p-2 text-right">{typeof it.required_cash_estimate === 'number' ? fmt2(it.required_cash_estimate) : '—'}</td>
                        <td className="p-2">{it.execution_status || '—'}</td>
                        <td className="p-2 text-gray-300">{it.error ? String(it.error).slice(0, 120) : ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tile p-3 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-400">Executed trades (Kite orders, live only)</div>
              <button
                onClick={clearKiteOrders}
                className="px-2 py-1 bg-gray-900 border border-gray-800 rounded text-xs hover:bg-gray-800"
              >
                Clear
              </button>
            </div>
            <div className="border border-gray-800 rounded overflow-auto max-h-[70vh]">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-900 text-gray-300 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Symbol</th>
                    <th className="text-left p-2">Act</th>
                    <th className="text-right p-2">Qty</th>
                    <th className="text-right p-2">Avg</th>
                    <th className="text-left p-2">Order</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-right p-2">P/L</th>
                  </tr>
                </thead>
                <tbody>
                  {executedKiteOrders.length === 0 ? (
                    <tr><td colSpan={8} className="p-2 text-gray-500">No executed Kite orders found.</td></tr>
                  ) : (
                    executedKiteOrders.slice(0, 50).map((o: any, idx: number) => {
                      const sym = String(o?.symbol || '—');
                      const key = kiteOrderKey(o, idx);
                      const pnl = typeof kiteOrderPnlSnapshot?.[key] === 'number' ? kiteOrderPnlSnapshot[key] : null;
                      const ts = o?.exchange_timestamp || o?.order_timestamp || null;
                      const qty = (typeof o?.filled_quantity === 'number' && o.filled_quantity > 0)
                        ? o.filled_quantity
                        : (typeof o?.quantity === 'number' ? o.quantity : null);
                      return (
                        <tr key={`${String(o?.order_id || sym)}-${idx}`} className="border-t border-gray-800">
                          <td className="p-2 text-gray-400">{ts ? String(ts).replace('T', ' ').slice(0, 19) : '—'}</td>
                          <td className="p-2 font-mono">{sym}</td>
                          <td className="p-2">{o?.side || '—'}</td>
                          <td className="p-2 text-right">{qty == null ? '—' : qty}</td>
                          <td className="p-2 text-right">{typeof o?.average_price === 'number' ? fmt2(o.average_price) : '—'}</td>
                          <td className="p-2">{o?.order_id || '—'}</td>
                          <td className="p-2">{o?.status || '—'}</td>
                          <td className={`p-2 text-right ${pnlTextClass(pnl)}`}>{pnl == null ? '—' : fmt2(pnl)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-gray-500">Orders come directly from Kite; P/L is a best-effort snapshot captured when the row was first seen.</div>
          </div>
        </div>

        {latest ? (
          <div className="tile p-3">
            <div className="text-xs text-gray-400 mb-1">Latest execution (expanded)</div>
            <div className="text-sm text-gray-200 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <div className="text-xs text-gray-500">Symbol</div>
                <div className="font-mono">{latest.symbol}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Action</div>
                <div>{latest.action}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Allowed</div>
                <div>{latest.allowed == null ? '—' : (latest.allowed ? 'Yes' : 'No')}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Mode</div>
                <div>{mode || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Order ID</div>
                <div>{latest.order_id || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Order status</div>
                <div>{latest.order_status || '—'}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="tile p-3">
                <div className="text-xs text-gray-400 mb-1">Decision Reasons</div>
                <div className="text-sm text-gray-200">
                  {Array.isArray(latest.reasons) && latest.reasons.length ? latest.reasons.join(' · ') : '—'}
                </div>
              </div>
              <div className="tile p-3">
                <div className="text-xs text-gray-400 mb-1">Error</div>
                <div className="text-sm text-gray-200">{latest.error || '—'}</div>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-xs text-gray-400 mb-1">Order Execution Agent Details</div>
              <div className="text-sm text-gray-200 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-gray-500">Attempted</div>
                  <div>{exec?.attempted == null ? '—' : (exec.attempted ? 'Yes' : 'No')}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Placed</div>
                  <div>{exec?.placed == null ? '—' : (exec.placed ? 'Yes' : 'No')}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Stop-loss trigger</div>
                  <div>{typeof stopLossTrigger === 'number' ? fmt2(stopLossTrigger) : (stopLossTrigger ?? '—')}</div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-1">Execution payload (scroll)</div>
                <pre className="text-xs text-gray-200 bg-gray-950/40 border border-gray-800 rounded p-3 overflow-auto max-h-64">{prettyJson(exec)}</pre>
              </div>

              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-1">Risk/Capital check (scroll)</div>
                <pre className="text-xs text-gray-200 bg-gray-950/40 border border-gray-800 rounded p-3 overflow-auto max-h-64">{prettyJson(riskCapital)}</pre>
              </div>
            </div>

            <div className="mt-3 text-xs text-gray-500">
              Logged at: {latest.created_at || '—'}{lastUpdated ? ` • Last refreshed: ${lastUpdated}` : ''}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400">{msg || 'No recent execution found.'}</div>
        )}

      </div>

      {msg && <div className="mt-2 text-xs text-gray-400">{msg}</div>}
    </div>
  );
}

function TradingAutomationSettingsCard() {
  const [cfg, setCfg] = useState<TASettings | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [savingPaperToggle, setSavingPaperToggle] = useState(false);

  const defaultCfg: TASettings = {
    enable_trading_decision_agent: true,
    enable_risk_capital_agent: true,
    enable_order_execution_agent: false,
    enable_trade_logger: true,

    loss_protection_mode: false,

    enable_paper_trading: false,

  live_selected_symbols: null,

    trade_only_market_hours: true,
    one_active_position_per_symbol: true,
    product: 'CNC',
    order_variety: 'regular',
    default_quantity: 1,
    stop_loss_pct: 0.01,

    capital_per_trade_pct: 0.02,
    max_daily_loss_pct: 0.03,
    max_open_trades: 3,
    min_confidence: 0.65,
    block_on_extreme_volatility: true,

    buy_min_ml_up_prob: 0.7,
    buy_min_rsi: 45,
    buy_max_rsi: 65,
    buy_max_risk_score: 0.6,
    sell_max_ml_up_prob: 0.4,
    sell_min_risk_score: 0.75,
  };

  useEffect(() => {
    (async () => {
      try {
        // Initialize with defaults so toggles work even before/if fetch completes.
        setCfg(defaultCfg);
        const server = await getTradingAutomationSettings();
        setCfg({ ...defaultCfg, ...server });
      } catch {
        setCfg(defaultCfg);
        setMsg('Warning: failed to load settings from backend; using defaults');
      }
    })();
  }, []);

  function upd<K extends keyof TASettings>(k: K, v: TASettings[K]) {
    setCfg(prev => ({ ...(prev || defaultCfg), [k]: v }));
  }

  async function togglePaperTrading(enabled: boolean) {
    const prev = cfg || defaultCfg;
    const next = { ...prev, enable_paper_trading: enabled };
    setCfg(next);
    setSavingPaperToggle(true);
    setMsg('Saving paper trading setting…');

    try {
      const saved = await updateTradingAutomationSettings(next);
      setCfg(saved);
      setMsg(saved.enable_paper_trading ? 'Paper trading enabled' : 'Paper trading disabled');
    } catch (e: any) {
      setCfg(prev);
      setMsg(`Failed: ${formatApiError(e)}`);
    } finally {
      setSavingPaperToggle(false);
    }
  }

  async function save() {
    if (!cfg) return;
    try {
      const d = await updateTradingAutomationSettings(cfg);
      setCfg(d);
      setMsg('Saved');
    } catch (e: any) {
      setMsg(`Failed: ${formatApiError(e)}`);
    }
  }

  const c = cfg || defaultCfg;

  return (
    <div className="card p-4">
      <div className="card-title mb-2">Trading Automation Settings</div>

      {c.enable_order_execution_agent && (
        <div className="mb-3 text-xs text-yellow-300 bg-yellow-950/30 border border-yellow-900 rounded p-3">
          Warning: Order execution is enabled. The backend may place real orders via Kite.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-400 mb-1">Agents</div>
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.enable_trading_decision_agent} onChange={(e) => upd('enable_trading_decision_agent', e.target.checked)} />
              <span className="text-sm">Trading Decision Agent</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.enable_risk_capital_agent} onChange={(e) => upd('enable_risk_capital_agent', e.target.checked)} />
              <span className="text-sm">Risk & Capital Agent</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.enable_order_execution_agent} onChange={(e) => upd('enable_order_execution_agent', e.target.checked)} />
              <span className="text-sm">Order Execution Agent</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.enable_trade_logger} onChange={(e) => upd('enable_trade_logger', e.target.checked)} />
              <span className="text-sm">Trade Logger</span>
            </label>

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!c.loss_protection_mode}
                onChange={(e) => upd('loss_protection_mode', e.target.checked)}
              />
              <span className="text-sm">Loss protection mode (safer)</span>
            </label>

            {c.loss_protection_mode && (
              <div className="text-xs text-gray-500">
                Active: max open trades capped to 1, min confidence floor 0.75, and SELL execution is blocked.
              </div>
            )}

            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!c.enable_paper_trading}
                disabled={savingPaperToggle}
                onChange={(e) => togglePaperTrading(e.target.checked)}
              />
              <span className="text-sm">Paper Trading (simulate execution) — auto-saves</span>
            </label>
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400 mb-1">Execution Safety</div>
          <div className="grid grid-cols-1 gap-3">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.trade_only_market_hours} onChange={(e) => upd('trade_only_market_hours', e.target.checked)} />
              <span className="text-sm">Only during market hours</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.one_active_position_per_symbol} onChange={(e) => upd('one_active_position_per_symbol', e.target.checked)} />
              <span className="text-sm">One position per symbol</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-400 mb-1">Product</div>
                <select className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.product} onChange={(e) => upd('product', e.target.value as TASettings['product'])}>
                  <option value="CNC">CNC</option>
                  <option value="MIS">MIS</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Default Qty</div>
                <input type="number" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.default_quantity} onChange={(e) => upd('default_quantity', Number(e.target.value))} />
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Stop Loss % (e.g. 0.01 = 1%)</div>
              <input type="number" step="0.001" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.stop_loss_pct} onChange={(e) => upd('stop_loss_pct', Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400 mb-1">Risk & Capital</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">Min Confidence</div>
              <input type="number" step="0.01" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.min_confidence} onChange={(e) => upd('min_confidence', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Max Open Trades</div>
              <input type="number" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.max_open_trades} onChange={(e) => upd('max_open_trades', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Capital/Trade %</div>
              <input type="number" step="0.001" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.capital_per_trade_pct} onChange={(e) => upd('capital_per_trade_pct', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">Max Daily Loss %</div>
              <input type="number" step="0.001" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.max_daily_loss_pct} onChange={(e) => upd('max_daily_loss_pct', Number(e.target.value))} />
            </div>
            <label className="col-span-2 inline-flex items-center gap-2">
              <input type="checkbox" checked={!!c.block_on_extreme_volatility} onChange={(e) => upd('block_on_extreme_volatility', e.target.checked)} />
              <span className="text-sm">Block on extreme volatility</span>
            </label>
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400 mb-1">Decision Thresholds</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-400 mb-1">BUY Min ML Up Prob</div>
              <input type="number" step="0.01" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.buy_min_ml_up_prob} onChange={(e) => upd('buy_min_ml_up_prob', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">SELL Max ML Up Prob</div>
              <input type="number" step="0.01" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.sell_max_ml_up_prob} onChange={(e) => upd('sell_max_ml_up_prob', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">BUY RSI Min</div>
              <input type="number" step="0.5" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.buy_min_rsi} onChange={(e) => upd('buy_min_rsi', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">BUY RSI Max</div>
              <input type="number" step="0.5" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.buy_max_rsi} onChange={(e) => upd('buy_max_rsi', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">BUY Max Risk Score</div>
              <input type="number" step="0.01" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.buy_max_risk_score} onChange={(e) => upd('buy_max_risk_score', Number(e.target.value))} />
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">SELL Min Risk Score</div>
              <input type="number" step="0.01" className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2" value={c.sell_min_risk_score} onChange={(e) => upd('sell_min_risk_score', Number(e.target.value))} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600">Save</button>
        {msg && <div className="text-sm text-gray-400">{msg}</div>}
      </div>
    </div>
  );
}

function PaperTradingCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [resetCash, setResetCash] = useState<number>(100000);
  const [autoMax, setAutoMax] = useState<number>(5);
  const [autoRun, setAutoRun] = useState<any>(null);

  async function refresh() {
    const s = await tradingApi.paperSummary();
    const p = await tradingApi.paperPositions();
    if (s.error) setMsg(formatApiError(s.error));
    else setSummary(s.data);
    if (p.error) setMsg(formatApiError(p.error));
    else setPositions(p.data || []);
  }

  async function reset() {
    try {
      setBusy(true);
      setMsg('');
      const res = await tradingApi.resetPaperAccount(resetCash);
      if (res.error) {
        setMsg(`Reset failed: ${formatApiError(res.error)}`);
        return;
      }
      setMsg('Paper account reset');
      await refresh();
    } catch (e: any) {
      setMsg(`Reset failed: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runAuto() {
    try {
      setBusy(true);
      setMsg('');
      const res = await tradingApi.runPaperAuto(autoMax);
      if (res.error) {
        setMsg(`Run failed: ${formatApiError(res.error)}`);
        return;
      }
      setAutoRun(res.data);
      setMsg(`Auto run complete: selected ${res.data.selected}, executed ${res.data.executed}`);
      await refresh();
    } catch (e: any) {
      setMsg(`Run failed: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="card-title">Paper Trading</div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm">Refresh</button>
          <input
            type="number"
            className="bg-gray-900 border border-gray-800 rounded px-3 py-2 w-24"
            value={autoMax}
            min={1}
            max={50}
            onChange={(e) => setAutoMax(Number(e.target.value))}
          />
          <button onClick={runAuto} disabled={busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Running…' : 'Auto Run'}</button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Cash</div>
            <div className="text-lg font-semibold">{fmt2(summary.cash ?? 0)}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Equity</div>
            <div className="text-lg font-semibold">{summary.equity == null ? '—' : fmt2(summary.equity)}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Open Positions</div>
            <div className="text-lg font-semibold">{summary.open_positions ?? 0}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Realized P&L</div>
            <div className={`text-lg font-semibold ${pnlTextClass(summary.realized_pnl ?? 0)}`}>{fmt2(summary.realized_pnl ?? 0)}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Unrealized P&L</div>
            <div className={`text-lg font-semibold ${pnlTextClass(summary.unrealized_pnl)}`}>{summary.unrealized_pnl == null ? '—' : fmt2(summary.unrealized_pnl)}</div>
          </div>
          <div className="tile p-3">
            <div className="text-xs text-gray-400">Total P&L</div>
            <div className={`text-lg font-semibold ${pnlTextClass(summary.total_pnl)}`}>{summary.total_pnl == null ? '—' : fmt2(summary.total_pnl)}</div>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <div>
          <div className="text-xs text-gray-400 mb-1">Reset starting cash</div>
          <input
            type="number"
            className="bg-gray-900 border border-gray-800 rounded px-3 py-2 w-48"
            value={resetCash}
            onChange={(e) => setResetCash(Number(e.target.value))}
          />
        </div>
        <button onClick={reset} disabled={busy} className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>Reset</button>
        <div className="text-xs text-gray-500">Reset only affects paper cash balance; positions are derived from logs.</div>
      </div>

      {autoRun && Array.isArray(autoRun.items) && (
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Auto Run Results</div>
          <div className="overflow-x-auto border border-gray-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900 text-gray-300">
                <tr>
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Action</th>
                  <th className="text-left p-2">Conf</th>
                  <th className="text-left p-2">Selected</th>
                  <th className="text-left p-2">Allowed</th>
                  <th className="text-left p-2">Executed</th>
                  <th className="text-left p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {autoRun.items.slice(0, 50).map((it: any) => (
                  <tr key={String(it.symbol)} className="border-t border-gray-800">
                    <td className="p-2 font-mono">{it.symbol}</td>
                    <td className="p-2">{it.action}</td>
                    <td className="p-2">{typeof it.confidence === 'number' ? it.confidence.toFixed(2) : '—'}</td>
                    <td className="p-2">{it.selected ? 'Yes' : 'No'}</td>
                    <td className="p-2">{it.allowed == null ? '—' : (it.allowed ? 'Yes' : 'No')}</td>
                    <td className="p-2">{it.executed ? (it.execution_status || 'Yes') : 'No'}</td>
                    <td className="p-2 text-gray-300">
                      {it.error ? `Error: ${it.error}` : (Array.isArray(it.reasons) ? it.reasons.slice(0, 3).join(' · ') : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-500 mt-2">Selection is based on decision agent reasons + confidence; only BUY candidates are selected.</div>
        </div>
      )}

      <div className="text-xs text-gray-500 mb-2">Open positions are reconstructed from trade logs where execution mode is paper.</div>
      <div className="border border-gray-800 rounded overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="text-left px-3 py-2">Symbol</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Entry</th>
              <th className="text-right px-3 py-2">Last</th>
              <th className="text-right px-3 py-2">Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {(positions || []).length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-3 text-gray-500">No open paper positions</td></tr>
            ) : (
              positions.map((p: any) => (
                <tr key={String(p.symbol)} className="border-t border-gray-800">
                  <td className="px-3 py-2 font-mono">{p.symbol}</td>
                  <td className="px-3 py-2 text-right">{p.quantity}</td>
                  <td className="px-3 py-2 text-right">{fmt2(p.entry_price)}</td>
                  <td className="px-3 py-2 text-right">{p.last_price == null ? '—' : fmt2(p.last_price)}</td>
                  <td className={`px-3 py-2 text-right ${pnlTextClass(p.unrealized_pnl)}`}>{p.unrealized_pnl == null ? '—' : fmt2(p.unrealized_pnl)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {msg && <div className="mt-2 text-xs text-gray-400">{msg}</div>}
      <div className="mt-3 text-xs text-gray-500">Tip: Enable paper trading in settings above, then click “Auto Run” to select and simulate across configured symbols.</div>
    </div>
  );
}

function LiveTradingCard() {
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useLocalStorage<any>('market_intel:live_trading:last_run', {
    maxSymbols: 1,
    allowSell: false,
    msg: '',
    result: null,
    updatedAt: null,
  });

  const [msg, setMsg] = useState<string>(() => String(persisted?.msg || ''));
  const [maxSymbols, setMaxSymbols] = useState<number>(() => {
    const v = Number(persisted?.maxSymbols);
    return Number.isFinite(v) && v >= 1 ? v : 1;
  });
  const [confirm, setConfirm] = useState<boolean>(false);
  const [allowSell, setAllowSell] = useState<boolean>(() => !!persisted?.allowSell);
  const [confirmSell, setConfirmSell] = useState<boolean>(false);
  const [result, setResult] = useState<any>(() => persisted?.result ?? null);

  const [balBusy, setBalBusy] = useState(false);
  const [balance, setBalance] = useState<any>(null);
  const [balErr, setBalErr] = useState<string>('');

  const [recBusy, setRecBusy] = useState(false);
  const [recErr, setRecErr] = useState<string>('');
  const [recommendedMax, setRecommendedMax] = useState<number | null>(null);

  const [loopBusy, setLoopBusy] = useState(false);
  const [loopPersisted, setLoopPersisted] = useLocalStorage<any>('market_intel:live_trading:auto_loop', {
    status: null,
    intervalSec: 120,
    lastFetchedAt: null,
  });
  const [loopStatus, setLoopStatus] = useState<any>(() => loopPersisted?.status ?? null);
  const [loopMsg, setLoopMsg] = useState<string>('');
  const [loopIntervalSec, setLoopIntervalSec] = useState<number>(() => {
    const v = Number(loopPersisted?.intervalSec);
    return Number.isFinite(v) && v >= 10 ? v : 120;
  });
  const [loopConfirm, setLoopConfirm] = useState<boolean>(false);

  async function refreshBalance() {
    try {
      setBalBusy(true);
      setBalErr('');
      const res = await tradingApi.liveBalance();
      if (res.error) {
        setBalErr(formatApiError(res.error));
        setBalance(null);
        return;
      }
      setBalance(res.data || null);
    } catch (e: any) {
      setBalErr(formatApiError(e));
      setBalance(null);
    } finally {
      setBalBusy(false);
    }
  }

  async function refreshRecommendedMax() {
    try {
      setRecBusy(true);
      setRecErr('');
      const res = await tradingApi.liveRecommendedMaxSymbols();
      if (res.error) {
        setRecErr(formatApiError(res.error));
        setRecommendedMax(null);
        return;
      }
      const v = Number(res.data?.recommended_max_symbols);
      if (Number.isFinite(v) && v >= 1) {
        setRecommendedMax(v);
        setMaxSymbols(Math.max(1, Math.min(10, v)));
      }
    } catch (e: any) {
      setRecErr(formatApiError(e));
      setRecommendedMax(null);
    } finally {
      setRecBusy(false);
    }
  }

  async function refreshLoopStatus() {
    try {
      const res = await tradingApi.liveAutoLoopStatus();
      if (res.error) {
        setLoopMsg(`Loop status error: ${formatApiError(res.error)}`);
        return;
      }
      setLoopStatus(res.data || null);
      setLoopPersisted((prev: any) => ({
        ...(prev || {}),
        status: res.data || null,
        intervalSec: loopIntervalSec,
        lastFetchedAt: new Date().toISOString(),
      }));
      setLoopMsg('');
    } catch (e: any) {
      setLoopMsg(`Loop status error: ${formatApiError(e)}`);
    }
  }

  async function startLoop() {
    try {
      setLoopBusy(true);
      setLoopMsg('');

      try {
        window.dispatchEvent(new CustomEvent('marketintel:exec-status-poll', { detail: { enabled: true } }));
      } catch {
        // ignore
      }

      if (!loopConfirm) {
        setLoopMsg('Please tick the continuous mode confirmation before starting the loop.');
        return;
      }
      if (!confirm) {
        setLoopMsg('Please tick the live trading confirmation before starting the loop.');
        return;
      }
      if (allowSell && !confirmSell) {
        setLoopMsg('Please tick the SELL confirmation checkbox to allow SELL orders.');
        return;
      }

      const res = await tradingApi.liveAutoLoopStart({
        confirm_loop: true,
        confirm: true,
        allow_sell: !!allowSell,
        confirm_sell: !!confirmSell,
        interval_seconds: Math.max(10, Math.min(3600, Number(loopIntervalSec) || 120)),
        auto_max_symbols: true,
        max_symbols: null,
      });
      if (res.error) {
        setLoopMsg(`Failed to start loop: ${formatApiError(res.error)}`);
        return;
      }
      setLoopStatus(res.data || null);
      setLoopPersisted((prev: any) => ({
        ...(prev || {}),
        status: res.data || null,
        intervalSec: loopIntervalSec,
        lastFetchedAt: new Date().toISOString(),
      }));
      setLoopMsg('Live auto-run loop started.');
      try {
        window.dispatchEvent(new Event('marketintel:exec-status-refresh'));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setLoopMsg(`Failed to start loop: ${formatApiError(e)}`);
      try {
        window.dispatchEvent(new CustomEvent('marketintel:exec-status-poll', { detail: { enabled: false } }));
      } catch {
        // ignore
      }
    } finally {
      setLoopBusy(false);
    }
  }

  async function stopLoop() {
    try {
      setLoopBusy(true);
      const res = await tradingApi.liveAutoLoopStop();
      if (res.error) {
        setLoopMsg(`Failed to stop loop: ${formatApiError(res.error)}`);
        return;
      }
      setLoopStatus(res.data || null);
      setLoopPersisted((prev: any) => ({
        ...(prev || {}),
        status: res.data || null,
        intervalSec: loopIntervalSec,
        lastFetchedAt: new Date().toISOString(),
      }));
      setLoopMsg('Live auto-run loop stopped.');
      try {
        window.dispatchEvent(new CustomEvent('marketintel:exec-status-poll', { detail: { enabled: false } }));
      } catch {
        // ignore
      }
      try {
        window.dispatchEvent(new Event('marketintel:exec-status-refresh'));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setLoopMsg(`Failed to stop loop: ${formatApiError(e)}`);
    } finally {
      setLoopBusy(false);
    }
  }

  useEffect(() => {
    refreshBalance();
    refreshRecommendedMax();
    refreshLoopStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      refreshLoopStatus();
    }, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    try {
      setBusy(true);
      setMsg('');
      setResult(null);

      try {
        window.dispatchEvent(new CustomEvent('marketintel:exec-status-poll', { detail: { enabled: true } }));
      } catch {
        // ignore
      }

      if (!confirm) {
        setMsg('Please tick the confirmation checkbox before running live auto trading.');
        return;
      }
      if (allowSell && !confirmSell) {
        setMsg('Please tick the SELL confirmation checkbox to allow SELL orders.');
        return;
      }

          const availableMargin = typeof balance?.available_margin === 'number' ? balance.available_margin : null;
          if (availableMargin != null && availableMargin <= 0) {
            setMsg('Live available margin is 0 (or unavailable). Add funds or refresh balance before running.');
        return;
      }

      const res = await tradingApi.runLiveAuto(maxSymbols, confirm, allowSell, confirmSell);
      if (res.error) {
        setMsg(`Live run failed: ${formatApiError(res.error)}`);
        return;
      }
      setResult(res.data);
      const doneMsg = `Live run complete: selected ${res.data.selected}, executed ${res.data.executed}`;
      setMsg(doneMsg);
      setPersisted((prev: any) => ({
        ...(prev || {}),
        maxSymbols,
        allowSell,
        msg: doneMsg,
        result: res.data,
        updatedAt: new Date().toISOString(),
      }));

      // Update Current Execution Status immediately.
      try {
        window.dispatchEvent(new Event('marketintel:exec-status-refresh'));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setMsg(`Live run failed: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
      try {
        window.dispatchEvent(new CustomEvent('marketintel:exec-status-poll', { detail: { enabled: false } }));
      } catch {
        // ignore
      }
    }
  }

  function clearLastRun() {
    setResult(null);
    setMsg('');
    setPersisted((prev: any) => ({
      ...(prev || {}),
      msg: '',
      result: null,
      updatedAt: null,
    }));
  }

  const canRun = !busy && confirm && (!allowSell || confirmSell);
  const availableMargin = typeof balance?.available_margin === 'number' ? balance.available_margin : null;
  const availableCash = typeof balance?.available_cash === 'number' ? balance.available_cash : null;
  const net = typeof balance?.net === 'number' ? balance.net : null;

  return (
    <div className="card p-4 border border-red-900/40">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="card-title">Live Trading (Real Orders)</div>
          <div className="text-xs text-gray-500">Runs decision + risk across configured symbols and may place real Kite orders.</div>
          {persisted?.updatedAt && (
            <div className="text-xs text-gray-600 mt-1">Last run saved: {persisted.updatedAt}</div>
          )}
        </div>
      </div>

      <div className="mb-3 text-xs text-red-300 bg-red-950/30 border border-red-900 rounded p-3">
        Warning: This can place real orders. Use only if you understand the risks. It requires an explicit confirmation checkbox.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-3">
        <div className="tile p-3 md:col-span-2">
          <div className="text-xs text-gray-400">Live available margin (equity)</div>
          <div className="text-lg font-semibold">
            {availableMargin == null ? '—' : fmt2(availableMargin)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            <span>cash: {availableCash == null ? '—' : fmt2(availableCash)}</span>
            <span className="mx-2">•</span>
            <span>net: {net == null ? '—' : fmt2(net)}</span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={refreshBalance}
              disabled={balBusy}
              className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm ${balBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {balBusy ? 'Refreshing…' : 'Refresh balance'}
            </button>
            <button
              onClick={refreshRecommendedMax}
              disabled={recBusy}
              className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm ${recBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {recBusy ? 'Calculating…' : 'Auto-set Max symbols'}
            </button>
            <div className="text-xs text-gray-500">
              {balance?.updated_at ? `Updated: ${balance.updated_at}` : ''}
            </div>
          </div>
          {balErr && <div className="mt-2 text-xs text-red-300">Balance error: {balErr}</div>}
          {recErr && <div className="mt-2 text-xs text-red-300">Auto max error: {recErr}</div>}
          {recommendedMax != null && (
            <div className="mt-2 text-xs text-gray-500">Recommended max symbols: {recommendedMax}</div>
          )}
        </div>
      </div>

      <div className="tile p-3 mb-3 border border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Live Auto Run (Continuous)</div>
            <div className="text-xs text-gray-500">Runs in the background during market hours. Use Stop to halt it.</div>
          </div>
          <div className="text-xs text-gray-400">
            Status: {loopStatus?.running ? 'Running' : 'Stopped'}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-3">
          <div>
            <div className="text-xs text-gray-400 mb-1">Interval (seconds)</div>
            <input
              type="number"
              className="bg-gray-900 border border-gray-800 rounded px-3 py-2 w-28"
              value={loopIntervalSec}
              min={10}
              max={3600}
              onChange={(e) => setLoopIntervalSec(Number(e.target.value) || 120)}
            />
          </div>

          <label className="inline-flex items-center gap-2 mt-5">
            <input type="checkbox" checked={loopConfirm} onChange={(e) => setLoopConfirm(e.target.checked)} />
            <span className="text-sm">I confirm: run continuously during market hours</span>
          </label>

          <button
            onClick={startLoop}
            disabled={loopBusy || !!loopStatus?.running}
            className={`px-3 py-2 bg-red-800 rounded hover:bg-red-700 text-sm mt-5 ${(loopBusy || !!loopStatus?.running) ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            Start
          </button>

          <button
            onClick={stopLoop}
            disabled={loopBusy || !loopStatus?.running}
            className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm mt-5 ${(loopBusy || !loopStatus?.running) ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            Stop
          </button>

          <button
            onClick={refreshLoopStatus}
            disabled={loopBusy}
            className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm mt-5 ${loopBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            Refresh
          </button>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          <div>Iterations: {loopStatus?.iterations ?? 0}</div>
          <div>Last run: {loopStatus?.last_run_at || '—'}</div>
          <div>Last error: {loopStatus?.last_error || '—'}</div>
          <div>Last summary: {loopStatus?.last_summary ? JSON.stringify(loopStatus.last_summary) : '—'}</div>
          <div className="mt-1">Note: Max symbols is auto-calculated each loop based on available margin + last close prices.</div>
        </div>

        {loopMsg && <div className="mt-2 text-xs text-gray-300">{loopMsg}</div>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-xs text-gray-400 mb-1">Max symbols (top BUY picks)</div>
          <input
            type="number"
            className="bg-gray-900 border border-gray-800 rounded px-3 py-2 w-28"
            value={maxSymbols}
            min={1}
            max={10}
            onChange={(e) => setMaxSymbols(Number(e.target.value) || 1)}
          />
        </div>

        <label className="inline-flex items-center gap-2 mt-5">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span className="text-sm">I confirm: run live auto trading</span>
        </label>

        <label className="inline-flex items-center gap-2 mt-5">
          <input
            type="checkbox"
            checked={allowSell}
            onChange={(e) => {
              const v = e.target.checked;
              setAllowSell(v);
              if (!v) setConfirmSell(false);
            }}
          />
          <span className="text-sm">Allow SELL execution (may short)</span>
        </label>

        {allowSell && (
          <label className="inline-flex items-center gap-2 mt-5">
            <input type="checkbox" checked={confirmSell} onChange={(e) => setConfirmSell(e.target.checked)} />
            <span className="text-sm">I confirm: allow SELL orders</span>
          </label>
        )}

        <button
          onClick={run}
          disabled={!canRun}
          className={`px-3 py-2 bg-red-800 rounded hover:bg-red-700 text-sm mt-5 ${!canRun ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {busy ? 'Running…' : 'Live Auto Run'}
        </button>

        <button
          onClick={clearLastRun}
          disabled={busy}
          className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 text-sm mt-5 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          Clear last run
        </button>

        <div className="text-xs text-gray-500 mt-5">Tip: Check “Current Execution Status” after the run to see the latest execution payload.</div>
      </div>

      {result && Array.isArray(result.items) && (
        <div className="mt-4">
          <div className="text-sm font-semibold mb-2">Live Run Results</div>
          <div className="overflow-x-auto border border-gray-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900 text-gray-300">
                <tr>
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Action</th>
                  <th className="text-left p-2">Conf</th>
                  <th className="text-left p-2">Selected</th>
                  <th className="text-left p-2">Allowed</th>
                  <th className="text-left p-2">Executed</th>
                  <th className="text-left p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {result.items.slice(0, 50).map((it: any) => (
                  <tr key={String(it.symbol)} className="border-t border-gray-800">
                    <td className="p-2 font-mono">{it.symbol}</td>
                    <td className="p-2">{it.action}</td>
                    <td className="p-2">{typeof it.confidence === 'number' ? it.confidence.toFixed(2) : '—'}</td>
                    <td className="p-2">{it.selected ? 'Yes' : 'No'}</td>
                    <td className="p-2">{it.allowed == null ? '—' : (it.allowed ? 'Yes' : 'No')}</td>
                    <td className="p-2">{it.executed ? (it.execution_status || 'Yes') : 'No'}</td>
                    <td className="p-2 text-gray-300">
                      {it.error ? `Error: ${it.error}` : (Array.isArray(it.reasons) ? it.reasons.slice(0, 3).join(' · ') : '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-500 mt-2">Selection is based on decision reasons + confidence; BUY is executed, and SELL only if enabled + confirmed.</div>
        </div>
      )}

      {msg && <div className="mt-2 text-xs text-gray-300">{msg}</div>}
    </div>
  );
}

function ForceExitAllCard() {
  const [busy, setBusy] = useState(false);
  const [stopLoopFirst, setStopLoopFirst] = useState<boolean>(true);
  const [confirm, setConfirm] = useState<boolean>(false);
  const [phrase, setPhrase] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [result, setResult] = useState<any>(null);

  function phraseOk(): boolean {
    return String(phrase || '').trim().toUpperCase() === 'EXIT ALL';
  }

  async function run() {
    try {
      setBusy(true);
      setMsg('');
      setResult(null);

      if (!confirm) {
        setMsg('Please tick the confirmation checkbox before forcing exit.');
        return;
      }
      if (!phraseOk()) {
        setMsg('Type the exact phrase EXIT ALL to enable Force Exit.');
        return;
      }

      const res = await tradingApi.forceExitAll({
        confirm_exit_all: true,
        confirm_phrase: String(phrase || '').trim(),
        stop_auto_loop: !!stopLoopFirst,
        include_equity: true,
        include_fo: true,
      });
      if (res.error) {
        setMsg(`Force exit failed: ${formatApiError(res.error)}`);
        return;
      }
      setResult(res.data || null);
      setMsg(
        `Force exit complete: attempted ${res.data?.attempted ?? 0}, placed ${res.data?.placed ?? 0}, failed ${res.data?.failed ?? 0}`
      );
      try {
        window.dispatchEvent(new Event('marketintel:exec-status-refresh'));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setMsg(`Force exit failed: ${formatApiError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const canRun = !busy && confirm && phraseOk();

  return (
    <div className="card p-4 border border-red-900/60">
      <div className="card-title">Emergency: Force Exit All (MIS/CNC/F&amp;O)</div>
      <div className="text-xs text-gray-500 mt-1">
        Places market orders to flatten all open Kite positions. This does not use the decision agent.
      </div>

      <div className="mt-3 text-xs text-red-300 bg-red-950/30 border border-red-900 rounded p-3">
        Danger: This can place real SELL/BUY orders to close positions. Use only during emergencies.
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-3">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={stopLoopFirst}
            onChange={(e) => setStopLoopFirst(e.target.checked)}
          />
          <span className="text-sm">Stop live auto-loop first</span>
        </label>

        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span className="text-sm">I confirm: force exit all live positions</span>
        </label>

        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-400">Type:</div>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded px-3 py-2 w-40 font-mono"
            placeholder="EXIT ALL"
          />
        </div>

        <button
          onClick={run}
          disabled={!canRun}
          className={`px-3 py-2 bg-red-800 rounded hover:bg-red-700 text-sm ${!canRun ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {busy ? 'Exiting…' : 'FORCE EXIT ALL'}
        </button>
      </div>

      {msg && <div className="mt-2 text-xs text-gray-300">{msg}</div>}

      {result?.items && Array.isArray(result.items) && (
        <div className="mt-4">
          <div className="text-sm font-semibold mb-2">Force Exit Results</div>
          <div className="overflow-x-auto border border-gray-800 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-900 text-gray-300">
                <tr>
                  <th className="text-left p-2">Exchange</th>
                  <th className="text-left p-2">Symbol</th>
                  <th className="text-left p-2">Product</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-left p-2">Side</th>
                  <th className="text-left p-2">Order</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {result.items.slice(0, 200).map((it: any, idx: number) => (
                  <tr key={`${String(it.symbol)}:${idx}`} className="border-t border-gray-800">
                    <td className="p-2">{it.exchange || '—'}</td>
                    <td className="p-2 font-mono">{it.symbol}</td>
                    <td className="p-2">{it.product || '—'}</td>
                    <td className="p-2 text-right">{it.quantity}</td>
                    <td className="p-2">{it.side}</td>
                    <td className="p-2 font-mono">{it.order_id || '—'}</td>
                    <td className="p-2">{it.status || '—'}</td>
                    <td className="p-2 text-gray-300">{it.error ? String(it.error) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Note: Orders are submitted sequentially with light throttling to reduce rate-limit spikes.
          </div>
        </div>
      )}
    </div>
  );
}
