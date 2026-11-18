// Default signal rules. Every function is pure and look-ahead free: a signal
// at bar t uses only bars 0..t (pivot-based rules fire at the confirmation bar).

import { smaValues } from '../indicators/sma.js';
import { rsiValues } from '../indicators/rsi.js';
import { macdValues } from '../indicators/macd.js';
import { bollingerValues } from '../indicators/bollinger.js';
import { findPivots } from './levels.js';

const sig = (bars, i, kind, label, position, tone) => ({ time: bars[i].time, kind, label, position, tone });

/**
 * Index of every bar where series `a` crosses series `b`.
 * Uses the last non-zero sign of (a − b), so touching and bouncing is not a cross.
 */
export function crossings(a, b) {
  const out = [];
  let lastSign = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = typeof b === 'number' ? b : b[i];
    if (av === null || bv === null || av === undefined || bv === undefined) continue;
    const s = Math.sign(av - bv);
    if (s === 0) continue;
    if (lastSign !== 0 && s !== lastSign) out.push({ index: i, dir: s > 0 ? 'up' : 'down' });
    lastSign = s;
  }
  return out;
}

/** Golden/death cross (SMA50 vs SMA200) and close crossing SMA20/50/200. */
export function maSignals(bars, periods = [20, 50, 200]) {
  const closes = bars.map((b) => b.close);
  const ma = Object.fromEntries(periods.map((p) => [p, smaValues(closes, p)]));
  const out = [];
  if (ma[50] && ma[200]) {
    for (const x of crossings(ma[50], ma[200])) {
      out.push(x.dir === 'up'
        ? sig(bars, x.index, 'golden-cross', 'Golden cross (SMA50 > SMA200)', 'below', 'bull')
        : sig(bars, x.index, 'death-cross', 'Death cross (SMA50 < SMA200)', 'above', 'bear'));
    }
  }
  for (const p of periods) {
    for (const x of crossings(closes, ma[p])) {
      out.push(x.dir === 'up'
        ? sig(bars, x.index, `close-above-sma${p}`, `Close crossed above SMA${p}`, 'below', 'info')
        : sig(bars, x.index, `close-below-sma${p}`, `Close crossed below SMA${p}`, 'above', 'info'));
    }
  }
  return out;
}

/** RSI crossing into and back out of the overbought/oversold zones. */
export function rsiSignals(bars, rsi, upper = 70, lower = 30) {
  const out = [];
  for (const x of crossings(rsi, upper)) {
    out.push(x.dir === 'up'
      ? sig(bars, x.index, 'rsi-overbought', `RSI crossed above ${upper}`, 'above', 'warn')
      : sig(bars, x.index, 'rsi-exit-overbought', `RSI back below ${upper}`, 'above', 'info'));
  }
  for (const x of crossings(rsi, lower)) {
    out.push(x.dir === 'down'
      ? sig(bars, x.index, 'rsi-oversold', `RSI crossed below ${lower}`, 'below', 'warn')
      : sig(bars, x.index, 'rsi-exit-oversold', `RSI back above ${lower}`, 'below', 'info'));
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** MACD crossing its signal line, noting which side of zero it happened on. */
export function macdSignals(bars, macd, signal) {
  return crossings(macd, signal).map((x) => {
    const side = macd[x.index] >= 0 ? 'above zero' : 'below zero';
    return x.dir === 'up'
      ? sig(bars, x.index, 'macd-cross-up', `MACD crossed above signal (${side})`, 'below', 'bull')
      : sig(bars, x.index, 'macd-cross-down', `MACD crossed below signal (${side})`, 'above', 'bear');
  });
}

/**
 * Close outside a band (first bar outside only) and the start of a squeeze:
 * band width (upper − lower)/middle at its lowest over the trailing
 * `lookback` bars (126 ≈ 6 months of daily bars).
 */
export function bollingerSignals(bars, bb, lookback = 126) {
  const out = [];
  let prevZone = 0;
  let prevSqueeze = false;
  const width = bb.middle.map((m, i) => (m ? (bb.upper[i] - bb.lower[i]) / m : null));
  for (let i = 0; i < bars.length; i++) {
    if (bb.upper[i] === null) continue;
    const c = bars[i].close;
    const zone = c > bb.upper[i] ? 1 : c < bb.lower[i] ? -1 : 0;
    if (zone === 1 && prevZone !== 1) out.push(sig(bars, i, 'bb-above-upper', 'Close above upper Bollinger band', 'above', 'warn'));
    if (zone === -1 && prevZone !== -1) out.push(sig(bars, i, 'bb-below-lower', 'Close below lower Bollinger band', 'below', 'warn'));
    prevZone = zone;

    let squeeze = false;
    const start = i - lookback + 1;
    if (start >= 0 && width[start] !== null) {
      let min = Infinity;
      for (let j = start; j <= i; j++) min = Math.min(min, width[j]);
      squeeze = width[i] <= min;
    }
    if (squeeze && !prevSqueeze) out.push(sig(bars, i, 'bb-squeeze', `Bollinger squeeze (${lookback}-bar low width)`, 'above', 'info'));
    prevSqueeze = squeeze;
  }
  return out;
}

/** Volume above `mult` × the average of the previous `n` bars (current bar excluded). */
export function volumeSignals(bars, n = 20, mult = 2) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i >= n && sum > 0 && bars[i].volume > mult * (sum / n)) {
      out.push(sig(bars, i, 'volume-spike', `Volume ${(bars[i].volume / (sum / n)).toFixed(1)}× 20-bar avg`, 'below', 'info'));
    }
    sum += bars[i].volume;
    if (i >= n) sum -= bars[i - n].volume;
  }
  return out;
}

/**
 * RSI divergence across the last two confirmed pivots of the same type.
 * Bearish: price higher high, RSI lower high. Bullish: price lower low, RSI
 * higher low. Fires at the bar where the second pivot is confirmed.
 */
export function divergenceSignals(bars, rsi, k = 5) {
  const out = [];
  const pivots = findPivots(bars, k).sort((a, b) => a.confirmIndex - b.confirmIndex);
  const lastOf = { high: null, low: null };
  for (const p of pivots) {
    const prev = lastOf[p.type];
    lastOf[p.type] = p;
    if (!prev || rsi[prev.index] === null || rsi[p.index] === null) continue;
    if (p.type === 'high' && p.price > prev.price && rsi[p.index] < rsi[prev.index]) {
      out.push(sig(bars, p.confirmIndex, 'bearish-divergence', 'Bearish RSI divergence (higher high, lower RSI high)', 'above', 'bear'));
    }
    if (p.type === 'low' && p.price < prev.price && rsi[p.index] > rsi[prev.index]) {
      out.push(sig(bars, p.confirmIndex, 'bullish-divergence', 'Bullish RSI divergence (lower low, higher RSI low)', 'below', 'bull'));
    }
  }
  return out;
}

/** Every default rule, sorted oldest → newest. */
export function defaultSignals(bars) {
  const closes = bars.map((b) => b.close);
  const rsi = rsiValues(closes, 14);
  const { macd, signal } = macdValues(closes);
  return [
    ...maSignals(bars),
    ...rsiSignals(bars, rsi),
    ...macdSignals(bars, macd, signal),
    ...bollingerSignals(bars, bollingerValues(closes)),
    ...volumeSignals(bars),
    ...divergenceSignals(bars, rsi),
  ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}
