export type KiteHealthResponse = {
  ok: boolean;
  status_code?: number;
  error?: string;
};

export type BackendHealthResponse = {
  status: string;
  environment?: string;
};

export type OHLCVBar = {
  timestamp: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type OHLCVResponse = OHLCVBar[];

export type TechnicalSnapshot = {
  timestamp: string;
  price?: number | null;
  rsi?: number | null;
  macd?: number | null;
  macd_signal?: number | null;
  adx?: number | null;
  supertrend?: number | null;
  vwap?: number | null;
  sma_20?: number | null;
  sma_50?: number | null;
  sma_200?: number | null;
  ema_9?: number | null;
  ema_21?: number | null;
  support?: number | null;
  resistance?: number | null;
  volume_sma_20?: number | null;
  volume_ratio?: number | null;
  obv?: number | null;
  price_action?: string | null;
  chart_pattern?: string | null;
  pattern?: string | null;
};

export type TechnicalAnalysisResponse = {
  symbol: string;
  snapshots: TechnicalSnapshot[];
};

export type MLPredictionPoint = {
  timestamp: string;
  direction_prob_up?: number;
  direction_prob_down?: number;
  volatility?: number;
  anomaly_score?: number;
  model_name?: string;
};

export type MLPrediction = {
  symbol: string;
  symbol_name?: string | null;
  predictions: MLPredictionPoint[];
  metadata?: { error?: string };
};

export type MLTrainMetrics = {
  accuracy?: number | null;
  f1?: number | null;
  roc_auc?: number | null;
  rmse?: number | null;
};

export type MLTrainResponse = {
  symbol: string;
  model_type: string;
  metrics: MLTrainMetrics;
};

export type SentimentResult = {
  label: 'positive' | 'negative' | 'neutral';
  score: number;
  entities?: string[];
  metadata?: { error?: string };
};

export type SentimentAnalyzeResponse = {
  symbol?: string | null;
  result: SentimentResult | null;
};

export type RiskSnapshot = {
  timestamp: string;
  risk_score: number;
  volatility_regime: string;
  sector_risk?: string | null;
  downside_alert: boolean;
};

export type RiskEvaluateResponse = {
  symbol: string;
  snapshot: RiskSnapshot;
};

export type MarketBrief = {
  symbol: string;
  created_at: string | null;
  brief_markdown: string;
  metadata?: Record<string, any>;
};

export type SymbolRef = {
  ticker: string;
  name: string;
  sector?: string | null;
};
