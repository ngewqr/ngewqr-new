import { toPoints, lastValue, fmt } from './util.js';

/** True range per bar. Bar 0 has no previous close, so TR₀ = H − L. */
export function trueRange(bars) {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
}

/** Wilder ATR, index-aligned. Seeded with the mean of the first n true ranges. */
export function atrValues(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < n) return out;
  const tr = trueRange(bars);
  let a = 0;
  for (let i = 0; i < n; i++) a += tr[i];
  a /= n;
  out[n - 1] = a;
  for (let i = n; i < bars.length; i++) {
    a = (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}

export default {
  id: 'atr',
  name: 'ATR (14)',
  pane: 'separate',
  params: { period: 14 },
  minBars: 14,
  compute(bars, params) {
    const v = atrValues(bars, params.period);
    const last = lastValue(v);
    const close = bars.length ? bars[bars.length - 1].close : null;
    const pct = last !== null && close ? ` (${((last / close) * 100).toFixed(2)}% of close)` : '';
    return {
      series: [{ id: 'atr', type: 'line', color: 'c4', data: toPoints(bars, v) }],
      levels: [],
      signals: [],
      summary: { value: last, state: 'info', text: `ATR ${fmt(last)}${pct}` },
    };
  },
};
