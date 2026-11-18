import { toPoints, closesOf, lastValue, fmt } from './util.js';
import { maSignals } from '../analysis/signals.js';

/** Simple moving average, index-aligned (null during warm-up). */
export function smaValues(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

const COLORS = ['c1', 'c2', 'c3', 'c4'];

export default {
  id: 'sma',
  name: 'SMA (20/50/200)',
  pane: 'overlay',
  params: { periods: [20, 50, 200] },
  minBars: 20,
  compute(bars, params) {
    const closes = closesOf(bars);
    const lines = params.periods.map((p) => ({ p, v: smaValues(closes, p) }));
    const close = closes[closes.length - 1];
    const parts = lines.map(({ p, v }) => {
      const last = lastValue(v);
      if (last === null) return `SMA${p} n/a`;
      return `SMA${p} ${fmt(last)} (${close >= last ? 'above' : 'below'})`;
    });
    return {
      series: lines.map(({ p, v }, i) => ({
        id: `sma${p}`, type: 'line', color: COLORS[i % COLORS.length], data: toPoints(bars, v),
      })),
      levels: [],
      signals: maSignals(bars),
      summary: { value: close, state: 'info', text: `Close ${fmt(close)}: ${parts.join(', ')}` },
    };
  },
};
