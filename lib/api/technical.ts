import { safePost } from './client';
import type { TechnicalAnalysisResponse } from '@/types/api';

export const technicalApi = {
  analyze: (payload: { symbol: string; window?: number }) => safePost<TechnicalAnalysisResponse>('/technical/analyze', payload),
  batchAnalyze: (payload: { symbols: string[]; window?: number }) => safePost<TechnicalAnalysisResponse[]>('/technical/batch-analyze', payload),
};
