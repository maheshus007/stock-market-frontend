import { useQuery } from '@tanstack/react-query';
import { riskApi } from '@/lib/api/risk';
import type { RiskEvaluateResponse } from '@/types/api';

export function useRisk(
  symbol: string,
  opts?: { enabled?: boolean; refetchInterval?: number; refetchOnWindowFocus?: boolean }
) {
  return useQuery<{ data: RiskEvaluateResponse | null; error: any }>({
    queryKey: ['risk', symbol],
    queryFn: () => riskApi.evaluate({ symbol }),
    enabled: opts?.enabled ?? !!symbol,
    refetchInterval: opts?.refetchInterval,
    refetchOnWindowFocus: opts?.refetchOnWindowFocus ?? false,
  });
}
