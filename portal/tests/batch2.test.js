import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adxValues } from '../src/indicators/adx.js';
import { stochasticValues } from '../src/indicators/stochastic.js';
import { obvValues } from '../src/indicators/obv.js';
import { squeezeValues } from '../src/indicators/squeeze.js';
import { bollingerValues } from '../src/indicators/bollinger.js';
import { trueRange } from '../src/indicators/atr.js';
import { scorecard, baseline } from '../src/analysis/scorecard.js';
import { stanceSeries, currentStance, labelFor } from '../src/analysis/stance.js';

const DAILY = JSON.parse(readFileSync(new URL('./fixtures/synthetic-daily.json', import.meta.url), 'utf8'));
const near = (a, b, dp = 4) => assert.ok(Math.abs(a - b) < 0.5 * 10 ** -dp, `expected ${b}, got ${a}`);
const bar = (i, o, h, l, c, v = 100) => ({ time: i, open: o, high: h, low: l, close: c, volume: v });

test('ADX matches an independent average-form Wilder implementation', () => {
  const n = 14;
  const { plusDI, minusDI, adx } = adxValues(DAILY, n);
  // Reference: Wilder averages (avg = (prev·(n−1) + x)/n) instead of running sums.
  let aTR, aP, aM; const dx = [];
  const ref = { p: [], m: [], adx: [] };
  for (let i = 1; i < DAILY.length; i++) {
    const b = DAILY[i], p = DAILY[i - 1];
    const up = b.high - p.high, dn = p.low - b.low;
    const pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close));
    if (i < n) { aTR = (aTR || 0) + tr; aP = (aP || 0) + pdm; aM = (aM || 0) + mdm; continue; }
    if (i === n) { aTR = (aTR + tr) / n; aP = (aP + pdm) / n; aM = (aM + mdm) / n; } else {
      aTR = (aTR * (n - 1) + tr) / n; aP = (aP * (n - 1) + pdm) / n; aM = (aM * (n - 1) + mdm) / n;
    }
    ref.p[i] = 100 * aP / aTR; ref.m[i] = 100 * aM / aTR;
    dx[i] = 100 * Math.abs(ref.p[i] - ref.m[i]) / (ref.p[i] + ref.m[i]);
  }
  let a;
  for (let i = 2 * n - 1; i < DAILY.length; i++) {
    a = i === 2 * n - 1 ? dx.slice(n, i + 1).reduce((s, x) => s + x, 0) / n : (a * (n - 1) + dx[i]) / n;
    ref.adx[i] = a;
  }
  for (const i of [14, 27, 28, 100, 599]) {
    near(plusDI[i], ref.p[i]); near(minusDI[i], ref.m[i]);
    if (i >= 27) near(adx[i], ref.adx[i]);
  }
  assert.equal(adx[26], null);
  assert.ok(adx.every((v) => v === null || (v >= 0 && v <= 100)));
});

test('ADX: steady uptrend → +DI leads, ADX high', () => {
  const bars = Array.from({ length: 60 }, (_, i) => bar(i, 100 + i, 101 + i, 99.5 + i, 100.8 + i));
  const { plusDI, minusDI, adx } = adxValues(bars);
  assert.ok(plusDI.at(-1) > minusDI.at(-1));
  assert.ok(adx.at(-1) > 50);
});

test('Stochastic hand-checked', () => {
  // n=3, smooth 1/1 → raw %K. HH/LL over 3 bars.
  const bars = [bar(0, 0, 10, 8, 9), bar(1, 0, 12, 9, 11), bar(2, 0, 11, 7, 10), bar(3, 0, 13, 10, 13)];
  const { k } = stochasticValues(bars, 3, 1, 1);
  assert.deepEqual(k.slice(0, 2), [null, null]);
  near(k[2], 100 * (10 - 7) / (12 - 7)); // 60
  near(k[3], 100 * (13 - 7) / (13 - 7)); // 100
  const flat = stochasticValues([bar(0, 5, 5, 5, 5), bar(1, 5, 5, 5, 5), bar(2, 5, 5, 5, 5)], 3, 1, 1);
  assert.equal(flat.k[2], 50);
});

test('OBV hand-checked', () => {
  const bars = [bar(0, 0, 0, 0, 10, 100), bar(1, 0, 0, 0, 11, 200), bar(2, 0, 0, 0, 11, 50), bar(3, 0, 0, 0, 9, 300)];
  assert.deepEqual(obvValues(bars), [0, 200, 200, -100]);
});

test('Squeeze on/off matches an independent Bollinger-inside-Keltner check', () => {
  const { on } = squeezeValues(DAILY);
  const closes = DAILY.map((b) => b.close);
  const bb = bollingerValues(closes, 20, 2);
  const tr = trueRange(DAILY);
  let checked = 0;
  for (const i of [19, 50, 200, 450, 599]) {
    const mid = closes.slice(i - 19, i + 1).reduce((a, b) => a + b) / 20;
    const rng = tr.slice(i - 19, i + 1).reduce((a, b) => a + b) / 20;
    assert.equal(on[i], bb.upper[i] < mid + 1.5 * rng && bb.lower[i] > mid - 1.5 * rng, `bar ${i}`);
    checked++;
  }
  assert.equal(checked, 5);
  assert.ok(on.some((x) => x === true) && on.some((x) => x === false));
});

test('Scorecard forward returns hand-checked', () => {
  const closes = [100, 110, 99, 120, 90, 100];
  const bars = closes.map((c, i) => bar(i, c, c, c, c));
  const sig = [{ time: 0, kind: 'x', label: 'X', tone: 'info' }, { time: 2, kind: 'x', label: 'X', tone: 'info' }, { time: 5, kind: 'x', label: 'X', tone: 'info' }];
  const [row] = scorecard(bars, sig, [1, 3]);
  assert.equal(row.count, 3);
  assert.equal(row.stats[1].n, 2); // bar 5 has no forward bar
  near(row.stats[1].avg, ((110 / 100 - 1) + (120 / 99 - 1)) / 2 * 100);
  near(row.stats[1].pctUp, 100);
  near(row.stats[3].avg, ((120 / 100 - 1) + (100 / 99 - 1)) / 2 * 100);
  assert.equal(baseline(bars, [1])[1].n, 5);
});

test('Stance labels and extremes', () => {
  assert.equal(labelFor(80).label, 'Strong bullish');
  assert.equal(labelFor(15).label, 'Bullish');
  assert.equal(labelFor(0).label, 'Neutral');
  assert.equal(labelFor(-15).label, 'Neutral');
  assert.equal(labelFor(-16).label, 'Bearish');
  assert.equal(labelFor(-90).label, 'Strong bearish');
  const up = Array.from({ length: 260 }, (_, i) => { const c = 100 * 1.004 ** i; return bar(i, c * 0.998, c * 1.006, c * 0.995, c, 1000 + i); });
  const down = up.map((b, i) => { const c = 100 * 0.996 ** i; return bar(i, c * 1.002, c * 1.005, c * 0.994, c, 1000 + i); });
  assert.equal(currentStance(up).label, 'Strong bullish');
  assert.equal(currentStance(down).label, 'Strong bearish');
  assert.equal(currentStance(up.slice(0, 150)), null); // SMA200 not ready
});

test('Stance series: no look-ahead, bounded', () => {
  const full = stanceSeries(DAILY).score;
  const cut = stanceSeries(DAILY.slice(0, 400)).score;
  for (let i = 0; i < 400; i++) assert.equal(cut[i], full[i]);
  assert.ok(full.every((v) => v === null || (v >= -100 && v <= 100)));
  assert.equal(currentStance(DAILY).votes.length, 9);
});

test('trading day rolls over at 18:00 New York', async () => {
  const { sessionDate, visibleStartIndex } = await import('../src/timeframes.js');
  const et = (iso) => Date.parse(iso) / 1000; // ISO with explicit offset
  assert.equal(sessionDate(et('2026-11-19T17:55:00-05:00')), '2026-11-19');
  assert.equal(sessionDate(et('2026-11-19T18:00:00-05:00')), '2026-11-20'); // futures evening session → next day
  assert.equal(sessionDate(et('2026-11-20T09:30:00-05:00')), '2026-11-20');
  assert.equal(sessionDate(et('2026-11-20T15:55:00-05:00')), '2026-11-20'); // stocks unchanged
  assert.equal(sessionDate(et('2026-07-20T15:55:00-04:00')), '2026-07-20'); // daylight saving
  // 24h bars every hour from Thu 18:00 to Fri 12:00 ET: 1D keeps the whole Friday session.
  const bars = [];
  for (let t = et('2026-11-19T12:00:00-05:00'); t <= et('2026-11-20T12:00:00-05:00'); t += 3600) bars.push({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  assert.equal(bars[visibleStartIndex(bars, '1D')].time, et('2026-11-19T18:00:00-05:00'));
});

test('XAUUSD-style aliases resolve to futures', async () => {
  const { cleanSymbol } = await import('../src/data.js');
  assert.equal(cleanSymbol('xauusd'), 'GC=F');
  assert.equal(cleanSymbol('XAU/USD'), 'GC=F');
  assert.equal(cleanSymbol('XAGUSD'), 'SI=F');
  assert.equal(cleanSymbol('aapl'), 'AAPL');
  assert.equal(cleanSymbol('GC=F'), 'GC=F');
  assert.equal(cleanSymbol('bad symbol!'), null);
});
