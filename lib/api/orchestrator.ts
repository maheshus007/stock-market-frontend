import { safePost } from './client';
import type { MarketBrief } from '@/types/api';

export const orchestratorApi = {
  generateBrief: (payload: { symbol: string }) => safePost<MarketBrief>('/orchestrator/generate-brief', payload),
  runFullPipeline: (payload: { symbol: string; interval?: string; from?: string; to?: string; crawl?: boolean }) => safePost<MarketBrief>('/orchestrator/run-full-pipeline', payload),
  batchRun: (payload: { symbols: string[] }) => safePost<MarketBrief[]>('/orchestrator/batch-run', payload),
};
