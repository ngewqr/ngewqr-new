// Daily scanner. Pure; no fetching or DOM.
//
// prepare(bars) computes every series once over the full history. Each series
// value at bar t depends only on bars 0..t (enforced by the indicator tests),
// so row(prep, i) is exactly what a scan run on day i would have produced.
// Forward returns (+1d..+20d) are the only fields that look past i, and they
// are reported separately as outcomes, never used for tiers or "tested" stats.

import { defaultSignals } from './signals.js';
import { stanceSeries, labelFor } from './stance.js';
import { atrValues } from '../indicators/atr.js';
import { rsiValues } from '../indicators/rsi.js';
import { rollingHighLow, rollingMean } from '../indicators/util.js';

export const HORIZONS = [1, 2, 5, 20];
export const TESTED_H = 5; // horizon used for "tested" stats
const BEARISH_KINDS = new Set(['death-cross', 'bearish-divergence', 'macd-cross-down', 'rsi-overbought']);
const BULLISH_KINDS = new Set(['golden-cross', 'bullish-divergence', 'macd-cross-up', 'rsi-oversold']);

export function prepare(bars) {
  const closes = bars.map((b) => b.close);
  const signals = defaultSignals(bars);
  const idx = new Map(bars.map((b, i) => [String(b.time), i]));
  const byIndex = new Map();
  for (const s of signals) {
    const i = idx.get(String(s.time));
    if (i === undefined) continue;
    if (!byIndex.has(i)) byIndex.set(i, []);
    byIndex.get(i).push(s);
  }
  const { hh, ll } = rollingHighLow(bars, 20);
  return {
    bars,
    closes,
    index: idx,
    byIndex,
    stance: stanceSeries(bars).score,
    atr: atrValues(bars, 14),
    rsi: rsiValues(closes, 14),
    hh20: hh,
    ll20: ll,
    vol20: rollingMean(bars.map((b) => b.volume), 20),
  };
}

const fwd = (closes, i, h) => (i + h < closes.length ? closes[i + h] / closes[i] - 1 : null);

/**
 * Historical record of the given signal kinds on this ticker, using only
 * signals whose TESTED_H-bar outcome was complete by bar `asOf`.
 */
export function tested(prep, kinds, asOf, h = TESTED_H) {
  const rets = [];
  for (const [i, list] of prep.byIndex) {
    if (i + h > asOf) continue;
    if (!list.some((s) => kinds.has(s.kind))) continue;
    rets.push(prep.closes[i + h] / prep.closes[i] - 1);
  }
  if (!rets.length) return { n: 0, avg: null, pctUp: null };
  return {
    n: rets.length,
    avg: rets.reduce((a, b) => a + b, 0) / rets.length,
    pctUp: rets.filter((r) => r > 0).length / rets.length,
  };
}

/** Observations about bar i, all from bars 0..i. */
export function notes(prep, i) {
  const out = [];
  const b = prep.bars[i];
  const p = prep.bars[i - 1];
  if (!p) return out;
  if (b.open > p.high && b.close < b.open) out.push({ text: 'Gapped up, then faded', tone: 'bear' });
  if (b.open < p.low && b.close > b.open) out.push({ text: 'Gapped down, then recovered', tone: 'bull' });
  const chg = b.close / p.close - 1;
  const atr = prep.atr[i - 1];
  if (atr && Math.abs(b.close - p.close) > 2 * atr) out.push({ text: `Move ${(Math.abs(b.close - p.close) / atr).toFixed(1)}× ATR`, tone: chg > 0 ? 'bull' : 'bear' });
  const vr = prep.vol20[i - 1] ? b.volume / prep.vol20[i - 1] : null;
  if (vr && vr >= 2) out.push({ text: `Volume ${vr.toFixed(1)}× avg`, tone: 'info' });
  if (prep.hh20[i] !== null && b.close >= prep.hh20[i] * 0.99) out.push({ text: 'At 20-day high', tone: 'bull' });
  if (prep.ll20[i] !== null && b.close <= prep.ll20[i] * 1.01) out.push({ text: 'At 20-day low', tone: 'bear' });
  return out;
}

/**
 * Tier, from signals on the day and the stance score. Descriptive only.
 *   bullish: a bullish signal, stance ≥ +15, no bearish signal that day
 *   bearish: a bearish signal, stance ≤ −15, no bullish signal that day
 *   mixed:   signals that disagree with each other or with the stance
 *   watch:   no directional signal, but an unusual move or volume
 *   quiet:   nothing notable
 */
export function tierFor(signals, stance, noteList) {
  const bull = signals.some((s) => BULLISH_KINDS.has(s.kind) || s.tone === 'bull');
  const bear = signals.some((s) => BEARISH_KINDS.has(s.kind) || s.tone === 'bear');
  if (bull && !bear && stance !== null && stance >= 15) return 'bullish';
  if (bear && !bull && stance !== null && stance <= -15) return 'bearish';
  if (bull || bear) return 'mixed';
  if (noteList.some((n) => /ATR|Volume/.test(n.text))) return 'watch';
  return 'quiet';
}

export function row(prep, i, meta) {
  const b = prep.bars[i];
  const p = prep.bars[i - 1];
  const signals = prep.byIndex.get(i) || [];
  const stance = prep.stance[i];
  const noteList = notes(prep, i);
  const kinds = new Set(signals.map((s) => s.kind));
  return {
    ...meta,
    date: b.time,
    close: b.close,
    change: p ? b.close / p.close - 1 : null,
    stance,
    stanceLabel: stance === null ? null : labelFor(stance).label,
    rsi: prep.rsi[i],
    signals,
    notes: noteList,
    tier: tierFor(signals, stance, noteList),
    tested: signals.length ? tested(prep, kinds, i) : { n: 0, avg: null, pctUp: null },
    spark: prep.closes.slice(Math.max(0, i - 19), i + 1),
    forward: Object.fromEntries(HORIZONS.map((h) => [h, fwd(prep.closes, i, h)])),
  };
}

/**
 * Breadth across stock rows (ETFs excluded).
 * Washed-out sector: at least 3 members, median change ≤ −2%, ≥ 70% down.
 * Score 0–100 = 60 × min(1, share down ≥3% ÷ 30%) + 40 × share of sectors washed out.
 */
export function breadth(rows) {
  const stocks = rows.filter((r) => r.sector !== 'ETF' && r.change !== null);
  if (!stocks.length) return null;
  const down3 = stocks.filter((r) => r.change <= -0.03).length / stocks.length;
  const up = stocks.filter((r) => r.change > 0).length / stocks.length;
  const bySector = new Map();
  for (const r of stocks) {
    if (!bySector.has(r.sector)) bySector.set(r.sector, []);
    bySector.get(r.sector).push(r.change);
  }
  const sectors = [...bySector.entries()].map(([sector, ch]) => {
    const sorted = [...ch].sort((a, b) => a - b);
    const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const downShare = ch.filter((c) => c < 0).length / ch.length;
    return { sector, n: ch.length, median: mid, downShare, washed: ch.length >= 3 && mid <= -0.02 && downShare >= 0.7 };
  }).sort((a, b) => a.median - b.median);
  const eligible = sectors.filter((s) => s.n >= 3);
  const washedShare = eligible.length ? eligible.filter((s) => s.washed).length / eligible.length : 0;
  const score = Math.round(60 * Math.min(1, down3 / 0.3) + 40 * washedShare);
  return { n: stocks.length, down3, up, sectors, washedShare, score };
}

/** Average forward return per tier (and for all stocks) where outcomes exist. */
export function tierOutcomes(rows, h) {
  const groups = {};
  for (const r of rows) {
    if (r.sector === 'ETF') continue;
    const v = r.forward[h];
    if (v === null) continue;
    for (const k of [r.tier, 'all']) {
      (groups[k] ||= []).push(v);
    }
  }
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, {
    n: v.length,
    avg: v.reduce((a, b) => a + b, 0) / v.length,
    pctUp: v.filter((x) => x > 0).length / v.length,
  }]));
}
