import { safeGet } from './client';
import type { BackendHealthResponse } from '@/types/api';

export const healthApi = {
  backendHealth: () => safeGet<BackendHealthResponse>('/health'),
};
