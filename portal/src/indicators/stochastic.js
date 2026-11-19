import { toPoints, lastValue, fmt, rollingMean, rollingHighLow } from './util.js';
import { crossings } from '../analysis/signals.js';

/** Slow stochastic: raw %K over n bars, %K = SMA(smoothK) of raw, %D = SMA(d) of %K. Flat range → 50. */
export function stochasticValues(bars, n = 14, smoothK = 3, d = 3) {
  const { hh, ll } = rollingHighLow(bars, n);
  const raw = bars.map((b, i) => (hh[i] === null ? null : hh[i] === ll[i] ? 50 : (100 * (b.close - ll[i])) / (hh[i] - ll[i])));
  const k = rollingMean(raw, smoothK);
  return { k, d: rollingMean(k, d) };
}

export default {
  id: 'stochastic',
  name: 'Stochastic (14,3,3)',
  pane: 'separate',
  params: { period: 14, smoothK: 3, smoothD: 3, upper: 80, lower: 20 },
  minBars: 16,
  compute(bars, params) {
    const { k, d } = stochasticValues(bars, params.period, params.smoothK, params.smoothD);
    const kv = lastValue(k);
    const dv = lastValue(d);
    let state = 'neutral';
    if (kv !== null && kv > params.upper) state = 'overbought';
    else if (kv !== null && kv < params.lower) state = 'oversold';
    const signals = [];
    for (const x of crossings(k, params.upper)) {
      if (x.dir === 'up') signals.push({ time: bars[x.index].time, kind: 'stoch-overbought', label: `Stochastic %K crossed above ${params.upper}`, position: 'above', tone: 'warn' });
    }
    for (const x of crossings(k, params.lower)) {
      if (x.dir === 'down') signals.push({ time: bars[x.index].time, kind: 'stoch-oversold', label: `Stochastic %K crossed below ${params.lower}`, position: 'below', tone: 'warn' });
    }
    signals.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
    return {
      series: [
        { id: '%k', type: 'line', color: 'c1', data: toPoints(bars, k) },
        { id: '%d', type: 'line', color: 'c2', data: toPoints(bars, d) },
      ],
      levels: [{ value: params.upper, label: '' }, { value: params.lower, label: '' }],
      signals,
      summary: { value: kv, state, text: `Stochastic %K ${fmt(kv, 1)} / %D ${fmt(dv, 1)}, ${state}` },
    };
  },
};
