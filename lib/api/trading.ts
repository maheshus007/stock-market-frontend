import { safeGet, safePost, safePut } from './client';

export type TradeLogRecord = {
  id: number;
  created_at: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence?: number | null;
  reasons?: string[];
  allowed?: boolean | null;
  order_id?: string | null;
  order_status?: string | null;
  error?: string | null;
  risk_score?: number | null;
  volatility_regime?: string | null;
  ml_up_prob?: number | null;
  sentiment_label?: string | null;
  rsi?: number | null;
  supertrend?: number | null;
  pnl?: number | null;
  metadata?: Record<string, any> | null;
};

export type TradeLogListResponse = {
  items: TradeLogRecord[];
};

export type PaperTradingSummary = {
  mode: 'paper';
  starting_cash: number;
  cash: number;
  open_positions: number;
  realized_pnl: number;
  unrealized_pnl: number | null;
  total_pnl: number | null;
  equity: number | null;
};

export type PaperTradingAccount = {
  starting_cash: number;
  cash: number;
  updated_at?: string | null;
};

export type PaperPosition = {
  symbol: string;
  quantity: number;
  entry_price: number;
  opened_at: string;
  last_price: number | null;
  unrealized_pnl: number | null;
};

export type PaperAutoRunItem = {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasons: string[];
  selected: boolean;
  allowed?: boolean | null;
  executed: boolean;
  execution_status?: string | null;
  error?: string | null;

  last_price?: number | null;
  quantity?: number | null;
  required_cash_estimate?: number | null;
  available_cash_at_check?: number | null;
};

export type PaperAutoRunResponse = {
  considered: number;
  selected: number;
  executed: number;
  items: PaperAutoRunItem[];
};

export type LiveBalanceResponse = {
  segment: 'equity' | string;
  available_margin: number | null;
  available_cash: number | null;
  net: number | null;
  utilised_debits: number | null;
  updated_at: string;
};

export type LiveRecommendedMaxSymbolsResponse = {
  available_margin: number | null;
  quantity: number;
  buffer_pct: number;
  recommended_max_symbols: number;
  considered: number;
  missing_price: number;
};

export type LiveAutoLoopStatusResponse = {
  running: boolean;
  started_at?: string | null;
  last_run_at?: string | null;
  last_error?: string | null;
  iterations: number;
  last_summary?: Record<string, any> | null;

  last_items?: Array<Record<string, any>> | null;
  interval_seconds?: number | null;
  auto_max_symbols?: boolean | null;
  max_symbols?: number | null;
  allow_sell?: boolean | null;
};

export type LivePosition = {
  symbol: string;
  product?: string | null;
  exchange?: string | null;
  quantity: number;
  average_price?: number | null;
  last_price?: number | null;
  pnl?: number | null;
  realised?: number | null;
  unrealised?: number | null;
};

export type LiveTradingSummaryResponse = {
  updated_at: string;
  balance: LiveBalanceResponse;
  open_positions: number;
  realised_pnl: number | null;
  unrealised_pnl: number | null;
  total_pnl: number | null;
  positions: LivePosition[];
};

export type LiveOrder = {
  order_id?: string | null;
  symbol: string;
  side?: string | null;
  status?: string | null;
  product?: string | null;
  variety?: string | null;
  exchange?: string | null;
  quantity?: number | null;
  filled_quantity?: number | null;
  average_price?: number | null;
  price?: number | null;
  order_timestamp?: string | null;
  exchange_timestamp?: string | null;
};

export type LiveOrdersResponse = {
  updated_at: string;
  orders: LiveOrder[];
  raw_count?: number | null;
};

export type ForceExitAllRequest = {
  confirm_exit_all: boolean;
  confirm_phrase: string;
  stop_auto_loop?: boolean;
  include_equity?: boolean;
  include_fo?: boolean;
};

export type ForceExitAllItem = {
  exchange?: string | null;
  product?: string | null;
  symbol: string;
  quantity: number;
  side: 'BUY' | 'SELL';
  order_id?: string | null;
  status?: string | null;
  error?: string | null;
};

export type ForceExitAllResponse = {
  updated_at: string;
  stopped_auto_loop: boolean;
  attempted: number;
  placed: number;
  failed: number;
  items: ForceExitAllItem[];
};

export const tradingApi = {
  listLogs: (params?: { symbol?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.symbol) qs.set('symbol', params.symbol);
    if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return safeGet<TradeLogListResponse>(`/trading/logs${suffix}`);
  },

  paperSummary: () => safeGet<PaperTradingSummary>(`/trading/paper/summary`),
  paperPositions: () => safeGet<PaperPosition[]>(`/trading/paper/positions`),

  getPaperAccount: () => safeGet<PaperTradingAccount>(`/trading/paper/account`),
  updatePaperAccount: (payload: PaperTradingAccount) => safePut<PaperTradingAccount>(`/trading/paper/account`, payload),
  resetPaperAccount: (startingCash?: number) => {
    const qs = typeof startingCash === 'number' ? `?starting_cash=${encodeURIComponent(String(startingCash))}` : '';
    return safePost<PaperTradingAccount>(`/trading/paper/reset${qs}`);
  },

  runPaperAuto: (maxSymbols: number) => safePost<PaperAutoRunResponse>(`/trading/paper/run-auto`, { max_symbols: maxSymbols }),

  runLiveAuto: (maxSymbols: number, confirm: boolean, allowSell?: boolean, confirmSell?: boolean) =>
    safePost<PaperAutoRunResponse>(`/trading/live/run-auto`, {
      max_symbols: maxSymbols,
      confirm,
      allow_sell: !!allowSell,
      confirm_sell: !!confirmSell,
    }),

  liveBalance: () => safeGet<LiveBalanceResponse>(`/trading/live/balance`),

  liveRecommendedMaxSymbols: () => safeGet<LiveRecommendedMaxSymbolsResponse>(`/trading/live/recommended-max-symbols`),
  liveSummary: () => safeGet<LiveTradingSummaryResponse>(`/trading/live/summary`),

  liveOrders: (limit?: number) => {
    const qs = typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return safeGet<LiveOrdersResponse>(`/trading/live/orders${qs}`);
  },

  liveAutoLoopStatus: () => safeGet<LiveAutoLoopStatusResponse>(`/trading/live/auto-loop/status`),
  liveAutoLoopStart: (payload: {
    confirm_loop: boolean;
    confirm: boolean;
    allow_sell: boolean;
    confirm_sell: boolean;
    interval_seconds: number;
    max_symbols?: number | null;
    auto_max_symbols: boolean;
  }) => safePost<LiveAutoLoopStatusResponse>(`/trading/live/auto-loop/start`, payload),
  liveAutoLoopStop: () => safePost<LiveAutoLoopStatusResponse>(`/trading/live/auto-loop/stop`, {}),

  forceExitAll: (payload: ForceExitAllRequest) =>
    safePost<ForceExitAllResponse>(`/trading/live/force-exit-all`, payload),
};
