import { api } from "../api/client";

export type TradeSignalSettings = {
  ml_weight: number;
  sentiment_weight: number;
  technical_weight: number;
  risk_weight: number;
  buy_threshold: number;
  sell_threshold: number;
  min_up_prob: number;
  risk_cap: number;
};

export type DataSchedulerSettings = {
  enabled: boolean;
  interval_minutes: number;
  interval: "minute" | "5minute" | "15minute" | "day";
  lookback_days: number;
  selected_symbols: string;
  daily_run_time?: string | null;
};

export type TradingAutomationSettings = {
  enable_trading_decision_agent: boolean;
  enable_risk_capital_agent: boolean;
  enable_order_execution_agent: boolean;
  enable_trade_logger: boolean;

  // Safety mode: tighten guardrails to reduce drawdown.
  loss_protection_mode: boolean;

  enable_paper_trading: boolean;

  // Optional explicit universe for LIVE automation.
  // - null: not configured (server falls back to Data Scheduler selected_symbols)
  // - []: configured empty (no symbols participate)
  live_selected_symbols: string[] | null;

  trade_only_market_hours: boolean;
  one_active_position_per_symbol: boolean;
  product: "CNC" | "MIS";
  order_variety: "regular";
  default_quantity: number;

  stop_loss_pct: number;

  capital_per_trade_pct: number;
  max_daily_loss_pct: number;
  max_open_trades: number;
  min_confidence: number;
  block_on_extreme_volatility: boolean;

  buy_min_ml_up_prob: number;
  buy_min_rsi: number;
  buy_max_rsi: number;
  buy_max_risk_score: number;
  sell_max_ml_up_prob: number;
  sell_min_risk_score: number;
};

export async function getTradeSignalSettings() {
  const { data } = await api.get<TradeSignalSettings>(`/trade-signal/settings`);
  return data;
}

export async function updateTradeSignalSettings(payload: TradeSignalSettings) {
  const { data } = await api.put<TradeSignalSettings>(`/trade-signal/settings`, payload);
  return data;
}

export async function getDataSchedulerSettings() {
  const { data } = await api.get<DataSchedulerSettings>(`/data-scheduler/settings`);
  return data;
}

export async function updateDataSchedulerSettings(payload: DataSchedulerSettings) {
  const { data } = await api.put<DataSchedulerSettings>(`/data-scheduler/settings`, payload);
  return data;
}

export async function getTradingAutomationSettings() {
  const { data } = await api.get<TradingAutomationSettings>(`/trading/settings`);
  return data;
}

export async function updateTradingAutomationSettings(payload: TradingAutomationSettings) {
  const { data } = await api.put<TradingAutomationSettings>(`/trading/settings`, payload);
  return data;
}
