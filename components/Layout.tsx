"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { useKiteHealth } from '@/lib/hooks/useKiteHealth';
import { useBackendHealth } from '@/lib/hooks/useBackendHealth';
import { AlertTriangle, X } from 'lucide-react';
import { symbolsApi } from '@/lib/api/symbols';
import type { SymbolRef } from '@/types/api';
import { DEFAULT_UI_PREFERENCES, UI_FEATURE_FLAGS, UI_PREFERENCES_STORAGE_KEY, type UiPreferences } from '@/lib/config/ui';

export default function Layout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const loggedInUser = 'Mahesh US';
  const { data } = useKiteHealth();
  const { data: backendHealthResult } = useBackendHealth();
  const health = data?.data;
  const backendHealth = backendHealthResult?.data;
  const backendDown = Boolean(backendHealthResult?.error) || (backendHealth ? backendHealth.status !== 'ok' : false);
  const [backendBannerArmed, setBackendBannerArmed] = useState(false);
  const showWarning = health && health.ok === false && health.status_code === 403;
  const [kiteWarningDismissed, setKiteWarningDismissed] = useLocalStorage<boolean>('app:kiteWarningDismissed', false);
  const [currentSymbol, setCurrentSymbol] = useLocalStorage<string>('app:symbol', 'RELIANCE');
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useLocalStorage<string>('app:query', currentSymbol || '');
  const [uiPrefs] = useLocalStorage<UiPreferences>(UI_PREFERENCES_STORAGE_KEY, DEFAULT_UI_PREFERENCES);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SymbolRef[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const sugTimeout = useRef<number | null>(null);

  const hideSymbolUi = pathname === '/settings' || pathname.startsWith('/trading-automation');

  // If Kite recovers (token refreshed), automatically un-dismiss the banner so it can show again
  // the next time the token expires.
  useEffect(() => {
    if (health && health.ok === true && kiteWarningDismissed) {
      setKiteWarningDismissed(false);
    }
  }, [health, kiteWarningDismissed, setKiteWarningDismissed]);

  // Avoid a brief "backend down" flash during startup/reload.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setBackendBannerArmed(true), 2000);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (sugTimeout.current) { clearTimeout(sugTimeout.current); sugTimeout.current = null; }
    const q = (query || '').trim();
    if (!q) { setSuggestions([]); setActiveIdx(-1); return; }
    sugTimeout.current = window.setTimeout(async () => {
      try {
        const res = await symbolsApi.search(q.toUpperCase(), 10);
        const list = res?.data || [];
        setSuggestions(list);
        setActiveIdx(list.length ? 0 : -1);
      } catch { setSuggestions([]); setActiveIdx(-1); }
    }, 250);
    return () => { if (sugTimeout.current) { clearTimeout(sugTimeout.current); sugTimeout.current = null; } };
  }, [query]);

  // Avoid hydration mismatch between SSR default and client localStorage value
  useEffect(() => { setMounted(true); }, []);

  // IMPORTANT: uiPrefs reads from localStorage on the client during initial render.
  // That can differ from the server-rendered default and cause hydration errors.
  // So we use defaults until mounted.
  const showTradingAutomation = UI_FEATURE_FLAGS.trading_automation_enabled
    && (mounted ? uiPrefs.show_trading_automation_sidebar : DEFAULT_UI_PREFERENCES.show_trading_automation_sidebar);

  // Keyboard shortcut: press 'S' to open symbol picker
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (hideSymbolUi) return;
      // Ignore when typing in inputs or with modifiers
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || (e as any).isComposing;
      if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 's') {
        setOpen(true);
        setShowSug(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hideSymbolUi]);

  return (
    <div className="min-h-screen grid grid-cols-[260px_1fr]">
      <aside className="bg-gray-900 border-r border-gray-800 p-4">
        <div className="mb-6">
          <div className="text-xl font-bold">Market Intel</div>
          <div className="text-xs text-gray-400">Logged in: <span className="text-gray-200">{loggedInUser}</span></div>
        </div>
        <nav className="space-y-2">
          <Link className="block px-3 py-2 rounded hover:bg-gray-800" href="/">Dashboard</Link>
          <Link className="block px-3 py-2 rounded hover:bg-gray-800" href="/symbols">Technical Analysis</Link>
          <Link className="block px-3 py-2 rounded hover:bg-gray-800" href="/briefs">Market Briefs</Link>
          <Link className="block px-3 py-2 rounded hover:bg-gray-800" href="/ml">ML & Metrics</Link>
          {showTradingAutomation && (
            <Link className="block px-3 py-2 rounded hover:bg-gray-800" href="/trading-automation">Trading Automation</Link>
          )}
          <Link className="block px-3 py-2 rounded hover:bg-gray-800" href="/settings">Settings</Link>
        </nav>
      </aside>
      <main className="relative">
        {backendBannerArmed && backendDown && (
          <div className="tile-warning flex items-center gap-2">
            <AlertTriangle size={18} />
            <span>Backend is down. Please start the backend and refresh.</span>
          </div>
        )}
        {showWarning && !kiteWarningDismissed && (
          <div className="tile-warning flex items-center gap-2">
            <AlertTriangle size={18} />
            <span>Zerodha access token expired. Please refresh the token.</span>
            <button
              type="button"
              className="ml-auto p-1 rounded hover:bg-gray-800"
              aria-label="Dismiss"
              onClick={() => setKiteWarningDismissed(true)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!hideSymbolUi && (
          <div className="px-6 pt-4 flex items-center gap-2">
            <div className="text-xs text-gray-400">Current Symbol: <span className="text-gray-200 font-mono" suppressHydrationWarning>{mounted ? currentSymbol : ''}</span></div>
            <button onClick={() => { setOpen(true); setShowSug(false); }} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">Change</button>
          </div>
        )}
        {!hideSymbolUi && open && (
          <div className="fixed inset-0 z-30 bg-black/60 flex items-center justify-center" onClick={() => setOpen(false)}>
            <div className="bg-gray-900 border border-gray-800 rounded p-4 w-[520px]" onClick={(e) => e.stopPropagation()}>
              <div className="card-title mb-2">Change Symbol</div>
              <div className="relative">
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
                        setCurrentSymbol(sel.ticker);
                        setQuery(sel.ticker);
                      } else {
                        const v = (query || '').trim();
                        if (v) setCurrentSymbol(v);
                      }
                      setShowSug(false);
                      setOpen(false);
                    } else if (e.key === 'Escape') {
                      setShowSug(false);
                      setOpen(false);
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
                  <div className="absolute z-40 mt-1 w-full max-h-64 overflow-auto bg-gray-900 border border-gray-800 rounded shadow-lg">
                    {suggestions.map((s, idx) => (
                      <button
                        key={s.ticker}
                        onClick={() => { setCurrentSymbol(s.ticker); setQuery(s.ticker); setShowSug(false); setOpen(false); }}
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
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => setOpen(false)} className="px-3 py-2 bg-gray-800 rounded hover:bg-gray-700">Close</button>
              </div>
            </div>
          </div>
        )}
        <div className="p-6 space-y-6">{children}</div>
      </main>
    </div>
  );
}
