import { toPoints, closesOf, lastValue, fmt } from './util.js';
import { rsiSignals } from '../analysis/signals.js';

const rsiFrom = (g, l) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));

/**
 * Wilder RSI, index-aligned. Average gain/loss seeded with the simple mean of
 * the first `n` changes, then avg = (prev·(n−1) + current)/n.
 * avgLoss = 0 → RSI 100.
 */
export function rsiValues(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= n;
  l /= n;
  out[n] = rsiFrom(g, l);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = rsiFrom(g, l);
  }
  return out;
}

export default {
  id: 'rsi',
  name: 'RSI (14)',
  pane: 'separate',
  params: { period: 14, upper: 70, lower: 30 },
  minBars: 15,
  compute(bars, params) {
    const v = rsiValues(closesOf(bars), params.period);
    const last = lastValue(v);
    let state = 'neutral';
    if (last !== null && last > params.upper) state = 'overbought';
    else if (last !== null && last < params.lower) state = 'oversold';
    return {
      series: [{ id: 'rsi', type: 'line', color: 'c1', data: toPoints(bars, v) }],
      levels: [
        { value: params.upper, label: 'Overbought' },
        { value: params.lower, label: 'Oversold' },
      ],
      signals: rsiSignals(bars, v, params.upper, params.lower),
      summary: { value: last, state, text: `RSI ${fmt(last, 1)}, ${state}` },
    };
  },
};
