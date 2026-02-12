"use client";
import { OHLCVResponse } from '@/types/api';
import { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { fmt2, formatISTDateTime } from '@/lib/format';

export type RangeKey = '5y' | '3y' | '2y' | '1y' | '5m' | '3m' | '1m' | '2w' | '1w' | '1d';
const ranges: { key: RangeKey; label: string; days: number }[] = [
  { key: '5y', label: '5y', days: 365 * 5 },
  { key: '3y', label: '3y', days: 365 * 3 },
  { key: '2y', label: '2y', days: 365 * 2 },
  { key: '1y', label: '1y', days: 365 },
  { key: '5m', label: '5m', days: 30 * 5 },
  { key: '3m', label: '3m', days: 30 * 3 },
  { key: '1m', label: '1m', days: 30 },
  { key: '2w', label: '2w', days: 14 },
  { key: '1w', label: '1w', days: 7 },
  // For daily OHLCV, "1d" should mean "last available trading day" (often yesterday),
  // not "last 24 hours".
  { key: '1d', label: '1d', days: 1 },
];

export function PriceChart({
  data,
  range,
  setRange,
  serverAgg,
  onToday,
  todayActive,
}: {
  data: OHLCVResponse | null;
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  serverAgg?: 'weekly' | 'monthly';
  onToday?: () => void;
  todayActive?: boolean;
}) {
  const [aggregate, setAggregate] = useState(true);

  type LiveTrend = 'bullish' | 'bearish' | 'neutral';

  const [resolvedColors, setResolvedColors] = useState<{
    brand: string;
    bullish: string;
    bearish: string;
    neutral: string;
  } | null>(null);

  useEffect(() => {
    const resolveColorFromClass = (className: string, fallback: string) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
      const el = document.createElement('span');
      el.className = className;
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      el.style.top = '-9999px';
      document.body.appendChild(el);
      const color = window.getComputedStyle(el).color;
      document.body.removeChild(el);
      return color || fallback;
    };

    // Fallback for brand is the existing hard-coded brand color used previously.
    // For trend colors, resolve from Tailwind defaults via class names.
    const brand = resolveColorFromClass('text-brand', '#1f6feb');
    const bullish = resolveColorFromClass('text-green-500', brand);
    const bearish = resolveColorFromClass('text-red-500', brand);
    const neutral = resolveColorFromClass('text-yellow-500', brand);

    setResolvedColors({ brand, bullish, bearish, neutral });
  }, []);
  const chartDataAll = (data || []).map(d => ({
    time: new Date(d.timestamp).getTime(),
    close: d.close,
  }));
  const chartData = useMemo(() => {
    if (!chartDataAll.length) return chartDataAll;
    if (range === '1d') {
      const lastTs = chartDataAll[chartDataAll.length - 1].time;
      const lastDay = new Date(lastTs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
      const dayData = chartDataAll.filter(pt => {
        const d = new Date(pt.time).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        return d === lastDay;
      });
      // If we only have daily candles in DB, this will still be a single point.
      return dayData.length ? dayData : chartDataAll.slice(-1);
    }
    const end = new Date(chartDataAll[chartDataAll.length - 1].time);
    const days = ranges.find(r => r.key === range)?.days ?? 90;
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    // Filter by timestamp >= start
    let windowData = chartDataAll.filter(d => {
      return d.time >= start.getTime();
    });
    // Client-side market-hours filter no longer needed when serverAgg/timeWindow is applied globally
    // If server-side aggregation is provided, don't client-aggregate
    if (serverAgg) return windowData;
    // Downsample for long ranges (when enabled): monthly for >=2y, weekly for 1y
    const isMonthly = range === '5y' || range === '3y' || range === '2y';
    const isWeekly = range === '1y';
    if (!aggregate || !(isMonthly || isWeekly)) return windowData;
    const grouped = new Map<string, { time: number; close: number }>();
    for (const pt of windowData) {
      const d = new Date(pt.time);
      let key: string;
      if (isMonthly) {
        key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        // Use last close in month (overwrite until last)
        grouped.set(key, { time: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), close: pt.close });
      } else {
        // ISO week key: Year-Week
        const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const dayNum = (tmp.getUTCDay() + 6) % 7; // Monday=0
        tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3); // Thursday of this week
        const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
        const week = Math.floor(1 + (tmp.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
        key = `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
        // Week start (Monday) for plotting
        const weekStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
        weekStart.setUTCDate(weekStart.getUTCDate() + (week - 1) * 7 - ((weekStart.getUTCDay() + 6) % 7));
        grouped.set(key, { time: weekStart.getTime(), close: pt.close });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.time - b.time);
  }, [chartDataAll, range, aggregate, serverAgg]);

  const liveTrend = useMemo<LiveTrend>(() => {
    if (!todayActive) return 'neutral';
    if (chartData.length < 5) return 'neutral';

    const lookback = Math.min(20, chartData.length);
    const tail = chartData.slice(-lookback);
    const first = tail[0]?.close;
    const last = tail[tail.length - 1]?.close;
    if (!Number.isFinite(first) || !Number.isFinite(last) || !first) return 'neutral';

    const pct = ((last - first) / Math.abs(first)) * 100;
    const neutralThresholdPct = 0.15;
    if (pct > neutralThresholdPct) return 'bullish';
    if (pct < -neutralThresholdPct) return 'bearish';
    return 'neutral';
  }, [todayActive, chartData]);

  const strokeColor = useMemo(() => {
    const brand = resolvedColors?.brand ?? '#1f6feb';
    if (!todayActive) return brand;
    if (!resolvedColors) return brand;
    if (liveTrend === 'bullish') return resolvedColors.bullish;
    if (liveTrend === 'bearish') return resolvedColors.bearish;
    return resolvedColors.neutral;
  }, [todayActive, resolvedColors, liveTrend]);

  const todayButtonClass = useMemo(() => {
    if (!todayActive) return 'bg-gray-800 hover:bg-gray-700';
    if (liveTrend === 'bullish') return 'bg-green-900/30 border border-green-600 text-green-300';
    if (liveTrend === 'bearish') return 'bg-red-900/30 border border-red-600 text-red-300';
    return 'bg-yellow-900/30 border border-yellow-600 text-yellow-300';
  }, [todayActive, liveTrend]);

  const rangeButtonClass = useMemo(() => {
    return (r: RangeKey) => {
      if (r === '1d' && todayActive) return todayButtonClass;
      return range === r ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-700';
    };
  }, [range, todayActive, todayButtonClass]);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="card-title">Price (Close)</div>
          {(['5y','3y','2y','1y'] as RangeKey[]).includes(range) && (
            <span className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-300 border border-gray-700">
              {serverAgg ? (serverAgg === 'weekly' ? 'Weekly' : 'Monthly') : (range === '1y' ? 'Weekly' : 'Monthly')}
              {serverAgg ? '' : (aggregate ? '' : ' (raw)')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          {onToday && (
            <button
              className={`px-2 py-1 text-xs rounded ${todayButtonClass}`}
              onClick={onToday}
              title="Show today's intraday and live updates"
            >Today</button>
          )}
          {ranges.map(r => (
            <button
              key={r.key}
              className={`px-2 py-1 text-xs rounded ${rangeButtonClass(r.key)}`}
              onClick={() => setRange(r.key)}
            >{r.label}</button>
          ))}
          {!serverAgg && (['5y','3y','2y','1y'] as RangeKey[]).includes(range) && (
            <button
              className={`px-2 py-1 text-xs rounded ${aggregate ? 'bg-gray-700' : 'bg-gray-800 hover:bg-gray-700'}`}
              onClick={() => setAggregate(a => !a)}
              title="Toggle aggregation"
            >{aggregate ? 'Aggregated' : 'Raw'}</button>
          )}
        </div>
      </div>
      {chartData.length === 0 ? (
        <div className="text-sm text-gray-400">No data in selected range.</div>
      ) : (
        <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.6}/>
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0}/>
              </linearGradient>
            </defs>
            {
              /* Format x-axis based on selected range for readability */
            }
            <XAxis
              dataKey="time"
              type="number"
              domain={[
                chartData.length === 1 ? (chartData[0].time - 24 * 60 * 60 * 1000) : chartData[0].time,
                chartData[chartData.length - 1].time,
              ]}
              tick={{ fill: '#9ca3af' }}
              interval={range === '5y' || range === '3y' || range === '2y' ? 4 : range === '1y' ? 2 : 'preserveStartEnd'}
              minTickGap={range === '5y' || range === '3y' ? 48 : range === '2y' || range === '1y' ? 32 : 16}
              tickFormatter={(v: number) => {
                const d = new Date(v);
                if (range === '1d') {
                  // For intraday chart, show time in IST
                  return new Intl.DateTimeFormat('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(d);
                }
                // Otherwise show calendar date for clarity across ranges
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yy = String(d.getFullYear()).slice(-2);
                return `${dd}/${mm}/${yy}`;
              }}
            />
            <YAxis domain={[ 'auto', 'auto' ]} tick={{ fill: '#9ca3af' }} />
            <Tooltip
              contentStyle={{ background: '#111827', border: '1px solid #374151' }}
              formatter={(value: any) => fmt2(Number(value))}
              labelFormatter={(label: any) => formatISTDateTime(Number(label))}
            />
            <Area type="monotone" dataKey="close" stroke={strokeColor} fillOpacity={1} fill="url(#colorClose)" dot={chartData.length === 1} />
          </AreaChart>
        </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
