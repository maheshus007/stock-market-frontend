import { useQuery } from '@tanstack/react-query';
import { technicalApi } from '@/lib/api/technical';
import type { TechnicalAnalysisResponse } from '@/types/api';

export function useTechnicalAnalysis(symbol: string, window = 50) {
  return useQuery<{ data: TechnicalAnalysisResponse | null; error: any }>({
    queryKey: ['technical', symbol, window],
    queryFn: () => technicalApi.analyze({ symbol, window }),
    enabled: !!symbol,
  });
}
