import { safePost } from './client';
import type { RiskEvaluateResponse } from '@/types/api';

export const riskApi = {
  evaluate: (payload: { symbol: string }) => safePost<RiskEvaluateResponse>('/risk/evaluate', payload),
  portfolioEvaluate: (payload: { symbols: string[] }) => safePost<any>('/risk/portfolio-evaluate', payload),
};
