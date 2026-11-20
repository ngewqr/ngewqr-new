import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vixSummary, percentileRank, regimeFor } from '../src/analysis/vix.js';

const bars = (closes) => closes.map((c, i) => ({ time: `2026-01-${String(i + 1).padStart(2, '0')}`, open: c, high: c, low: c, close: c, volume: 0 }));
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('regimes', () => {
  assert.equal(regimeFor(12).label, 'Calm');
  assert.equal(regimeFor(15).label, 'Normal');
  assert.equal(regimeFor(20).label, 'Elevated');
  assert.equal(regimeFor(30).label, 'Stressed');
});

test('percentile rank excludes the latest close', () => {
  near(percentileRank([10, 20, 30, 40, 25], 4), 2 / 4);
  near(percentileRank([10, 20, 30, 40, 50], 4), 1);
  near(percentileRank([10, 20, 30, 40, 5], 4), 0);
});

test('summary: change, 20-day average, term structure', () => {
  const closes = [...Array(19).fill(15), 20, 24];
  const s = vixSummary(bars(closes), bars([26]), bars([22]));
  near(s.last, 24);
  near(s.change, 4);
  near(s.changePct, 0.2);
  near(s.avg20, (18 * 15 + 20 + 24) / 20);
  near(s.vsAvg, 24 / s.avg20 - 1);
  assert.equal(s.regime.label, 'Elevated');
  assert.equal(s.term.state, 'inverted');
  near(s.term.ratio, 24 / 22);
  assert.equal(vixSummary(bars([...Array(19).fill(15), 15, 14]), [], bars([16])).term.state, 'normal');
  assert.equal(vixSummary(bars(Array(10).fill(15))), null);
});
