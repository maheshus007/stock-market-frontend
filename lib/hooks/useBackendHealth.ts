import { useQuery } from '@tanstack/react-query';
import { healthApi } from '@/lib/api/health';
import type { BackendHealthResponse } from '@/types/api';

export function useBackendHealth() {
  return useQuery<{ data: BackendHealthResponse | null; error: any }>({
    queryKey: ['backend-health'],
    queryFn: () => healthApi.backendHealth(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
}
