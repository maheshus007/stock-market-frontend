import { api } from "../api/client";

export type TradeSignalScreenerItem = {
  ticker: string;
  name: string;
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  ml_up?: number | null;
  risk?: number | null;
  sentiment_label?: string | null;
  rsi?: number | null;
  coerced?: boolean;
  reason?: string | null;
};

export async function listSignals(decision: "BUY" | "SELL", limit = 100, mode: "binary" | "ternary" = "binary") {
  const { data } = await api.get<{ decision: "BUY" | "SELL"; items: TradeSignalScreenerItem[] }>(`/trade-signal/screener`, { params: { decision, limit, mode } });
  return data;
}
