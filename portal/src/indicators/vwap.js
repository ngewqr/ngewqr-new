import { toPoints, lastValue, fmt } from './util.js';
import { sessionDate } from '../timeframes.js';

/** Session VWAP: Σ(typical·vol)/Σvol, typical = (H+L+C)/3, reset each New York session. */
export function vwapValues(bars) {
  const out = new Array(bars.length).fill(null);
  let session = null;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const s = sessionDate(b.time);
    if (s !== session) {
      session = s;
      pv = 0;
      vol = 0;
    }
    pv += ((b.high + b.low + b.close) / 3) * b.volume;
    vol += b.volume;
    if (vol > 0) out[i] = pv / vol;
  }
  return out;
}

export default {
  id: 'vwap',
  name: 'VWAP (session)',
  pane: 'overlay',
  intradayOnly: true,
  params: {},
  minBars: 1,
  compute(bars) {
    const v = vwapValues(bars);
    const last = lastValue(v);
    const close = bars.length ? bars[bars.length - 1].close : null;
    const rel = last !== null && close !== null ? (close >= last ? 'above' : 'below') : 'n/a';
    return {
      series: [{ id: 'vwap', type: 'line', color: 'c6', data: toPoints(bars, v) }],
      levels: [],
      signals: [],
      summary: { value: last, state: rel, text: `VWAP ${fmt(last)}, close ${rel}` },
    };
  },
};
