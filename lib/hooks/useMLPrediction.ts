import { useQuery } from '@tanstack/react-query';
import { mlApi } from '@/lib/api/ml';
import type { MLPrediction } from '@/types/api';

export function useMLPrediction(
  symbol: string,
  horizonMinutes: number = 60,
  modelType?: string,
  readOnlyRecent: boolean = false,
) {
  return useQuery<{ data: MLPrediction | null; error: any }>({
    queryKey: ['ml-predict', readOnlyRecent ? 'recent' : 'predict', symbol, horizonMinutes, modelType || ''],
    queryFn: () =>
      readOnlyRecent
        ? mlApi.recentPredictions({ symbol, horizon_minutes: horizonMinutes, model_type: modelType, limit: 10 })
        : mlApi.predict({ symbol, horizon_minutes: horizonMinutes, model_type: modelType }),
    enabled: !!symbol,
  });
}
