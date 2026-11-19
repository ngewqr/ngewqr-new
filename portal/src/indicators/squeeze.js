import { toPoints, lastValue, closesOf, rollingMean, rollingHighLow, fmt } from './util.js';
import { smaValues } from './sma.js';
import { bollingerValues } from './bollinger.js';
import { trueRange } from './atr.js';

/** Value at the last point of a least-squares line through the last n values. */
function linregLast(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let sx = 0, sy = 0, sxy = 0, sxx = 0, ok = true;
    for (let j = 0; j < n; j++) {
      const y = values[i - n + 1 + j];
      if (y === null) { ok = false; break; }
      sx += j; sy += y; sxy += j * y; sxx += j * j;
    }
    if (!ok) continue;
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    out[i] = intercept + slope * (n - 1);
  }
  return out;
}

/**
 * TTM-style squeeze. Squeeze ON when Bollinger(20,2) sits inside Keltner
 * (SMA20 ± 1.5 × SMA20 of true range). Momentum = linear-regression value of
 * close − mean(mean(HH20, LL20), SMA20) over 20 bars.
 */
export function squeezeValues(bars, n = 20, bbMult = 2, kcMult = 1.5) {
  const closes = closesOf(bars);
  const bb = bollingerValues(closes, n, bbMult);
  const mid = smaValues(closes, n);
  const rng = rollingMean(trueRange(bars), n);
  const on = bars.map((_, i) => (bb.upper[i] === null || rng[i] === null ? null
    : bb.upper[i] < mid[i] + kcMult * rng[i] && bb.lower[i] > mid[i] - kcMult * rng[i]));
  const { hh, ll } = rollingHighLow(bars, n);
  const delta = closes.map((c, i) => (hh[i] === null || mid[i] === null ? null : c - ((hh[i] + ll[i]) / 2 + mid[i]) / 2));
  return { on, momentum: linregLast(delta, n) };
}

export default {
  id: 'squeeze',
  name: 'TTM Squeeze',
  pane: 'separate',
  params: { period: 20, bbMult: 2, kcMult: 1.5 },
  minBars: 39,
  compute(bars, params) {
    const { on, momentum } = squeezeValues(bars, params.period, params.bbMult, params.kcMult);
    const signals = [];
    for (let i = 1; i < bars.length; i++) {
      if (on[i] === null || on[i - 1] === null) continue;
      if (on[i] && !on[i - 1]) signals.push({ time: bars[i].time, kind: 'squeeze-on', label: 'Squeeze on (Bollinger inside Keltner)', position: 'above', tone: 'info' });
      if (!on[i] && on[i - 1] && momentum[i] !== null) {
        const up = momentum[i] >= 0;
        signals.push({ time: bars[i].time, kind: up ? 'squeeze-fire-up' : 'squeeze-fire-down', label: `Squeeze released, momentum ${up ? 'positive' : 'negative'}`, position: up ? 'below' : 'above', tone: up ? 'bull' : 'bear' });
      }
    }
    const m = lastValue(momentum);
    const isOn = on.at(-1);
    const prev = momentum.length > 1 ? momentum.at(-2) : null;
    const dir = m === null || prev === null ? '' : m >= prev ? 'rising' : 'falling';
    return {
      series: [{ id: 'momentum', type: 'histogram', color: 'muted', data: toPoints(bars, momentum, (i) => ({ tone: momentum[i] >= 0 ? 'up' : 'down' })) }],
      levels: [{ value: 0, label: '' }],
      signals,
      summary: {
        value: m,
        state: isOn ? 'squeeze-on' : 'squeeze-off',
        text: `Squeeze ${isOn ? 'ON' : 'off'}, momentum ${fmt(m)} ${dir}`.trim(),
      },
    };
  },
};
