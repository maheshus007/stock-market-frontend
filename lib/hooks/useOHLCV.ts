import { useQuery } from '@tanstack/react-query';
import { marketDataApi } from '@/lib/api/marketData';
import type { OHLCVResponse } from '@/types/api';

export function useOHLCV(symbol: string, limit = 200, from?: string, to?: string, agg?: 'weekly' | 'monthly', fromTime?: string, toTime?: string, excludeNonTrading = true, excludeHolidays = true) {
  return useQuery<{ data: OHLCVResponse | null; error: any }>({
    queryKey: ['ohlcv', symbol, limit, from, to, agg, fromTime, toTime, excludeNonTrading, excludeHolidays],
    queryFn: () => marketDataApi.ohlcv(symbol, limit, from, to, agg, fromTime, toTime, excludeNonTrading, excludeHolidays),
    enabled: !!symbol,
  });
}
