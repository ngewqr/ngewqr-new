import { toPoints, lastValue, fmt } from './util.js';
import { crossings } from '../analysis/signals.js';

/**
 * Wilder DMI / ADX. +DM/−DM and TR from bar 1; Wilder-smoothed sums seeded
 * with the sum of bars 1..n; DX from bar n; ADX = mean of the first n DX
 * values (first at bar 2n−1), then Wilder-smoothed.
 */
export function adxValues(bars, n = 14) {
  const len = bars.length;
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const adx = new Array(len).fill(null);
  if (len <= n) return { plusDI, minusDI, adx };
  let sTR = 0;
  let sP = 0;
  let sM = 0;
  const dx = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    const b = bars[i];
    const p = bars[i - 1];
    const up = b.high - p.high;
    const down = p.low - b.low;
    const pdm = up > down && up > 0 ? up : 0;
    const mdm = down > up && down > 0 ? down : 0;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    if (i <= n) {
      sTR += tr; sP += pdm; sM += mdm;
      if (i < n) continue;
    } else {
      sTR = sTR - sTR / n + tr;
      sP = sP - sP / n + pdm;
      sM = sM - sM / n + mdm;
    }
    const pdi = sTR ? (100 * sP) / sTR : 0;
    const mdi = sTR ? (100 * sM) / sTR : 0;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    dx[i] = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
  }
  let a = null;
  for (let i = n; i < len; i++) {
    if (i < 2 * n - 1) continue;
    if (i === 2 * n - 1) {
      let s = 0;
      for (let j = n; j <= i; j++) s += dx[j];
      a = s / n;
    } else {
      a = (a * (n - 1) + dx[i]) / n;
    }
    adx[i] = a;
  }
  return { plusDI, minusDI, adx };
}

export default {
  id: 'adx',
  name: 'ADX / DMI (14)',
  pane: 'separate',
  params: { period: 14, strong: 25, weak: 20 },
  minBars: 15,
  compute(bars, params) {
    const { plusDI, minusDI, adx } = adxValues(bars, params.period);
    const a = lastValue(adx);
    const p = lastValue(plusDI);
    const m = lastValue(minusDI);
    let state = 'n/a';
    if (a !== null) state = a >= params.strong ? 'trending' : a < params.weak ? 'range-bound' : 'weak trend';
    const lead = p === null || m === null ? '' : p >= m ? ', +DI leading' : ', −DI leading';
    const signals = [];
    for (const x of crossings(adx, params.strong)) {
      if (x.dir === 'up') signals.push({ time: bars[x.index].time, kind: 'adx-trend-strong', label: `ADX rose above ${params.strong} (trend strengthening)`, position: 'above', tone: 'info' });
    }
    for (const x of crossings(plusDI, minusDI)) {
      signals.push(x.dir === 'up'
        ? { time: bars[x.index].time, kind: 'di-cross-up', label: '+DI crossed above −DI', position: 'below', tone: 'bull' }
        : { time: bars[x.index].time, kind: 'di-cross-down', label: '−DI crossed above +DI', position: 'above', tone: 'bear' });
    }
    signals.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
    return {
      series: [
        { id: 'adx', type: 'line', color: 'c1', data: toPoints(bars, adx) },
        { id: '+di', type: 'line', color: 'c6', data: toPoints(bars, plusDI) },
        { id: '-di', type: 'line', color: 'c5', data: toPoints(bars, minusDI) },
      ],
      levels: [{ value: params.strong, label: '' }, { value: params.weak, label: '' }],
      signals,
      summary: { value: a, state, text: `ADX ${fmt(a, 1)}, ${state}${lead}` },
    };
  },
};
