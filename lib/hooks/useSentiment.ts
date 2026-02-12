import { useQuery } from '@tanstack/react-query';
import { sentimentApi } from '@/lib/api/sentiment';
import type { SentimentAnalyzeResponse } from '@/types/api';

export function useSentiment(
  symbol: string,
  opts?: { enabled?: boolean; refetchInterval?: number; refetchOnWindowFocus?: boolean }
) {
  return useQuery<{ data: SentimentAnalyzeResponse | null; error: any }>({
    queryKey: ['sentiment', symbol],
    queryFn: () => sentimentApi.analyzeSymbol(symbol),
    enabled: opts?.enabled ?? !!symbol,
    refetchInterval: opts?.refetchInterval,
    refetchOnWindowFocus: opts?.refetchOnWindowFocus ?? false,
  });
}
