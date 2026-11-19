// Composite technical stance: describes what the indicators show
// (bullish / bearish / neutral). It is not a buy/sell/hold instruction.

import { smaValues } from '../indicators/sma.js';
import { rsiValues } from '../indicators/rsi.js';
import { macdValues } from '../indicators/macd.js';
import { adxValues } from '../indicators/adx.js';
import { stochasticValues } from '../indicators/stochastic.js';
import { obvValues } from '../indicators/obv.js';
import { squeezeValues } from '../indicators/squeeze.js';
import { rollingMean } from '../indicators/util.js';

export const LABELS = [
  { min: 50, label: 'Strong bullish', tone: 'bull' },
  { min: 15, label: 'Bullish', tone: 'bull' },
  { min: -15, label: 'Neutral', tone: 'info' },
  { min: -50, label: 'Bearish', tone: 'bear' },
  { min: -Infinity, label: 'Strong bearish', tone: 'bear' },
];

export const labelFor = (score) => LABELS.find((l) => score >= l.min);

const sign = (a, b) => (a > b ? 1 : a < b ? -1 : 0);

/**
 * Per-bar stance score (−100..+100), index-aligned, null until every input
 * has a value. Group weights shift with ADX: strong trend → trend counts
 * more; range-bound → momentum counts more. Volume is a fixed 15%.
 */
export function stanceSeries(bars) {
  const closes = bars.map((b) => b.close);
  const s50 = smaValues(closes, 50);
  const s200 = smaValues(closes, 200);
  const rsi = rsiValues(closes, 14);
  const { macd, signal } = macdValues(closes);
  const { plusDI, minusDI, adx } = adxValues(bars, 14);
  const st = stochasticValues(bars);
  const obv = obvValues(bars);
  const obvAvg = rollingMean(obv, 20);
  const sq = squeezeValues(bars);

  const rows = [];
  const score = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    const inputs = [s50[i], s200[i], rsi[i], macd[i], signal[i], adx[i], plusDI[i], st.k[i], st.d[i], obvAvg[i], sq.momentum[i]];
    if (inputs.some((v) => v === null)) { rows.push(null); continue; }
    const c = closes[i];
    const r = rsi[i];
    const trend = [
      { group: 'Trend', name: 'Close vs SMA50', reading: c >= s50[i] ? 'above' : 'below', vote: sign(c, s50[i]) },
      { group: 'Trend', name: 'Close vs SMA200', reading: c >= s200[i] ? 'above' : 'below', vote: sign(c, s200[i]) },
      { group: 'Trend', name: 'SMA50 vs SMA200', reading: s50[i] >= s200[i] ? 'above' : 'below', vote: sign(s50[i], s200[i]) },
      { group: 'Trend', name: 'DMI', reading: `+DI ${plusDI[i].toFixed(1)} / −DI ${minusDI[i].toFixed(1)}`, vote: sign(plusDI[i], minusDI[i]) },
    ];
    const momentum = [
      { group: 'Momentum', name: 'RSI 14', reading: r.toFixed(1), vote: r >= 55 ? 1 : r <= 45 ? -1 : 0 },
      { group: 'Momentum', name: 'MACD vs signal', reading: `${macd[i] >= signal[i] ? 'above' : 'below'}, ${macd[i] >= 0 ? 'above' : 'below'} zero`, vote: sign(macd[i], signal[i]) },
      { group: 'Momentum', name: 'Stochastic %K vs %D', reading: `${st.k[i].toFixed(1)} / ${st.d[i].toFixed(1)}`, vote: sign(st.k[i], st.d[i]) },
      { group: 'Momentum', name: 'Squeeze momentum', reading: sq.momentum[i].toFixed(2), vote: sign(sq.momentum[i], 0) },
    ];
    const volume = [
      { group: 'Volume', name: 'OBV vs 20-bar avg', reading: obv[i] >= obvAvg[i] ? 'above' : 'below', vote: sign(obv[i], obvAvg[i]) },
    ];
    const a = adx[i];
    const [wT, wM] = a >= 25 ? [0.6, 0.4] : a < 20 ? [0.35, 0.65] : [0.5, 0.5];
    const mean = (xs) => xs.reduce((t, x) => t + x.vote, 0) / xs.length;
    score[i] = 100 * (0.85 * (wT * mean(trend) + wM * mean(momentum)) + 0.15 * mean(volume));
    rows.push({ votes: [...trend, ...momentum, ...volume], adx: a, weights: { trend: wT * 0.85, momentum: wM * 0.85, volume: 0.15 } });
  }
  return { score, rows };
}

/** Stance at the last bar, or null when there is not enough history. */
export function currentStance(bars) {
  const { score, rows } = stanceSeries(bars);
  const i = bars.length - 1;
  if (i < 0 || score[i] === null) return null;
  const votes = rows[i].votes;
  return {
    score: score[i],
    ...labelFor(score[i]),
    votes,
    positive: votes.filter((v) => v.vote > 0).length,
    negative: votes.filter((v) => v.vote < 0).length,
    adx: rows[i].adx,
    weights: rows[i].weights,
  };
}
