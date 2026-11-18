import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ncdf, bsm, secondsToExpiry, atmIv, atmStraddle, expectedMove, historicalVol,
  putCallRatio, maxPain, liquidity, defaultExpiry, analyzeChain,
} from '../src/analysis/options-math.js';
import { normalizeOptions } from '../../worker/src/normalize.js';

const near = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const opt = (strike, o = {}) => ({ strike, bid: 1, ask: 1.1, last: 1.05, volume: 0, openInterest: 0, iv: 0.3, ...o });

test('normal cdf', () => {
  near(ncdf(0), 0.5, 1e-7);
  near(ncdf(1.96), 0.9750021, 1e-6);
  near(ncdf(-1), 0.1586553, 1e-6);
});

test('Black-Scholes matches the textbook example (S=49, K=50, r=5%, σ=20%, 20 weeks)', () => {
  const T = 0.3846;
  const c = bsm('call', 49, 50, T, 0.2, 0.05, 0);
  near(c.price, 2.40, 0.005, 'price');
  near(c.delta, 0.522, 0.001, 'delta');
  near(c.gamma, 0.066, 0.001, 'gamma');
  near(c.vega, 0.121, 0.001, 'vega per vol point');
  near(c.theta * 365, -4.31, 0.01, 'theta per year');
  const p = bsm('put', 49, 50, T, 0.2, 0.05, 0);
  near(p.delta, c.delta - 1, 1e-9, 'put delta');
  // put-call parity with dividends
  const cq = bsm('call', 100, 95, 0.5, 0.35, 0.04, 0.02);
  const pq = bsm('put', 100, 95, 0.5, 0.35, 0.04, 0.02);
  near(cq.price - pq.price, 100 * Math.exp(-0.02 * 0.5) - 95 * Math.exp(-0.04 * 0.5), 1e-6, 'parity');
  assert.equal(bsm('call', 100, 100, 0, 0.2), null);
});

test('time to expiry uses 16:00 New York, including daylight saving', () => {
  const dec = Date.UTC(2026, 11, 18) / 1000; // EST → 21:00 UTC
  assert.equal(secondsToExpiry(dec, dec), 21 * 3600);
  const jul = Date.UTC(2026, 6, 17) / 1000; // EDT → 20:00 UTC
  assert.equal(secondsToExpiry(jul, jul), 20 * 3600);
});

test('ATM IV interpolates between strikes around spot', () => {
  const calls = [opt(95, { iv: 0.30 }), opt(100, { iv: 0.26 }), opt(105, { iv: 0.24 })];
  const puts = [opt(95, { iv: 0.34 }), opt(100, { iv: 0.30 }), opt(105, { iv: 0.26 })];
  near(atmIv(calls, puts, 100), 0.28, 1e-12);
  near(atmIv(calls, puts, 102.5), (0.28 + 0.25) / 2, 1e-12);
  // placeholder IVs and no-bid contracts are ignored
  near(atmIv([opt(100, { iv: 0.00001 }), opt(105, { iv: 0.2 })], [opt(100, { bid: 0, iv: 0.9 })], 101), 0.2, 1e-12);
});

test('straddle, expected move, historical vol', () => {
  const s = atmStraddle([opt(95, { bid: 6, ask: 6.2 }), opt(100, { bid: 3, ask: 3.2 })], [opt(95, { bid: 1, ask: 1.2 }), opt(100, { bid: 2.8, ask: 3 })], 99);
  assert.equal(s.strike, 100);
  near(s.price, 3.1 + 2.9, 1e-12);
  near(expectedMove(100, 0.2, 0.25), 10, 1e-12);
  const closes = [100, 101, 99, 102, 100];
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const m = r.reduce((a, b) => a + b) / 4;
  const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / 3);
  near(historicalVol(closes, 4), sd * Math.sqrt(252), 1e-12);
  assert.equal(historicalVol(closes, 10), null);
});

test('put/call ratio and max pain', () => {
  const calls = [opt(90, { volume: 10, openInterest: 100 }), opt(100, { volume: 30, openInterest: 300 }), opt(110, { volume: 60, openInterest: 600 })];
  const puts = [opt(90, { volume: 50, openInterest: 500 }), opt(100, { volume: 20, openInterest: 200 }), opt(110, { volume: 10, openInterest: 100 })];
  const pcr = putCallRatio(calls, puts);
  near(pcr.volume, 80 / 100, 1e-12);
  near(pcr.openInterest, 800 / 1000, 1e-12);
  // pain(90)=puts:0 + calls:0 → only puts above 90 owe: 100→200*10 + 110→100*20 = 4000
  // pain(100)= calls 90:100*10=1000 + puts 110:100*10=1000 → 2000
  // pain(110)= calls 90:100*20 + 100:300*10 = 5000
  assert.equal(maxPain(calls, puts), 100);
  assert.equal(maxPain([opt(100)], [opt(100)]), null);
});

test('liquidity flags', () => {
  assert.equal(liquidity(opt(100, { bid: 1, ask: 1.05, openInterest: 500 })).thin, false);
  assert.deepEqual(liquidity(opt(100, { bid: 1, ask: 1.5, openInterest: 500 })).reasons, ['spread 40%']);
  assert.deepEqual(liquidity(opt(100, { bid: 0, ask: 0.1, openInterest: 5 })).reasons, ['no two-sided quote', 'OI 5']);
});

test('default expiry is nearest to 30 days, at least 7', () => {
  const now = Date.UTC(2026, 10, 18) / 1000;
  const d = (days) => now + days * 86400 - 21 * 3600;
  assert.equal(defaultExpiry([d(0), d(2), d(9), d(30), d(58)], now), d(30));
  assert.equal(defaultExpiry([d(0), d(2), d(9), d(58)], now), d(9));
  assert.equal(defaultExpiry([d(0), d(2)], now), d(2));
});

test('normalizeOptions + analyzeChain end to end', () => {
  const now = Date.UTC(2026, 10, 18, 15) / 1000;
  const exp = Date.UTC(2026, 11, 18) / 1000;
  const raw = {
    optionChain: {
      result: [{
        underlyingSymbol: 'X',
        expirationDates: [exp],
        quote: { regularMarketPrice: 100, regularMarketTime: now, currency: 'USD', exchangeTimezoneName: 'America/New_York', trailingAnnualDividendYield: 0.01, earningsTimestamp: now - 86400 * 20, earningsTimestampStart: now + 86400 * 10, isEarningsDateEstimate: true },
        options: [{
          expirationDate: exp,
          calls: [95, 100, 105].map((k) => ({ contractSymbol: `C${k}`, strike: k, lastPrice: 3, bid: 2.9, ask: 3.1, volume: 10, openInterest: 200, impliedVolatility: 0.3, inTheMoney: k < 100 })),
          puts: [95, 100, 105].map((k) => ({ contractSymbol: `P${k}`, strike: k, lastPrice: 3, bid: 2.9, ask: 3.1, volume: 5, openInterest: 100, impliedVolatility: 0.3, inTheMoney: k > 100 })),
        }],
      }],
    },
  };
  const chain = normalizeOptions(raw);
  assert.deepEqual(chain.underlying.nextEarnings, { time: now + 86400 * 10, estimate: true });
  const closes = Array.from({ length: 80 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i)));
  const a = analyzeChain(chain, closes, { now });
  near(a.atmIv, 0.3, 1e-12);
  near(a.dte, (exp + 21 * 3600 - now) / 86400, 1e-9);
  near(a.expectedMove, 100 * 0.3 * Math.sqrt(a.T), 1e-9);
  assert.equal(a.earnings.beforeExpiry, true);
  assert.ok(a.calls.every((c) => c.greeks && c.greeks.delta > 0 && c.greeks.delta < 1));
  assert.ok(a.puts.every((p) => p.greeks.delta < 0));
  near(a.pcr.volume, 0.5, 1e-12);
  assert.ok(a.hv20 > 0 && a.hv60 > 0 && a.ivHv > 0);
});
