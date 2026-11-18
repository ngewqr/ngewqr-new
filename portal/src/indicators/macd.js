import { toPoints, closesOf, lastValue, fmt } from './util.js';
import { emaValues } from './ema.js';
import { macdSignals } from '../analysis/signals.js';

/** MACD = EMA(fast) − EMA(slow); signal = EMA(signal) of MACD; hist = MACD − signal. */
export function macdValues(closes, fast = 12, slow = 26, signal = 9) {
  const ef = emaValues(closes, fast);
  const es = emaValues(closes, slow);
  const macd = closes.map((_, i) => (ef[i] !== null && es[i] !== null ? ef[i] - es[i] : null));
  const sig = emaValues(macd, signal);
  const hist = macd.map((m, i) => (m !== null && sig[i] !== null ? m - sig[i] : null));
  return { macd, signal: sig, hist };
}

export default {
  id: 'macd',
  name: 'MACD (12,26,9)',
  pane: 'separate',
  params: { fast: 12, slow: 26, signal: 9 },
  minBars: 26,
  compute(bars, params) {
    const { macd, signal, hist } = macdValues(closesOf(bars), params.fast, params.slow, params.signal);
    const m = lastValue(macd);
    const s = lastValue(signal);
    let state = 'neutral';
    if (m !== null && s !== null) state = m > s ? 'above-signal' : 'below-signal';
    const zero = m === null ? '' : m >= 0 ? ', above zero' : ', below zero';
    return {
      series: [
        { id: 'hist', type: 'histogram', color: 'muted', data: toPoints(bars, hist, (i) => ({ tone: hist[i] >= 0 ? 'up' : 'down' })) },
        { id: 'macd', type: 'line', color: 'c1', data: toPoints(bars, macd) },
        { id: 'signal', type: 'line', color: 'c2', data: toPoints(bars, signal) },
      ],
      levels: [{ value: 0, label: '' }],
      signals: macdSignals(bars, macd, signal),
      summary: {
        value: m,
        state,
        text: `MACD ${fmt(m)} vs signal ${fmt(s)} (${state.replace('-', ' ')}${zero})`,
      },
    };
  },
};
