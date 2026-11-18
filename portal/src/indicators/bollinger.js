import { toPoints, closesOf, lastValue, fmt } from './util.js';
import { bollingerSignals } from '../analysis/signals.js';

/** Bollinger bands: middle = SMA(n); bands = middle ± k·σ (population σ). */
export function bollingerValues(closes, n = 20, k = 2) {
  const len = closes.length;
  const middle = new Array(len).fill(null);
  const upper = new Array(len).fill(null);
  const lower = new Array(len).fill(null);
  for (let i = n - 1; i < len; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += closes[j];
    const mean = sum / n;
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(sq / n);
    middle[i] = mean;
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { middle, upper, lower };
}

export default {
  id: 'bollinger',
  name: 'Bollinger (20,2)',
  pane: 'overlay',
  params: { period: 20, mult: 2, squeezeLookback: 126 },
  minBars: 20,
  compute(bars, params) {
    const closes = closesOf(bars);
    const bb = bollingerValues(closes, params.period, params.mult);
    const u = lastValue(bb.upper);
    const l = lastValue(bb.lower);
    const c = closes[closes.length - 1];
    let state = 'inside';
    if (u !== null && c > u) state = 'above-upper';
    else if (l !== null && c < l) state = 'below-lower';
    return {
      series: [
        { id: 'bb-upper', type: 'line', color: 'c3', dashed: true, data: toPoints(bars, bb.upper) },
        { id: 'bb-middle', type: 'line', color: 'c3', data: toPoints(bars, bb.middle) },
        { id: 'bb-lower', type: 'line', color: 'c3', dashed: true, data: toPoints(bars, bb.lower) },
      ],
      levels: [],
      signals: bollingerSignals(bars, bb, params.squeezeLookback),
      summary: {
        value: c,
        state,
        text: `Bollinger ${fmt(l)} to ${fmt(u)}, close ${state.replace('-', ' ')}`,
      },
    };
  },
};
