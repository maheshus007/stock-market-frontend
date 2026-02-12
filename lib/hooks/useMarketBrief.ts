import { useQuery } from '@tanstack/react-query';
import { orchestratorApi } from '@/lib/api/orchestrator';
import type { MarketBrief } from '@/types/api';

export function useMarketBrief(symbol: string, enabled: boolean = true) {
  return useQuery<{ data: MarketBrief | null; error: any }>({
    queryKey: ['brief', symbol],
    queryFn: () => orchestratorApi.generateBrief({ symbol }),
    enabled: !!symbol && enabled,
  });
}
