import React from 'react';
import { fmt2 } from '@/lib/format';

type Props = {
  metadata?: Record<string, any> | null;
  className?: string;
};

export default function OrchestratorSummary({ metadata, className }: Props) {
  const md = metadata || {};
  const ohlcv = md.latest_ohlcv_points as number | undefined;
  const tech = md.technical_points as number | undefined;
  const ml = md.ml_predictions as number | undefined;
  const risk = (md.risk_score as number | undefined) ?? null;
  const sentiment = (md.sentiment as string | undefined)?.toLowerCase() as 'positive' | 'negative' | 'neutral' | undefined;
  const interval = md.interval as string | undefined;
  const from = md.from as string | undefined;
  const to = md.to as string | undefined;

  const tradeAction = (md.trade_action as string | undefined)?.toUpperCase() as 'BUY' | 'SELL' | 'HOLD' | undefined;
  const tradeConfidence = md.trade_confidence as number | undefined;
  const tradeSL = md.trade_stop_loss as number | undefined;
  const tradeTP = md.trade_take_profit as number | undefined;
  const tradeHigh = md.trade_predicted_high as number | undefined;
  const runtimeMs = ((): number | undefined => {
    const ms = md.runtime_ms ?? md.duration_ms;
    if (typeof ms === 'number') return ms;
    const secs = md.duration_seconds;
    if (typeof secs === 'number') return secs * 1000;
    return undefined;
  })();

  const sentimentStyle = sentiment === 'positive'
    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-700/40'
    : sentiment === 'negative'
      ? 'bg-rose-500/10 text-rose-300 border-rose-700/40'
      : 'bg-slate-500/10 text-slate-300 border-slate-700/40';

  const riskStyle = risk == null
    ? 'bg-slate-500/10 text-slate-300 border-slate-700/40'
    : risk > 0.75
      ? 'bg-rose-500/10 text-rose-300 border-rose-700/40'
      : risk > 0.5
        ? 'bg-amber-500/10 text-amber-300 border-amber-700/40'
        : 'bg-emerald-500/10 text-emerald-300 border-emerald-700/40';

  const chip = (label: string, value: React.ReactNode, styles: string) => (
    <div className={`border rounded px-2 py-1 text-xs flex items-center gap-2 ${styles}`}>
      <span className="opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );

  const actionStyle = tradeAction === 'BUY'
    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-700/40'
    : tradeAction === 'SELL'
      ? 'bg-rose-500/10 text-rose-300 border-rose-700/40'
      : 'bg-slate-500/10 text-slate-300 border-slate-700/40';

  return (
    <div className={`mt-2 ${className || ''}`}>
      <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Orchestrator Summary</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {chip('OHLCV', ohlcv ?? '—', 'bg-blue-500/10 text-blue-300 border-blue-700/40')}
        {chip('Technicals', tech ?? '—', 'bg-cyan-500/10 text-cyan-300 border-cyan-700/40')}
        {chip('ML Preds', ml ?? '—', 'bg-indigo-500/10 text-indigo-300 border-indigo-700/40')}
        {chip('Risk', risk != null ? fmt2(risk) : '—', riskStyle)}
        {chip('Sentiment', sentiment ? sentiment.toUpperCase() : '—', sentimentStyle)}
        {chip('Action', tradeAction ? (tradeConfidence != null ? `${tradeAction} (${fmt2(tradeConfidence)})` : tradeAction) : '—', actionStyle)}
        {chip('Stop Loss', tradeSL != null ? fmt2(tradeSL) : '—', 'bg-slate-500/10 text-slate-300 border-slate-700/40')}
        {chip('Take Profit', tradeTP != null ? fmt2(tradeTP) : '—', 'bg-slate-500/10 text-slate-300 border-slate-700/40')}
        {chip('Pred High', tradeHigh != null ? fmt2(tradeHigh) : '—', 'bg-slate-500/10 text-slate-300 border-slate-700/40')}
        {chip('Window', interval ? interval : (from && to ? 'custom' : '—'), 'bg-slate-500/10 text-slate-300 border-slate-700/40')}
        {chip('Runtime', runtimeMs != null ? (runtimeMs >= 1000 ? `${(runtimeMs / 1000).toFixed(1)}s` : `${Math.max(1, Math.round(runtimeMs))}ms`) : '—', 'bg-violet-500/10 text-violet-300 border-violet-700/40')}
      </div>
      {(from || to) && (
        <div className="text-[10px] text-gray-500 mt-1">{from ? `From ${from}` : ''}{from && to ? ' • ' : ''}{to ? `To ${to}` : ''}</div>
      )}
    </div>
  );
}
