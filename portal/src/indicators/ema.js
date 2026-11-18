import { toPoints, closesOf, lastValue, fmt } from './util.js';

/**
 * Exponential moving average, index-aligned. α = 2/(n+1), seeded with the
 * SMA of the first n values. Leading nulls in `values` are skipped, so this
 * also works on derived series (e.g. the MACD signal line).
 */
export function emaValues(values, n) {
  const out = new Array(values.length).fill(null);
  let start = 0;
  while (start < values.length && (values[start] === null || values[start] === undefined)) start++;
  if (values.length - start < n) return out;
  let seed = 0;
  for (let i = start; i < start + n; i++) seed += values[i];
  let e = seed / n;
  out[start + n - 1] = e;
  const a = 2 / (n + 1);
  for (let i = start + n; i < values.length; i++) {
    e = a * values[i] + (1 - a) * e;
    out[i] = e;
  }
  return out;
}

const COLORS = ['c5', 'c6'];

export default {
  id: 'ema',
  name: 'EMA (9/21)',
  pane: 'overlay',
  params: { periods: [9, 21] },
  minBars: 9,
  compute(bars, params) {
    const closes = closesOf(bars);
    const lines = params.periods.map((p) => ({ p, v: emaValues(closes, p) }));
    const text = lines.map(({ p, v }) => `EMA${p} ${fmt(lastValue(v))}`).join(', ');
    return {
      series: lines.map(({ p, v }, i) => ({
        id: `ema${p}`, type: 'line', color: COLORS[i % COLORS.length], data: toPoints(bars, v),
      })),
      levels: [],
      signals: [],
      summary: { value: lastValue(lines[0].v), state: 'info', text },
    };
  },
};
