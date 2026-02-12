import { useQuery } from '@tanstack/react-query';
import { marketDataApi } from '@/lib/api/marketData';
import type { KiteHealthResponse } from '@/types/api';

export function useKiteHealth() {
  return useQuery<{ data: KiteHealthResponse | null; error: any }>({
    queryKey: ['kite-health'],
    queryFn: () => marketDataApi.kiteHealth(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}
