import { safeGet, safePost } from './client';
import type { SentimentAnalyzeResponse, SentimentResult } from '@/types/api';

export const sentimentApi = {
  analyzeText: (payload: { text: string }) => safePost<SentimentResult>('/sentiment/analyze-text', payload),
  analyzeSymbol: (symbol: string) => safeGet<SentimentAnalyzeResponse>(`/sentiment/analyze-symbol?symbol=${encodeURIComponent(symbol)}`),
  batchAnalyzeText: (payload: { items: { text: string }[] }) => safePost<any>('/sentiment/batch-analyze-text', payload),
  crawlNow: () => safePost<any>('/sentiment/crawl-now'),
  listArticles: (limit = 50) => safeGet<any>(`/sentiment/articles?limit=${limit}`),
  backfill: (limit = 200) => safePost<any>(`/sentiment/articles/backfill-sentiment?limit=${limit}`),
  crawlAndOrchestrate: () => safePost<any>('/sentiment/crawl-and-orchestrate'),
  schedulerStatus: () => safeGet<any>('/sentiment/scheduler-status'),
};
