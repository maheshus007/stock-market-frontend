"use client";
// Supported ML algorithms for batch operations
const ML_ALGORITHMS = ["xgboost", "random_forest", "lstm", "gru"];
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { mlApi } from '@/lib/api/ml';
import type { MLTrainResponse } from '@/types/api';
import { useMLPrediction } from '@/lib/hooks/useMLPrediction';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LabelList } from 'recharts';
import { useToast } from '@/components/Toast';
import { fmt2, formatISTDateTime } from '@/lib/format';
import TradeSignal from '@/components/TradeSignal';

export default function MLPage() {

  function MetricsTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const datum = payload?.[0]?.payload as { name?: string; valueLabel?: string } | undefined;
    const name = datum?.name ?? '';
    const valueLabel = datum?.valueLabel ?? 'N/A';

    return (
      <div style={{ background: '#111827', border: '1px solid #374151', padding: '8px', borderRadius: 6 }}>
        <div style={{ color: '#9ca3af', fontSize: 12 }}>{name}</div>
        <div style={{ color: '#e5e7eb', fontSize: 12 }}>{valueLabel}</div>
      </div>
    );
  }

    // Batch Train & Predict state and handler
    const [batchBusy, setBatchBusy] = useState(false);
    const [batchMsg, setBatchMsg] = useState<string | null>(null);
    const { show } = useToast();

    async function batchTrainAndPredict() {
      setBatchBusy(true);
      setBatchMsg("Batch training and predicting (all algorithms)…");
      try {
        for (const algo of ML_ALGORITHMS) {
          setBatchMsg(`Training ${algo}…`);
          const trainRes = await mlApi.batchTrain([{ symbol, model_type: algo }]);
          if (trainRes?.error) throw new Error(typeof trainRes.error === 'string' ? trainRes.error : 'Batch train failed');
        }

        for (const algo of ML_ALGORITHMS) {
          setBatchMsg(`Predicting ${algo}…`);
          const predRes = await mlApi.predict({ symbol, model_type: algo, horizon_minutes: 60 });
          if (predRes?.error) throw new Error(typeof predRes.error === 'string' ? predRes.error : 'Batch predict failed');
          if (!predRes?.data?.predictions?.length) throw new Error(`No prediction generated for ${algo}. Seed symbols / load OHLCV first.`);
        }
        setBatchMsg("Batch train & predict complete.");
        show("Batch train & predict complete", "success");
        await predictionQuery.refetch();
        await metricsQuery.refetch();
      } catch (e: any) {
        setBatchMsg(`Batch failed: ${e?.message || "Unknown error"}`);
        show(`Batch failed: ${e?.message || "Unknown error"}`, "error", 5000);
      } finally {
        setTimeout(() => setBatchMsg(null), 4000);
        setBatchBusy(false);
      }
    }
  const [symbol, setSymbol] = useLocalStorage<string>('app:symbol', 'RELIANCE');
  const [modelType, setModelType] = useLocalStorage<string>('app:ml:modelType', 'xgboost');
  const [horizon, setHorizon] = useState<number>(60);
  const [busy, setBusy] = useState<null | 'train' | 'predict'>(null);

  const modelsQuery = useQuery({
    queryKey: ['ml-models'],
    queryFn: () => mlApi.listModels(),
    staleTime: 30_000,
  });

  const metricsQuery = useQuery<{ data: MLTrainResponse | null; error: any }>({
    queryKey: ['ml-metrics', symbol, modelType],
    queryFn: () => mlApi.metrics(symbol, modelType),
    enabled: !!symbol,
  });

  const trainResp = metricsQuery.data?.data || null;
  const metrics = trainResp?.metrics || {};

  const predictionQuery = useMLPrediction(symbol, horizon, modelType, true);
  const pred = predictionQuery.data?.data || null;
  const latest = pred?.predictions?.[0] || null;

  const chartData = [
    { name: 'Accuracy', value: metrics.accuracy ?? null },
    { name: 'F1', value: metrics.f1 ?? null },
    { name: 'ROC-AUC', value: metrics.roc_auc ?? null },
    { name: 'RMSE', value: metrics.rmse ?? null },
  ].map(d => ({
    ...d,
    // Recharts expects numeric values; use 0 for drawing but label as N/A.
    value: d.value == null ? 0 : Number(d.value),
    valueLabel: d.value == null ? 'N/A' : fmt2(Number(d.value)),
  }));

  async function trainModel() {
    try {
      setBusy('train');
      const res = await mlApi.train({ symbol, model_type: modelType, window: 50 });
      if (res?.error) throw new Error(typeof res.error === 'string' ? res.error : 'Training failed');
      await metricsQuery.refetch();
      await modelsQuery.refetch();
      // Users expect Train to immediately reflect in Recent Predictions; generate one prediction.
      const predRes = await mlApi.predict({ symbol, model_type: modelType, horizon_minutes: horizon });
      if (predRes?.error) {
        show(`Training completed, but predict failed: ${typeof predRes.error === 'string' ? predRes.error : 'Unknown error'}`, 'error', 6000);
      } else if (!predRes?.data?.predictions?.length) {
        show('Training completed, but no prediction generated (need OHLCV history).', 'error', 6000);
      } else {
        await predictionQuery.refetch();
        show('Training completed + prediction updated', 'success');
      }
    } catch (e: any) {
      show(`Training failed: ${e?.message || 'Unknown error'}`, 'error', 5000);
    } finally {
      setBusy(null);
    }
  }


  async function runPredict() {
    try {
      setBusy('predict');
      const res = await mlApi.predict({ symbol, model_type: modelType, horizon_minutes: horizon });
      if (res?.error) throw new Error(typeof res.error === 'string' ? res.error : 'Prediction failed');
      if (!res?.data?.predictions?.length) throw new Error('No new prediction generated. Seed symbols and load at least 50 OHLCV rows.');
      await predictionQuery.refetch();
      show('Prediction updated', 'success');
    } catch (e: any) {
      show(`Prediction failed: ${e?.message || 'Unknown error'}`, 'error', 5000);
    } finally {
      setBusy(null);
    }
  }

  async function refreshMetrics() {
    try {
      await metricsQuery.refetch();
      show('Metrics refreshed', 'success');
    } catch (e: any) {
      show(`Refresh failed: ${e?.message || 'Unknown error'}`, 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* --- Batch Train & Predict Button: Always visible above ML metrics --- */}
      <div className="w-full flex items-center gap-4 mb-4">
        <button
          onClick={batchTrainAndPredict}
          disabled={batchBusy || !symbol}
          className={`px-3 py-2 bg-blue-700 rounded hover:bg-blue-800 text-white text-sm ${batchBusy ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          {batchBusy ? 'Batch Training…' : 'Batch Train & Predict (All Algorithms)'}
        </button>
        {batchMsg && <span className="text-xs text-gray-400">{batchMsg}</span>}
      </div>
        <TradeSignal symbol={symbol} />
      <div className="flex items-center gap-3">
        <select
          className="bg-gray-900 border border-gray-800 rounded px-2 py-2 text-sm"
          value={modelType}
          onChange={(e) => setModelType(e.target.value)}
        >
          <option value="xgboost">XGBoost</option>
          <option value="random_forest">Random Forest</option>
          <option value="lstm">LSTM</option>
          <option value="gru">GRU</option>
        </select>
        <select
          className="bg-gray-900 border border-gray-800 rounded px-2 py-2 text-sm"
          value={horizon}
          onChange={(e) => setHorizon(Number(e.target.value))}
        >
          <option value={15}>15m</option>
          <option value={30}>30m</option>
          <option value={60}>60m</option>
          <option value={120}>120m</option>
        </select>
        <button onClick={trainModel} disabled={!!busy} className={`px-3 py-2 bg-brand rounded hover:bg-brand-dark ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy === 'train' ? 'Training…' : 'Train'}</button>
        <button onClick={runPredict} disabled={!!busy} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 ${busy ? 'opacity-60 cursor-not-allowed' : ''}`}>{busy === 'predict' ? 'Predicting…' : 'Predict'}</button>
        <button onClick={refreshMetrics} className={`px-3 py-2 bg-gray-700 rounded hover:bg-gray-600`}>
          Refresh Metrics
        </button>
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Prediction</div>
        {latest ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-400">Direction</div>
              <div className="text-white font-medium">{(latest.direction_prob_up ?? 0) >= 0.5 ? 'up' : 'down'}</div>
            </div>
            <div>
              <div className="text-gray-400">Volatility</div>
              <div className="text-white font-medium">{fmt2(latest.volatility)}</div>
            </div>
            <div>
              <div className="text-gray-400">Prob Up</div>
              <div className="text-white font-medium">{fmt2(latest?.direction_prob_up ?? 0)}</div>
            </div>
            <div>
              <div className="text-gray-400">Prob Down</div>
              <div className="text-white font-medium">{fmt2(latest?.direction_prob_down ?? 0)}</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No prediction yet.</div>
        )}
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Model Metrics</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fill: '#9ca3af' }} />
              <YAxis tick={{ fill: '#9ca3af' }} tickFormatter={(v: any) => fmt2(Number(v))} />
              <Tooltip content={<MetricsTooltip />} />
              <Bar dataKey="value" fill="#1f6feb">
                <LabelList dataKey="valueLabel" position="top" fill="#e5e7eb" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Recent Predictions</div>
        {pred?.predictions?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="text-left py-2 pr-4">Time</th>
                  <th className="text-left py-2 pr-4">Stock</th>
                  <th className="text-right py-2 pr-4">Prob Up</th>
                  <th className="text-right py-2 pr-4">Prob Down</th>
                  <th className="text-right py-2 pr-4">Volatility</th>
                  <th className="text-right py-2 pr-4">Anomaly</th>
                  <th className="text-left py-2">Model</th>
                </tr>
              </thead>
              <tbody>
                {pred.predictions.slice(0, 5).map((p, idx) => (
                  <tr key={`${p.timestamp}-${p.model_name ?? 'model'}-${idx}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 text-gray-200">{formatISTDateTime(p.timestamp)}</td>
                    <td className="py-2 pr-4 text-gray-200">
                      {symbol}{pred?.symbol_name ? ` • ${pred.symbol_name}` : ''}
                    </td>
                    <td className="py-2 pr-4 text-right">{fmt2(p.direction_prob_up ?? 0)}</td>
                    <td className="py-2 pr-4 text-right">{fmt2((p as any).direction_prob_down ?? (1 - (p.direction_prob_up ?? 0)))}</td>
                    <td className="py-2 pr-4 text-right">{fmt2(p.volatility ?? 0)}</td>
                    <td className="py-2 pr-4 text-right">{fmt2(p.anomaly_score ?? 0)}</td>
                    <td className="py-2 text-gray-300">{p.model_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No recent predictions.</div>
        )}
      </div>

      <div className="card p-4">
        <div className="card-title mb-2">Saved Models</div>
        {modelsQuery.isLoading ? (
          <div className="text-gray-400 text-sm">Loading models…</div>
        ) : (modelsQuery.data?.data?.models?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="text-left py-2 pr-4">Symbol</th>
                  <th className="text-left py-2 pr-4">Model</th>
                  <th className="text-right py-2 pr-4">Size</th>
                  <th className="text-left py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {modelsQuery.data.data.models.map((m: any, idx: number) => (
                  <tr key={idx} className="border-t border-gray-800">
                    <td className="py-2 pr-4 text-gray-200">{m.symbol}</td>
                    <td className="py-2 pr-4 text-gray-300">{m.model}</td>
                    <td className="py-2 pr-4 text-right text-gray-300">{fmt2((m.size || 0) / 1024)} KB</td>
                    <td className="py-2">
                      <button
                        className="px-2 py-1 bg-gray-700 rounded hover:bg-gray-600"
                        onClick={async () => { setSymbol(m.symbol); setModelType(m.model); await predictionQuery.refetch(); }}
                      >
                        Select
                      </button>
                      <button
                        className="ml-2 px-2 py-1 bg-red-700 rounded hover:bg-red-600"
                        onClick={async () => {
                          const ok = window.confirm(`Delete model ${m.model} for ${m.symbol}?`);
                          if (!ok) return;
                          try {
                            await mlApi.deleteModel({ symbol: m.symbol, model: m.model });
                            await modelsQuery.refetch();
                            show('Model deleted', 'success');
                          } catch (e: any) {
                            show(`Delete failed: ${e?.message || 'Unknown error'}`, 'error');
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-gray-400 text-sm">No saved models found.</div>
        ))}
      </div>
    </div>
  );
}
