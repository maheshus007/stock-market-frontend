import { safeGet, safePost, safePut } from './client';

export type FOSettings = {
  enable_paper: boolean;
  enable_live: boolean;
  auto_pick_defaults?: {
    max_picks?: number;
    min_confidence?: number;
    lots?: number;
    product?: 'MIS' | 'NRML' | string;
  };
  risk_controls?: {
    enabled?: boolean;
    max_open_positions?: number;
    min_option_ltp?: number;
    max_premium_per_trade?: number;
    max_daily_loss?: number;
    stop_loss_pct?: number;
    take_profit_pct?: number;
  };
  instruments: FOInstrumentConfig[];
};

export type FOInstrumentConfig = {
  enabled: boolean;
  kind: 'FUT' | 'OPT' | string;
  exchange: 'NFO' | string;
  tradingsymbol: string;
  product: 'MIS' | 'NRML' | string;
  quantity: number;
  strategy_action: 'BUY' | 'SELL' | 'HOLD' | 'AUTO' | string;
};

export type FOUnderlyingsOut = { items: string[] };
export type FOExpiriesOut = { items: string[] };

export type FOContractOut = {
  exchange: string;
  segment?: string | null;
  tradingsymbol: string;
  instrument_token: number;
  name?: string | null;
  instrument_type?: string | null;
  expiry?: string | null;
  strike?: number | null;
  lot_size?: number | null;
};

export type FOLtpResponse = {
  items: Record<string, number | null>;
};

export type FOAutoRunItem = {
  exchange: string;
  tradingsymbol: string;
  kind: string;
  underlying?: string | null;
  option_type?: string | null;
  expiry?: string | null;
  strike?: number | null;
  lot_size?: number | null;
  action: string;
  quantity: number;
  ltp?: number | null;
  underlying_ltp?: number | null;
  option_ltp?: number | null;
  required_amount?: number | null;
  entry_price?: number | null;
  execution_steps?: Record<string, any>[] | null;
  executed: boolean;
  error?: string | null;
  result?: Record<string, any> | null;
};

export type FOAutoRunResponse = {
  considered: number;
  executed: number;
  items: FOAutoRunItem[];
};

export type FOAutoPickRequest = {
  underlyings: string[];
  max_picks?: number;
  min_confidence?: number;
  exchange?: 'NFO' | string;
  product?: 'MIS' | 'NRML' | string;
  lots?: number;
  allow_sell?: boolean;
  confirm?: boolean;
  confirm_sell?: boolean;
};

export type FOAutoPickItem = {
  underlying: string;
  decision_action: string;
  confidence: number;
  reason?: string[];
  option_type?: 'CE' | 'PE' | string | null;
  exchange?: string | null;
  tradingsymbol?: string | null;
  expiry?: string | null;
  strike?: number | null;
  lot_size?: number | null;
  quantity?: number | null;
  underlying_ltp?: number | null;
  option_ltp?: number | null;

  // Advanced modeling (Phase A+B+C)
  xgb_direction_prob_up?: number | null;
  hmm_regime_label?: string | null;
  hmm_regime_probs?: Record<string, number>;

  // Advanced modeling (Phase D+E)
  garch_vol_forecast?: number | null;
  ppo_action?: 'BUY' | 'SELL' | 'HOLD' | string | null;
  ppo_action_probs?: Record<string, number>;

  executed: boolean;
  execution_steps?: Record<string, any>[] | null;
  error?: string | null;
};

export type FOAutoPickResponse = {
  considered: number;
  picked: number;
  executed: number;
  items: FOAutoPickItem[];
};

export type FOPaperAccount = {
  starting_cash: number;
  cash: number;
  updated_at?: string | null;
};

export type FOPaperPosition = {
  exchange: string;
  tradingsymbol: string;
  quantity: number;
  entry_price: number;
  opened_at: string;
  metadata?: Record<string, any> | null;
};

export type FOPaperOrderRecord = {
  created_at: string;
  exchange: string;
  tradingsymbol: string;
  side: 'BUY' | 'SELL' | string;
  quantity: number;
  fill_price: number;
  status?: string;
  order_id?: string | null;
  entry_price?: number | null;
  pnl?: number | null;
  metadata?: Record<string, any> | null;
};

export type FOPaperOrdersResponse = {
  items: FOPaperOrderRecord[];
};

export type FOPaperLoopStatusResponse = {
  running: boolean;
  started_at?: string | null;
  last_run_at?: string | null;
  last_error?: string | null;
  iterations?: number;
  last_summary?: Record<string, any> | null;
  last_items?: Record<string, any>[] | null;
  interval_seconds?: number | null;
};

export type FOPaperAutoRunLoopStartRequest = {
  interval_seconds: number;
  allow_sell?: boolean;
};

export type FOPaperAutoPickLoopStartRequest = {
  interval_seconds: number;
  underlyings: string[];
  max_picks?: number;
  min_confidence?: number;
  exchange?: 'NFO' | string;
  product?: 'MIS' | 'NRML' | string;
  lots?: number;
  allow_sell?: boolean;
};

export type FOOptionGreeksRequest = {
  spot: number;
  strike: number;
  days_to_expiry: number;
  option_type: 'CE' | 'PE';
  rate?: number;
  dividend_yield?: number;
  implied_vol?: number | null;
  market_price?: number | null;
  quantity?: number;
};

export type FOOptionGreeksResponse = {
  t_years: number;
  implied_vol_used: number;
  theoretical_price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
  qty: number;
  delta_exposure: number;
  gamma_exposure: number;
  vega_exposure: number;
  theta_per_day_exposure: number;
  delta_neutral_underlying_qty: number;
};

export type FOVolPoint = { strike: number; implied_vol: number };

export type FOSVICalibrateRequest = {
  forward: number;
  days_to_expiry: number;
  points: FOVolPoint[];
};

export type FOSVICalibrateResponse = {
  params: Record<string, number>;
  rmse: number;
  iv_fitted: number[];
};

export type FOSVIEvaluateRequest = {
  forward: number;
  days_to_expiry: number;
  strikes: number[];
  params: Record<string, number>;
};

export type FOSVIEvaluateResponse = {
  iv: number[];
};

export type FOSABRCalibrateRequest = {
  forward: number;
  days_to_expiry: number;
  beta?: number;
  points: FOVolPoint[];
};

export type FOSABRCalibrateResponse = {
  params: Record<string, number>;
  rmse: number;
  iv_fitted: number[];
};

export type FOSABREvaluateRequest = {
  forward: number;
  days_to_expiry: number;
  strikes: number[];
  params: Record<string, number>;
};

export type FOSABREvaluateResponse = {
  iv: number[];
};

// F&O advanced modeling (XGBoost direction + HMM regime)
export type FOAdvancedModelSettings = {
  interval?: '5minute';
  horizon_minutes: number;
  lookback_bars: number;
  train_window_days: number;
  min_train_bars: number;

  xgb_n_estimators: number;
  xgb_max_depth: number;
  xgb_learning_rate: number;
  xgb_subsample: number;
  xgb_colsample_bytree: number;
  xgb_reg_lambda: number;
  xgb_random_state: number;

  hmm_states: number;
  hmm_random_state: number;

  enable_garch?: boolean;
  garch_p?: number;
  garch_q?: number;

  enable_ppo?: boolean;
  ppo_episodes?: number;
  ppo_steps_per_episode?: number;
  ppo_gamma?: number;
  ppo_gae_lambda?: number;
  ppo_clip_ratio?: number;
  ppo_lr?: number;
  ppo_entropy_coef?: number;
  ppo_value_coef?: number;
  ppo_max_grad_norm?: number;
  ppo_hidden_size?: number;
  ppo_transaction_cost?: number;

  // Advanced decisioning integration (auto-pick)
  adv_enable_veto?: boolean;
  adv_enable_confidence_adjust?: boolean;

  adv_veto_ppo_min_prob?: number;
  adv_veto_ppo_min_margin?: number;
  adv_veto_xgb_buy_max_p_up?: number;
  adv_veto_xgb_sell_min_p_up?: number;

  adv_conf_mult_min?: number;
  adv_conf_mult_max?: number;

  adv_garch_penalty_t1?: number;
  adv_garch_penalty_t2?: number;
  adv_garch_penalty_t3?: number;
  adv_garch_mult_t1?: number;
  adv_garch_mult_t2?: number;
  adv_garch_mult_t3?: number;
};

export type FOAdvancedTrainRequest = {
  underlyings: string[];
  settings_override?: FOAdvancedModelSettings | null;
};

export type FOAdvancedTrainMetrics = {
  symbol: string;
  trained: boolean;
  n_bars?: number | null;
  horizon_minutes?: number | null;
  xgb_accuracy?: number | null;
  xgb_f1?: number | null;
  xgb_roc_auc?: number | null;
  garch_trained?: boolean;
  ppo_trained?: boolean;
  error?: string | null;
};

export type FOAdvancedTrainResponse = {
  settings_used: FOAdvancedModelSettings;
  items: FOAdvancedTrainMetrics[];
};

export type FOAdvancedPredictionOut = {
  symbol: string;
  as_of: string;
  horizon_minutes: number;
  direction_prob_up?: number | null;
  regime_label?: string | null;
  regime_probs?: Record<string, number>;
  garch_vol_forecast?: number | null;
  ppo_action?: 'BUY' | 'SELL' | 'HOLD' | string | null;
  ppo_action_probs?: Record<string, number>;
  features_used?: Record<string, number>;
};

export type FOAdvancedPredictRequest = {
  symbol: string;
  settings_override?: FOAdvancedModelSettings | null;
};

export type FOAdvancedPredictResponse = {
  prediction: FOAdvancedPredictionOut;
};

export const foApi = {
  cacheStatus: () => safeGet(`/fo/cache-status`),

  getSettings: () => safeGet<FOSettings>(`/fo/settings`),
  updateSettings: (payload: FOSettings) => safePut<FOSettings>(`/fo/settings`, payload),

  underlyings: (query?: string, limit: number = 50) => {
    const qs = new URLSearchParams();
    if (query) qs.set('query', query);
    qs.set('limit', String(limit));
    return safeGet<FOUnderlyingsOut>(`/fo/underlyings?${qs.toString()}`);
  },

  expiries: (underlying: string, kind: 'FUT' | 'OPT') => {
    const qs = new URLSearchParams();
    qs.set('underlying', underlying);
    qs.set('kind', kind);
    return safeGet<FOExpiriesOut>(`/fo/expiries?${qs.toString()}`);
  },

  contracts: (params: {
    underlying: string;
    kind: 'FUT' | 'OPT';
    expiry?: string | null;
    option_type?: 'CE' | 'PE' | null;
    strike_min?: number | null;
    strike_max?: number | null;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('underlying', params.underlying);
    qs.set('kind', params.kind);
    if (params.expiry) qs.set('expiry', params.expiry);
    if (params.option_type) qs.set('option_type', params.option_type);
    if (typeof params.strike_min === 'number') qs.set('strike_min', String(params.strike_min));
    if (typeof params.strike_max === 'number') qs.set('strike_max', String(params.strike_max));
    qs.set('limit', String(params.limit ?? 200));
    return safeGet<FOContractOut[]>(`/fo/contracts?${qs.toString()}`);
  },

  ltp: (instruments: string[]) => safePost<FOLtpResponse>(`/fo/ltp`, { instruments }),

  runPaperAuto: (payload?: { allow_sell?: boolean }) =>
    safePost<FOAutoRunResponse>(`/fo/paper/run-auto`, { confirm: false, allow_sell: !!payload?.allow_sell, confirm_sell: false }),
  runLiveAuto: (payload: { confirm: boolean; allow_sell: boolean; confirm_sell: boolean }) =>
    safePost<FOAutoRunResponse>(`/fo/live/run-auto`, payload),

  runPaperAutoPick: (payload: FOAutoPickRequest) =>
    safePost<FOAutoPickResponse>(`/fo/paper/auto-pick/run`, { ...payload, confirm: false, confirm_sell: false }),
  runLiveAutoPick: (payload: FOAutoPickRequest) => safePost<FOAutoPickResponse>(`/fo/live/auto-pick/run`, payload),

  paperAutoRunLoopStatus: () => safeGet<FOPaperLoopStatusResponse>(`/fo/paper/loop/auto-run/status`),
  paperAutoRunLoopStart: (payload: FOPaperAutoRunLoopStartRequest) =>
    safePost<FOPaperLoopStatusResponse>(`/fo/paper/loop/auto-run/start`, { interval_seconds: payload.interval_seconds, allow_sell: !!payload.allow_sell }),
  paperAutoRunLoopStop: () => safePost<FOPaperLoopStatusResponse>(`/fo/paper/loop/auto-run/stop`, {}),

  paperAutoPickLoopStatus: () => safeGet<FOPaperLoopStatusResponse>(`/fo/paper/loop/auto-pick/status`),
  paperAutoPickLoopStart: (payload: FOPaperAutoPickLoopStartRequest) =>
    safePost<FOPaperLoopStatusResponse>(`/fo/paper/loop/auto-pick/start`, {
      interval_seconds: payload.interval_seconds,
      underlyings: payload.underlyings || [],
      max_picks: payload.max_picks,
      min_confidence: payload.min_confidence,
      lots: payload.lots,
      exchange: payload.exchange,
      product: payload.product,
      allow_sell: !!payload.allow_sell,
    }),
  paperAutoPickLoopStop: () => safePost<FOPaperLoopStatusResponse>(`/fo/paper/loop/auto-pick/stop`, {}),

  getPaperAccount: () => safeGet<FOPaperAccount>(`/fo/paper/account`),
  resetPaperAccount: (startingCash?: number) => {
    const qs = typeof startingCash === 'number' ? `?starting_cash=${encodeURIComponent(String(startingCash))}` : '';
    return safePost<FOPaperAccount>(`/fo/paper/reset${qs}`, {});
  },
  paperPositions: () => safeGet<FOPaperPosition[]>(`/fo/paper/positions`),
  paperOrders: (limit: number = 25) => safeGet<FOPaperOrdersResponse>(`/fo/paper/orders?limit=${encodeURIComponent(String(limit))}`),

  // Advanced option analytics (analysis-only)
  advancedGreeks: (payload: FOOptionGreeksRequest) => safePost<FOOptionGreeksResponse>(`/fo/advanced/greeks`, payload),
  sviCalibrate: (payload: FOSVICalibrateRequest) =>
    safePost<FOSVICalibrateResponse>(`/fo/advanced/vol-surface/svi/calibrate`, payload),
  sviEvaluate: (payload: FOSVIEvaluateRequest) =>
    safePost<FOSVIEvaluateResponse>(`/fo/advanced/vol-surface/svi/evaluate`, payload),
  sabrCalibrate: (payload: FOSABRCalibrateRequest) =>
    safePost<FOSABRCalibrateResponse>(`/fo/advanced/vol-surface/sabr/calibrate`, payload),
  sabrEvaluate: (payload: FOSABREvaluateRequest) =>
    safePost<FOSABREvaluateResponse>(`/fo/advanced/vol-surface/sabr/evaluate`, payload),

  // Advanced F&O modeling (training + inference)
  getAdvancedModelSettings: () => safeGet<FOAdvancedModelSettings>(`/fo/advanced/settings`),
  updateAdvancedModelSettings: (payload: FOAdvancedModelSettings) => safePut<FOAdvancedModelSettings>(`/fo/advanced/settings`, payload),
  advancedTrain: (payload: FOAdvancedTrainRequest) => safePost<FOAdvancedTrainResponse>(`/fo/advanced/train`, payload),
  advancedPredict: (payload: FOAdvancedPredictRequest) => safePost<FOAdvancedPredictResponse>(`/fo/advanced/predict`, payload),
};
