import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { smaValues } from '../src/indicators/sma.js';
import { emaValues } from '../src/indicators/ema.js';
import { rsiValues } from '../src/indicators/rsi.js';
import { macdValues } from '../src/indicators/macd.js';
import { bollingerValues } from '../src/indicators/bollinger.js';
import { atrValues } from '../src/indicators/atr.js';
import { vwapValues } from '../src/indicators/vwap.js';
import { MODULES } from '../src/indicators/index.js';
import { findPivots, supportResistance } from '../src/analysis/levels.js';
import { crossings, defaultSignals, divergenceSignals, volumeSignals } from '../src/analysis/signals.js';
import { visibleStartIndex, minusMonths, sessionDate } from '../src/timeframes.js';
import { rebase, stats } from '../src/compare.js';
import { normalizeChart } from '../../worker/src/normalize.js';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const HAND = load('hand-checked.json');
const DAILY = load('synthetic-daily.json');
const INTRADAY = load('synthetic-intraday.json');

const near = (a, b, dp = 4, msg = '') => {
  assert.ok(Math.abs(a - b) < 0.5 * 10 ** -dp + 1e-12, `${msg} expected ${b}, got ${a}`);
};
const alignedEq = (got, expected, dp = 4) => {
  assert.equal(got.length, expected.length);
  expected.forEach((e, i) => (e === null ? assert.equal(got[i], null, `index ${i}`) : near(got[i], e, dp, `index ${i}`)));
};

// ── Reference values ───────────────────────────────────────────────────────
test('SMA', () => {
  alignedEq(smaValues([1, 2, 3, 4, 5, 6], 3), [null, null, 2, 3, 4, 5]);
});

test('EMA seeded with SMA', () => {
  alignedEq(emaValues(HAND.ema3.values, 3), HAND.ema3.expected);
});

test('EMA skips leading nulls', () => {
  alignedEq(emaValues([null, null, 2, 4, 6, 8], 3), [null, null, null, null, 4, 6]);
});

test('RSI matches the Wilder worked example', () => {
  const { closes, expected } = HAND.rsi_stockcharts;
  const v = rsiValues(closes, 14);
  for (let i = 0; i < 14; i++) assert.equal(v[i], null);
  expected.forEach((e, k) => near(v[14 + k], e, 2, `RSI[${14 + k}]`));
});

test('RSI is 100 when there are no losses', () => {
  const v = rsiValues(Array.from({ length: 20 }, (_, i) => 10 + i), 14);
  assert.equal(v[14], 100);
});

test('MACD = EMA12 − EMA26, signal = EMA9(MACD)', () => {
  const closes = DAILY.map((b) => b.close);
  const { macd, signal, hist } = macdValues(closes);
  const e12 = emaValues(closes, 12);
  const e26 = emaValues(closes, 26);
  assert.equal(macd[24], null);
  near(macd[25], e12[25] - e26[25]);
  assert.equal(signal[32], null);
  const seed = macd.slice(25, 34).reduce((a, b) => a + b, 0) / 9;
  near(signal[33], seed);
  near(signal[34], 0.2 * macd[34] + 0.8 * signal[33]);
  near(hist[100], macd[100] - signal[100]);
});

test('Bollinger uses population std-dev', () => {
  const bb = bollingerValues(HAND.bollinger5.closes, 5, 2);
  near(bb.upper[4], HAND.bollinger5.upper);
  near(bb.middle[4], HAND.bollinger5.middle);
  near(bb.lower[4], HAND.bollinger5.lower);
  assert.equal(bb.upper[3], null);
});

test('ATR (Wilder)', () => {
  alignedEq(atrValues(HAND.atr3.bars, 3), HAND.atr3.expected);
});

test('VWAP resets each New York session', () => {
  alignedEq(vwapValues(HAND.vwap.bars), HAND.vwap.expected);
});

// ── Contract: every module ─────────────────────────────────────────────────
const sameAsOf = (full, trunc, lastTime) => {
  const cut = (arr) => arr.filter((x) => x.time <= lastTime);
  assert.deepEqual(cut(full), trunc);
};

for (const m of MODULES) {
  for (const [label, bars] of [['daily', DAILY], ['intraday', INTRADAY]]) {
    test(`${m.id} (${label}): no NaN/null/placeholder points, sorted times`, () => {
      const out = m.compute(bars, structuredClone(m.params));
      assert.ok(Array.isArray(out.series) && out.series.length > 0);
      for (const s of out.series) {
        let prev = null;
        for (const p of s.data) {
          assert.ok(Number.isFinite(p.value), `${s.id} has non-finite value at ${p.time}`);
          if (prev !== null) assert.ok(p.time > prev, `${s.id} times not ascending`);
          prev = p.time;
        }
      }
      assert.equal(typeof out.summary.text, 'string');
      assert.ok(!/\b(buy|sell|you should)\b/i.test(out.summary.text), 'summary must describe, not advise');
    });

    test(`${m.id} (${label}): no look-ahead`, () => {
      for (const cutAt of [60, 250, bars.length - 7]) {
        if (cutAt >= bars.length) continue;
        const truncBars = bars.slice(0, cutAt);
        const lastTime = truncBars.at(-1).time;
        const full = m.compute(bars, structuredClone(m.params));
        const trunc = m.compute(truncBars, structuredClone(m.params));
        full.series.forEach((s, i) => sameAsOf(s.data, trunc.series[i].data, lastTime));
        sameAsOf(full.signals, trunc.signals, lastTime);
      }
    });

    test(`${m.id} (${label}): pure (same input, same output; input untouched)`, () => {
      const copy = structuredClone(bars);
      const a = m.compute(bars, structuredClone(m.params));
      const b = m.compute(bars, structuredClone(m.params));
      assert.deepEqual(a, b);
      assert.deepEqual(bars, copy);
    });
  }

  test(`${m.id}: warm-up omitted`, () => {
    const out = m.compute(DAILY, structuredClone(m.params));
    for (const s of out.series) {
      if (!s.data.length) continue;
      const firstIdx = DAILY.findIndex((b) => b.time === s.data[0].time);
      assert.ok(firstIdx >= m.minBars - 1, `${s.id} starts at bar ${firstIdx}, minBars ${m.minBars}`);
    }
  });
}

test('SMA200 starts exactly at bar 199', () => {
  const sma = MODULES.find((m) => m.id === 'sma').compute(DAILY, { periods: [200] });
  assert.equal(sma.series[0].data[0].time, DAILY[199].time);
});

// ── Signals & levels ───────────────────────────────────────────────────────
test('crossings ignores touches', () => {
  assert.deepEqual(crossings([1, 2, 3, 2, 3, 1], 2), [{ index: 2, dir: 'up' }, { index: 5, dir: 'down' }]);
  assert.deepEqual(crossings([1, 3, 1], [2, 2, 2]), [{ index: 1, dir: 'up' }, { index: 2, dir: 'down' }]);
});

test('volume spike excludes the current bar from the average', () => {
  const bars = Array.from({ length: 22 }, (_, i) => ({ time: i + 1, open: 1, high: 1, low: 1, close: 1, volume: 100 }));
  bars[21].volume = 201;
  const s = volumeSignals(bars, 20, 2);
  assert.equal(s.length, 1);
  assert.equal(s[0].time, 22);
});

test('pivots are confirmed k bars later', () => {
  const highs = [1, 2, 3, 4, 5, 9, 5, 4, 3, 2, 1, 1];
  const bars = highs.map((h, i) => ({ time: i, open: h, high: h, low: h - 0.5, close: h, volume: 1 }));
  const p = findPivots(bars, 5).filter((x) => x.type === 'high');
  assert.deepEqual(p.map((x) => [x.index, x.confirmIndex]), [[5, 10]]);
});

test('default signals and divergence: no look-ahead', () => {
  for (const cutAt of [150, 400, 590]) {
    const t = DAILY[cutAt - 1].time;
    sameAsOf(defaultSignals(DAILY), defaultSignals(DAILY.slice(0, cutAt)), t);
    const rsiFull = rsiValues(DAILY.map((b) => b.close));
    const rsiCut = rsiValues(DAILY.slice(0, cutAt).map((b) => b.close));
    sameAsOf(divergenceSignals(DAILY, rsiFull), divergenceSignals(DAILY.slice(0, cutAt), rsiCut), t);
  }
});

test('default signals fire on the synthetic series', () => {
  const kinds = new Set(defaultSignals(DAILY).map((s) => s.kind));
  for (const k of ['golden-cross', 'death-cross', 'rsi-overbought', 'macd-cross-up', 'volume-spike']) {
    assert.ok(kinds.has(k), `missing ${k}`);
  }
});

test('support/resistance clusters pivots and splits by last close', () => {
  const lv = supportResistance(DAILY.slice(-250));
  assert.ok(lv.above.length <= 3 && lv.below.length <= 3);
  const close = DAILY.at(-1).close;
  lv.above.forEach((l) => assert.ok(l.price > close));
  lv.below.forEach((l) => assert.ok(l.price <= close));
  [...lv.above, ...lv.below].forEach((l) => assert.ok(l.touches >= 1));
});

// ── Timeframes ─────────────────────────────────────────────────────────────
test('minusMonths clamps month ends', () => {
  assert.equal(minusMonths('2025-03-31', 1), '2025-02-28');
  assert.equal(minusMonths('2025-01-15', 12), '2024-01-15');
});

test('visible window: sessions for intraday', () => {
  const i = visibleStartIndex(INTRADAY, '1D');
  assert.equal(i, 312);
  assert.equal(sessionDate(INTRADAY[i].time), '2025-01-10');
  assert.equal(visibleStartIndex(INTRADAY, '5D'), 0);
});

test('visible window: months for daily', () => {
  const i = visibleStartIndex(DAILY, '3M');
  const last = DAILY.at(-1).time;
  assert.ok(DAILY[i].time > minusMonths(last, 3));
  assert.ok(DAILY[i - 1].time <= minusMonths(last, 3));
});

// ── Compare ────────────────────────────────────────────────────────────────
test('rebase starts at first common timestamp, no interpolation', () => {
  const a = [{ time: 1, close: 10 }, { time: 2, close: 11 }, { time: 3, close: 12 }];
  const b = [{ time: 2, close: 50 }, { time: 3, close: 55 }];
  const r = rebase([{ symbol: 'A', bars: a }, { symbol: 'B', bars: b }]);
  assert.equal(r.start, 2);
  near(r.series[0].data[0].value, 0);
  near(r.series[0].data[1].value, (12 / 11 - 1) * 100);
  near(r.series[1].data[1].value, 10);
});

test('compare stats', () => {
  const s = stats([{ close: 100 }, { close: 120 }, { close: 90 }, { close: 110 }], 252);
  near(s.totalReturn, 10);
  near(s.maxDrawdown, -25);
  const rets = [0.2, -0.25, 110 / 90 - 1];
  const mean = rets.reduce((x, y) => x + y) / 3;
  const sd = Math.sqrt(rets.reduce((x, r) => x + (r - mean) ** 2, 0) / 2);
  near(s.volatility, sd * Math.sqrt(252) * 100);
});

// ── Worker normalization ───────────────────────────────────────────────────
test('normalizeChart: adjusted daily bars, null drop, de-dupe', () => {
  const ts = [1735828200, 1735914600, 1736173800, 1736173900];
  const json = {
    chart: {
      result: [{
        meta: { symbol: 'X', currency: 'USD', exchangeTimezoneName: 'America/New_York' },
        timestamp: ts,
        indicators: {
          quote: [{ open: [10, 11, 12, 12.5], high: [11, 12, 13, 13], low: [9, 10, 11, 12], close: [10, null, 12, 12.6], volume: [1, 2, 3, 4] }],
          adjclose: [{ adjclose: [5, null, 6, 6.3] }],
        },
      }],
    },
  };
  const out = normalizeChart(json, '1d');
  assert.deepEqual(out.bars.map((b) => b.time), ['2025-01-02', '2025-01-06']);
  const b0 = out.bars[0];
  assert.deepEqual([b0.open, b0.high, b0.low, b0.close], [5, 5.5, 4.5, 5]);
  near(out.bars[1].close, 6.3); // later duplicate wins

  const intra = normalizeChart(json, '5m');
  assert.deepEqual(intra.bars.map((b) => b.time), [1735828200, 1736173800, 1736173900]);
  assert.equal(intra.bars[0].close, 10); // intraday is not adjusted
});

test('normalizeChart: error payload', () => {
  assert.throws(() => normalizeChart({ chart: { result: null, error: { description: 'No data found' } } }, '1d'), /No data found/);
});

test('normalizeChart: weekly live bar folds into the current week', () => {
  // 2026-11-16 (Mon) week bar, then Yahoo's live 2026-11-17 bar.
  const json = {
    chart: {
      result: [{
        meta: { symbol: 'X', exchangeTimezoneName: 'America/New_York' },
        timestamp: [1762785000, 1763389800, 1763476200],
        indicators: {
          quote: [{ open: [10, 11, 11.5], high: [12, 12, 13], low: [9, 10, 9.5], close: [11, 11.5, 12], volume: [500, 300, 120] }],
          adjclose: [{ adjclose: [11, 11.5, 12] }],
        },
      }],
    },
  };
  const out = normalizeChart(json, '1wk');
  assert.deepEqual(out.bars.map((b) => b.time), ['2025-11-10', '2025-11-17']);
  const last = out.bars[1];
  assert.deepEqual([last.open, last.high, last.low, last.close, last.volume], [11, 13, 9.5, 12, 300]);
});

test('normalizeChart: drops flat zero-volume intraday closing print', () => {
  const json = {
    chart: {
      result: [{
        meta: { symbol: 'X', exchangeTimezoneName: 'America/New_York' },
        timestamp: [1736193300, 1736193600],
        indicators: { quote: [{ open: [10, 10.5], high: [11, 10.5], low: [9, 10.5], close: [10.5, 10.5], volume: [100, 0] }] },
      }],
    },
  };
  assert.deepEqual(normalizeChart(json, '5m').bars.map((b) => b.time), [1736193300]);
});
