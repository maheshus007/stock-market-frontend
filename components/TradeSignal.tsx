"use client";
import { useSentiment } from '@/lib/hooks/useSentiment';
import { useRisk } from '@/lib/hooks/useRisk';
import { useMLPrediction } from '@/lib/hooks/useMLPrediction';
import { useTechnicalAnalysis } from '@/lib/hooks/useTechnicalAnalysis';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { fmt2 } from '@/lib/format';
import { useEffect } from 'react';
import { getTradeSignalSettings, updateTradeSignalSettings } from '@/lib/api/settings';

type Props = { symbol: string };

export default function TradeSignal({ symbol }: Props) {
  const sentimentQ = useSentiment(symbol, { refetchInterval: 180000, refetchOnWindowFocus: false });
  const riskQ = useRisk(symbol, { refetchInterval: 180000, refetchOnWindowFocus: false });
  const mlQ = useMLPrediction(symbol, 60);
  const techQ = useTechnicalAnalysis(symbol, 50);

  const [expanded, setExpanded] = useLocalStorage<boolean>(`tradeSignalExpanded:${symbol}`, false);
  const [buyThreshold, setBuyThreshold] = useLocalStorage<number>('ts:buyThreshold', 0.60);
  const [sellThreshold, setSellThreshold] = useLocalStorage<number>('ts:sellThreshold', 0.40);
  const [riskCap, setRiskCap] = useLocalStorage<number>('ts:riskCap', 0.60);
  const [mlUpBuyMin, setMlUpBuyMin] = useLocalStorage<number>('ts:mlUpBuyMin', 0.60);
  const [sentPosMin, setSentPosMin] = useLocalStorage<number>('ts:sentPosMin', 0.55);
  const [wMl, setWMl] = useLocalStorage<number>('ts:wMl', 0.4);
  const [wSent, setWSent] = useLocalStorage<number>('ts:wSent', 0.2);
  const [wTech, setWTech] = useLocalStorage<number>('ts:wTech', 0.3);
  const [wRisk, setWRisk] = useLocalStorage<number>('ts:wRisk', 0.1);
  const [saveMsg, setSaveMsg] = useLocalStorage<string>('ts:saveMsg', '');
  const [showRules, setShowRules] = useLocalStorage<boolean>('ts:showRules', false);

  // Load backend settings once
  useEffect(() => {
    (async () => {
      try {
        const s = await getTradeSignalSettings();
        setWMl(s.ml_weight); setWSent(s.sentiment_weight); setWTech(s.technical_weight); setWRisk(s.risk_weight);
        setBuyThreshold(s.buy_threshold); setSellThreshold(s.sell_threshold); setMlUpBuyMin(s.min_up_prob); setRiskCap(s.risk_cap);
      } catch {/* ignore */}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sr = sentimentQ.data?.data?.result || null;
  const rr = riskQ.data?.data?.snapshot || null;
  const predictions = mlQ.data?.data?.predictions || [];
  const lastPred = predictions.length ? predictions[predictions.length - 1] : null;
  const techSnaps = techQ.data?.data?.snapshots || [];
  const lastTech = techSnaps.length ? techSnaps[techSnaps.length - 1] : null;
  const recentTech = techSnaps.slice(-25);
  const lastPatternSnap = [...recentTech].reverse().find((s: any) => s?.chart_pattern) || null;
  const lastPriceActionSnap = [...recentTech].reverse().find((s: any) => s?.price_action) || null;

  const mlUp = Number((lastPred as any)?.direction_prob_up ?? 0);
  const risk = Number(rr?.risk_score ?? 0);
  const sentLabel = (sr?.label || 'neutral').toLowerCase();
  const sentScore = Number(sr?.score ?? 0);
  const rsi = Number(lastTech?.rsi ?? 50);
  const macd = Number(lastTech?.macd ?? 0);
  const macdSignal = Number(lastTech?.macd_signal ?? 0);

  const price = Number((lastTech as any)?.price ?? 0);
  const support = Number((lastTech as any)?.support ?? 0);
  const resistance = Number((lastTech as any)?.resistance ?? 0);
  const volumeRatio = Number((lastTech as any)?.volume_ratio ?? 0);
  const priceAction = String(((lastTech as any)?.price_action ?? (lastPriceActionSnap as any)?.price_action ?? '')).toLowerCase();
  const chartPattern = String(((lastTech as any)?.chart_pattern ?? (lastPatternSnap as any)?.chart_pattern ?? '')).toLowerCase();

  const techBull = (rsi >= 55) || (macd > macdSignal);
  const techBear = (rsi <= 45) || (macd < macdSignal);

  // Start with a base technical score and adjust it using support/resistance, volume and patterns.
  let techScore = techBull ? 1 : techBear ? 0 : 0.5;

  const hasLevels = price > 0 && support > 0 && resistance > 0;
  const nearSupport = hasLevels ? (price <= support * 1.01) : false;
  const nearResistance = hasLevels ? (price >= resistance * 0.99) : false;

  const bullishPA = priceAction === 'bullish_engulfing' || priceAction === 'hammer';
  const bearishPA = priceAction === 'bearish_engulfing';

  if (chartPattern === 'breakout_up') techScore += 0.15;
  if (chartPattern === 'breakdown_down') techScore -= 0.15;

  if (nearSupport && bullishPA) techScore += 0.10;
  if (nearResistance && bearishPA) techScore -= 0.10;

  // Volume confirms moves; only a small nudge.
  if (volumeRatio >= 1.5 && (bullishPA || chartPattern === 'breakout_up')) techScore += 0.05;
  if (volumeRatio >= 1.5 && (bearishPA || chartPattern === 'breakdown_down')) techScore -= 0.05;

  techScore = Math.max(0, Math.min(1, techScore));

  const sentScoreNorm = sentLabel === 'positive' ? Math.min(1, Math.max(0, sentScore))
    : sentLabel === 'negative' ? 0
    : 0.5;

  const riskAdj = Math.max(0, 1 - risk); // lower risk is better

  // Weighted aggregate (configurable)
  const aggregate = (mlUp * wMl) + (sentScoreNorm * wSent) + (techScore * wTech) + (riskAdj * wRisk);

  let decision: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  // Hard risk cap: if risk above cap, avoid BUY
  const riskTooHigh = risk > riskCap;
  if (!riskTooHigh && mlUp >= mlUpBuyMin && sentScoreNorm >= sentPosMin && aggregate >= buyThreshold) {
    decision = 'BUY';
  } else if (aggregate <= sellThreshold || (sentLabel === 'negative' && techBear)) {
    decision = 'SELL';
  }
  const confidence = Math.round(aggregate * 100);

  const colorCls = decision === 'BUY' ? 'text-green-300 bg-green-900/40 border border-green-700/40'
    : decision === 'SELL' ? 'text-red-300 bg-red-900/40 border border-red-700/40'
    : 'text-yellow-300 bg-yellow-900/40 border border-yellow-700/40';

  const rules = [
    'BUY requires: risk <= cap, ML up >= min, positive sentiment, aggregate >= buy threshold.',
    'SELL if aggregate <= sell threshold or sentiment is negative with bearish technicals.',
    'Confidence is the weighted aggregate across ML, sentiment, technicals, and risk.',
  ];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="card-title">Trade Signal</div>
        <div className="flex items-center gap-2">
          <button title={rules.join(' ')} onClick={() => setShowRules(v => !v)} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">{showRules ? 'Hide Rules' : 'Rules'}</button>
          <button onClick={() => setExpanded(v => !v)} className="px-2 py-1 text-xs bg-gray-800 rounded hover:bg-gray-700">{expanded ? 'Hide' : 'Configure'}</button>
        </div>
      </div>
      <div className={`mt-2 inline-flex items-center gap-3 px-3 py-2 rounded ${colorCls}`}>
        <div className="text-lg font-bold">{decision}</div>
        <div className="text-sm">Confidence: {confidence}%</div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <Metric label="ML Up" value={fmt2(mlUp)} />
        <Metric label="Risk" value={fmt2(risk)} />
        <Metric label="Sentiment" value={sr ? sr.label.toUpperCase() : '—'} />
        <Metric label="RSI" value={fmt2(rsi)} />
      </div>

      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <Metric label="Support" value={support > 0 ? fmt2(support) : '—'} />
        <Metric label="Resistance" value={resistance > 0 ? fmt2(resistance) : '—'} />
        <Metric label="Vol Ratio" value={volumeRatio > 0 ? fmt2(volumeRatio) : '—'} />
        <Metric label="Pattern" value={chartPattern ? chartPattern.toUpperCase() : (priceAction ? priceAction.toUpperCase() : '—')} />
      </div>

      {showRules && (
        <div className="mt-3 text-xs text-gray-300 bg-gray-900/40 border border-gray-800 rounded p-3">
          <div className="font-semibold mb-1">Decision Rules</div>
          {rules.map((r, i) => (<div key={i}>• {r}</div>))}
        </div>
      )}

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-gray-400">Thresholds</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Slider label="Buy threshold" value={buyThreshold} setValue={setBuyThreshold} min={0.5} max={0.9} step={0.01} />
            <Slider label="Sell threshold" value={sellThreshold} setValue={setSellThreshold} min={0.1} max={0.6} step={0.01} />
            <Slider label="Risk cap" value={riskCap} setValue={setRiskCap} min={0.3} max={0.9} step={0.01} />
            <Slider label="ML up min" value={mlUpBuyMin} setValue={setMlUpBuyMin} min={0.5} max={0.9} step={0.01} />
            <Slider label="Sent positive min" value={sentPosMin} setValue={setSentPosMin} min={0.5} max={0.9} step={0.01} />
          </div>
          <div className="text-xs text-gray-400">Weights</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Slider label="ML weight" value={wMl} setValue={setWMl} min={0} max={1} step={0.01} />
            <Slider label="Sentiment weight" value={wSent} setValue={setWSent} min={0} max={1} step={0.01} />
            <Slider label="Technical weight" value={wTech} setValue={setWTech} min={0} max={1} step={0.01} />
            <Slider label="Risk weight" value={wRisk} setValue={setWRisk} min={0} max={1} step={0.01} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm"
              onClick={async () => {
                try {
                  await updateTradeSignalSettings({
                    ml_weight: wMl,
                    sentiment_weight: wSent,
                    technical_weight: wTech,
                    risk_weight: wRisk,
                    buy_threshold: buyThreshold,
                    sell_threshold: sellThreshold,
                    min_up_prob: mlUpBuyMin,
                    risk_cap: riskCap,
                  });
                  setSaveMsg('Saved');
                } catch (e: any) {
                  setSaveMsg(`Failed: ${e?.message || 'Unknown'}`);
                }
              }}
            >Save</button>
            {saveMsg && <div className="text-xs text-gray-400">{saveMsg}</div>}
          </div>
          <div className="text-xs text-gray-500">Note: This is informational only, not financial advice.</div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/40 rounded px-2 py-2">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Slider({ label, value, setValue, min, max, step }: { label: string; value: number; setValue: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}: {fmt2(value)}</div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => setValue(Number(e.target.value))} className="w-full" />
    </div>
  );
}
