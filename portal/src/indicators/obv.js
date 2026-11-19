import { toPoints, lastValue, rollingMean } from './util.js';

/** On-balance volume, starting at 0 on the first bar of the series. */
export function obvValues(bars) {
  const out = new Array(bars.length).fill(null);
  let v = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      if (bars[i].close > bars[i - 1].close) v += bars[i].volume;
      else if (bars[i].close < bars[i - 1].close) v -= bars[i].volume;
    }
    out[i] = v;
  }
  return out;
}

export default {
  id: 'obv',
  name: 'OBV',
  pane: 'separate',
  params: { avgPeriod: 20 },
  minBars: 1,
  compute(bars, params) {
    const obv = obvValues(bars);
    const avg = rollingMean(obv, params.avgPeriod);
    const o = lastValue(obv);
    const a = lastValue(avg);
    const state = a === null ? 'n/a' : o >= a ? 'rising' : 'falling';
    return {
      series: [
        { id: 'obv', type: 'line', color: 'c4', volume: true, data: toPoints(bars, obv) },
        { id: `obv-avg${params.avgPeriod}`, type: 'line', color: 'c2', volume: true, data: toPoints(bars, avg) },
      ],
      levels: [],
      signals: [],
      summary: { value: o, state, text: `OBV ${state} (vs its ${params.avgPeriod}-bar average)` },
    };
  },
};
