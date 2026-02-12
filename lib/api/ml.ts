import { safeGet, safePost } from './client';
import type { MLTrainResponse, MLPrediction } from '@/types/api';

export const mlApi = {
  train: (payload: { symbol: string; model_type?: string; window?: number }) => safePost<any>('/ml/train', payload),
  predict: (payload: { symbol: string; model_type?: string; horizon_minutes?: number }) => safePost<MLPrediction>('/ml/predict', payload),
  recentPredictions: (params: { symbol: string; model_type?: string; horizon_minutes?: number; limit?: number }) => {
    const q = new URLSearchParams();
    q.set('symbol', params.symbol);
    if (params.model_type) q.set('model_type', params.model_type);
    if (params.horizon_minutes !== undefined) q.set('horizon_minutes', String(params.horizon_minutes));
    if (params.limit !== undefined) q.set('limit', String(params.limit));
    return safeGet<MLPrediction>(`/ml/recent-predictions?${q.toString()}`);
  },
  metrics: (symbol: string, model_type?: string) => safeGet<MLTrainResponse>(`/ml/metrics?symbol=${encodeURIComponent(symbol)}${model_type ? `&model_type=${encodeURIComponent(model_type)}` : ''}`),
  batchTrain: (payload: Array<{ symbol: string; model_type?: string; window?: number; horizon_minutes?: number }>) => safePost<any>('/ml/batch-train', payload),
  batchPredict: (payload: Array<{ symbol: string; model_type?: string; horizon_minutes?: number }>) => safePost<any>('/ml/batch-predict', payload),
  listModels: () => safeGet<{ models: Array<{ file: string; symbol: string; model: string; size: number; modified: number }> }>(`/ml/list-models`),
  deleteModel: (payload: { symbol: string; model: string }) => safePost<{ deleted: string[] }>(`/ml/delete-model`, payload),
};
