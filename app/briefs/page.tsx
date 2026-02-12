"use client";
import { useEffect, useRef, useState } from 'react';
import { orchestratorApi } from '@/lib/api/orchestrator';
import { useMarketBrief } from '@/lib/hooks/useMarketBrief';
import Markdown from '@/components/Markdown';
import { useToast } from '@/components/Toast';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { Copy, Check, Download } from 'lucide-react';
import OrchestratorSummary from '@/components/OrchestratorSummary';
import { symbolsApi } from '@/lib/api/symbols';
import type { SymbolRef } from '@/types/api';

export default function BriefsPage() {
  const [symbol, setSymbol] = useLocalStorage<string>('app:symbol', 'RELIANCE');
  const [query, setQuery] = useLocalStorage<string>('app:query', 'RELIANCE');
  const [suggestions, setSuggestions] = useState<SymbolRef[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const sugTimeout = useRef<number | null>(null);
  const { data: brief, refetch } = useMarketBrief(symbol);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useLocalStorage<boolean>(`briefsExpanded:${symbol}`, false);
  const [copied, setCopied] = useState(false);
  const { show } = useToast();
  function downloadBriefMd() {
    const md = brief?.data?.brief_markdown || '';
    if (!md) return;
    const created = brief?.data?.created_at || new Date().toISOString();
    const stamp = created.replace(/[:T]/g, '-').slice(0, 19);
    const filename = `${symbol}_market_brief_${stamp}.md`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function runPipeline() {
    try {
      setBusy(true);
      await orchestratorApi.runFullPipeline({ symbol, crawl: true });
      await refetch();
      show('Market brief generated', 'success');
    } catch (e: any) {
      show(`Brief failed: ${e?.message || 'Unknown error'}`, 'error', 5000);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (sugTimeout.current) { clearTimeout(sugTimeout.current); sugTimeout.current = null; }
    const q = query.trim();
    if (!q) { setSuggestions([]); return; }
    sugTimeout.current = window.setTimeout(async () => {
      try {
        const res = await symbolsApi.search(q, 10);
        const list = res?.data || [];
        setSuggestions(list);
        setActiveIdx(list.length ? 0 : -1);
      } catch { setSuggestions([]); setActiveIdx(-1); }
    }, 300);
    return () => { if (sugTimeout.current) { clearTimeout(sugTimeout.current); sugTimeout.current = null; } };
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
        <button onClick={runPipeline} disabled={busy} className={`px-3 py-2 bg-brand rounded hover:bg-brand-dark ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy ? 'Generating…' : 'Generate'}</button>
        <button
          onClick={downloadBriefMd}
          disabled={!brief?.data?.brief_markdown}
          className={`px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 flex items-center gap-2 ${!brief?.data?.brief_markdown ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <Download size={16} />
          Download
        </button>
        <button onClick={() => refetch()} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600">Refresh</button>
        <button
          onClick={async () => {
            const md = brief?.data?.brief_markdown || '';
            if (!md) return;
            try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
          }}
          className="px-3 py-2 bg-gray-800 rounded hover:bg-gray-700 flex items-center gap-2"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => setExpanded(v => !v)} className="px-3 py-2 bg-gray-800 rounded hover:bg-gray-700">{expanded ? 'Collapse' : 'Read more'}</button>
      </div>
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="card-title">Latest Brief</div>
          <div className="text-xs text-gray-400">{brief?.data?.created_at ? `Created: ${brief.data.created_at}` : ''}</div>
        </div>
        <OrchestratorSummary metadata={brief?.data?.metadata as any} />
        {brief?.data?.brief_markdown ? (
          <Markdown content={expanded ? brief.data.brief_markdown : (brief.data.brief_markdown.split(/\n\s*\n/)[0] || brief.data.brief_markdown)} className={`prose prose-invert max-w-none text-sm transition-all duration-200`} />
        ) : (
          <div className="text-gray-400 text-sm">No brief yet.</div>
        )}
      </div>
    </div>
  );
}
