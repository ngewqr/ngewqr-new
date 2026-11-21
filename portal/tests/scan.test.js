import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, row, tested, tierFor, breadth, tierOutcomes, notes } from '../src/analysis/scan.js';

const DAILY = JSON.parse(readFileSync(new URL('./fixtures/synthetic-daily.json', import.meta.url), 'utf8'));
const near = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);
const bar = (i, o, h, l, c, v = 100) => ({ time: i, open: o, high: h, low: l, close: c, volume: v });

test('a past-date scan equals a scan run on that day (no look-ahead)', () => {
  const full = prepare(DAILY);
  for (const i of [230, 400, 520, 580]) {
    const then = prepare(DAILY.slice(0, i + 1));
    const a = row(full, i, { symbol: 'X', sector: 'S' });
    const b = row(then, i, { symbol: 'X', sector: 'S' });
    const strip = (r) => ({ ...r, forward: null });
    assert.deepEqual(strip(a), strip(b), `bar ${i}`);
    assert.ok(Object.values(b.forward).every((v) => v === null), 'no outcomes known on the day');
  }
  const r = row(full, 500, { symbol: 'X', sector: 'S' });
  near(r.forward[5], DAILY[505].close / DAILY[500].close - 1);
});

test('tested stats only use outcomes complete by the scan date', () => {
  const closes = [100, 110, 100, 120, 100, 130, 100, 140];
  const bars = closes.map((c, i) => bar(i, c, c, c, c));
  const prep = { closes, byIndex: new Map([[0, [{ kind: 'k' }]], [2, [{ kind: 'k' }]], [5, [{ kind: 'k' }]]]) };
  const t = tested(prep, new Set(['k']), 4, 2); // signal at 2 needs bar 4: allowed; signal at 5 not yet
  assert.equal(t.n, 2);
  near(t.avg, ((100 / 100 - 1) + (100 / 100 - 1)) / 2);
  assert.equal(tested(prep, new Set(['k']), 3, 2).n, 1);
  assert.equal(tested(prep, new Set(['other']), 7, 2).n, 0);
  void bars;
});

test('tiers', () => {
  const s = (kind, tone) => ({ kind, tone });
  assert.equal(tierFor([s('macd-cross-up', 'bull')], 30, []), 'bullish');
  assert.equal(tierFor([s('macd-cross-up', 'bull')], 0, []), 'mixed');
  assert.equal(tierFor([s('macd-cross-up', 'bull'), s('bearish-divergence', 'bear')], 40, []), 'mixed');
  assert.equal(tierFor([s('death-cross', 'bear')], -40, []), 'bearish');
  assert.equal(tierFor([], 50, [{ text: 'Volume 3.0× avg' }]), 'watch');
  assert.equal(tierFor([], 50, [{ text: 'At 20-day high' }]), 'quiet');
});

test('notes: gap and fade, volume, ATR move', () => {
  const bars = [];
  for (let i = 0; i < 30; i++) bars.push(bar(i, 100, 101, 99, 100, 1000));
  bars.push(bar(30, 103, 104, 99.5, 100.5, 3000)); // gap above prior high, closes below open, 3× volume
  const n = notes(prepare(bars), 30).map((x) => x.text);
  assert.ok(n.includes('Gapped up, then faded'), n.join(','));
  assert.ok(n.some((t) => t.startsWith('Volume 3.0×')), n.join(','));
  bars.push(bar(31, 100, 112, 100, 111, 1000));
  assert.ok(notes(prepare(bars), 31).some((x) => /× ATR/.test(x.text)));
});

test('breadth and tier outcomes', () => {
  const r = (sector, change, tier = 'quiet', f5 = null) => ({ sector, change, tier, forward: { 5: f5 } });
  const rows = [
    r('A', -0.05), r('A', -0.04), r('A', -0.03), r('A', 0.01),
    r('B', 0.01), r('B', 0.02), r('B', -0.01),
    r('ETF', -0.10),
  ];
  const b = breadth(rows);
  assert.equal(b.n, 7);
  near(b.down3, 3 / 7);
  assert.equal(b.sectors[0].sector, 'A');
  assert.equal(b.sectors[0].washed, true); // median −3.5%, 75% down
  assert.equal(b.sectors[1].washed, false);
  near(b.washedShare, 0.5);
  assert.equal(b.score, Math.round(60 * 1 + 40 * 0.5));
  const o = tierOutcomes([r('A', 0, 'bullish', 0.02), r('A', 0, 'bullish', -0.01), r('B', 0, 'quiet', 0.04), r('ETF', 0, 'bullish', 0.5), r('B', 0, 'quiet', null)], 5);
  assert.equal(o.bullish.n, 2);
  near(o.bullish.avg, 0.005);
  assert.equal(o.all.n, 3);
});
