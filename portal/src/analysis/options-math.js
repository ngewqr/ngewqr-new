// Options analytics. All pure; no fetching, no DOM.
// Describes what the chain shows. It does not recommend trades.

export const DEFAULT_RATE = 0.04; // risk-free rate assumption (annual, continuous)
const YEAR_S = 365 * 86400;

/** Standard normal pdf. */
export const npdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Standard normal cdf via the Numerical Recipes erfc fit (fractional error < 1.2e-7). */
export function ncdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - 0.5 * r : 0.5 * r;
}

/**
 * Black-Scholes-Merton price and greeks.
 * S spot, K strike, T years, sigma annual vol, r rate, q dividend yield.
 * theta is per calendar day; vega is per 1 volatility point (0.01).
 */
export function bsm(type, S, K, T, sigma, r = DEFAULT_RATE, q = 0) {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return null;
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const pdf = npdf(d1);
  const gamma = (dq * pdf) / (S * sigma * sqT);
  const vega = (S * dq * pdf * sqT) / 100;
  const decay = -(S * dq * pdf * sigma) / (2 * sqT);
  if (type === 'call') {
    return {
      price: S * dq * ncdf(d1) - K * dr * ncdf(d2),
      delta: dq * ncdf(d1),
      gamma,
      vega,
      theta: (decay - r * K * dr * ncdf(d2) + q * S * dq * ncdf(d1)) / 365,
    };
  }
  return {
    price: K * dr * ncdf(-d2) - S * dq * ncdf(-d1),
    delta: dq * (ncdf(d1) - 1),
    gamma,
    vega,
    theta: (decay + r * K * dr * ncdf(-d2) - q * S * dq * ncdf(-d1)) / 365,
  };
}

/** UTC offset in seconds of `tz` at a given instant (e.g. −18000 for EST). */
function tzOffset(tz, unix) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(unix * 1000)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000;
  return asUtc - unix;
}

/**
 * Seconds until 16:00 exchange time on the expiry date. Yahoo's expiration
 * stamp is 00:00 UTC of the expiry date.
 */
export function secondsToExpiry(expiration, now, tz = 'America/New_York') {
  const closeLocal = expiration + 16 * 3600; // 16:00 "wall clock" on that date, as if UTC
  const close = closeLocal - tzOffset(tz, closeLocal);
  return close - now;
}

/** Year fraction to expiry, floored at one hour so same-day greeks stay finite. */
export const yearsToExpiry = (expiration, now, tz) => Math.max(secondsToExpiry(expiration, now, tz), 3600) / YEAR_S;

export const mid = (c) => (c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : null);

/** Yahoo IVs outside this range are placeholders (deep ITM, no quotes). */
export const usableIv = (iv) => typeof iv === 'number' && iv >= 0.01 && iv <= 5;

/** Liquidity read for one contract: spread % of mid and a flag with reasons. */
export function liquidity(c, { maxSpread = 0.1, minOi = 100 } = {}) {
  const m = mid(c);
  const spread = m ? (c.ask - c.bid) / m : null;
  const reasons = [];
  if (!m) reasons.push('no two-sided quote');
  else if (spread > maxSpread) reasons.push(`spread ${(spread * 100).toFixed(0)}%`);
  if ((c.openInterest ?? 0) < minOi) reasons.push(`OI ${c.openInterest ?? 0}`);
  return { spread, thin: reasons.length > 0, reasons };
}

/** At-the-money IV: call/put IVs averaged per strike, linearly interpolated at spot. */
export function atmIv(calls, puts, spot) {
  const byStrike = new Map();
  for (const c of [...calls, ...puts]) {
    if (!usableIv(c.iv) || !(c.bid > 0)) continue;
    const e = byStrike.get(c.strike) || { sum: 0, n: 0 };
    e.sum += c.iv;
    e.n += 1;
    byStrike.set(c.strike, e);
  }
  const pts = [...byStrike.entries()].map(([k, e]) => ({ k, iv: e.sum / e.n })).sort((a, b) => a.k - b.k);
  if (!pts.length) return null;
  const hi = pts.findIndex((p) => p.k >= spot);
  if (hi === 0) return pts[0].iv;
  if (hi === -1) return pts.at(-1).iv;
  const a = pts[hi - 1];
  const b = pts[hi];
  return b.k === a.k ? a.iv : a.iv + ((spot - a.k) / (b.k - a.k)) * (b.iv - a.iv);
}

/** Straddle at the strike nearest spot, using mids (falls back to last). */
export function atmStraddle(calls, puts, spot) {
  const strikes = calls.map((c) => c.strike).filter((k) => puts.some((p) => p.strike === k));
  if (!strikes.length) return null;
  const k = strikes.reduce((best, x) => (Math.abs(x - spot) < Math.abs(best - spot) ? x : best));
  const c = calls.find((x) => x.strike === k);
  const p = puts.find((x) => x.strike === k);
  const cv = mid(c) ?? c.last;
  const pv = mid(p) ?? p.last;
  if (!(cv > 0 && pv > 0)) return null;
  return { strike: k, price: cv + pv };
}

/** One-standard-deviation expected move: S × σ × √T. */
export const expectedMove = (spot, iv, T) => (spot > 0 && iv > 0 && T > 0 ? spot * iv * Math.sqrt(T) : null);

/** Annualized historical volatility from the last n close-to-close log returns (sample stdev). */
export function historicalVol(closes, n, periodsPerYear = 252) {
  if (closes.length < n + 1) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const v = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v * periodsPerYear);
}

/** Put/call ratios by volume and open interest. */
export function putCallRatio(calls, puts) {
  const sum = (xs, f) => xs.reduce((a, c) => a + (c[f] || 0), 0);
  const cv = sum(calls, 'volume');
  const cOi = sum(calls, 'openInterest');
  return {
    volume: cv ? sum(puts, 'volume') / cv : null,
    openInterest: cOi ? sum(puts, 'openInterest') / cOi : null,
  };
}

/**
 * Max pain: the strike at which the total intrinsic value owed to option
 * holders at expiry (weighted by open interest) is smallest.
 */
export function maxPain(calls, puts) {
  if (![...calls, ...puts].some((c) => c.openInterest > 0)) return null;
  const strikes = [...new Set([...calls, ...puts].map((c) => c.strike))].sort((a, b) => a - b);
  let best = null;
  for (const s of strikes) {
    let pain = 0;
    for (const c of calls) pain += (c.openInterest || 0) * Math.max(0, s - c.strike);
    for (const p of puts) pain += (p.openInterest || 0) * Math.max(0, p.strike - s);
    if (best === null || pain < best.pain) best = { strike: s, pain };
  }
  return best ? best.strike : null;
}

/** Expiry closest to `targetDays` calendar days out (at least `minDays`). */
export function defaultExpiry(expirations, now, targetDays = 30, minDays = 7, tz) {
  const days = (e) => secondsToExpiry(e, now, tz) / 86400;
  const pool = expirations.filter((e) => days(e) >= minDays);
  const list = pool.length ? pool : expirations;
  if (!list.length) return null;
  return list.reduce((best, e) => (Math.abs(days(e) - targetDays) < Math.abs(days(best) - targetDays) ? e : best));
}

/**
 * Everything the panel shows for one expiry.
 * @param chain normalized /options response
 * @param dailyCloses daily closes for historical volatility (may be empty)
 */
export function analyzeChain(chain, dailyCloses = [], { rate = DEFAULT_RATE, now } = {}) {
  const u = chain.underlying || {};
  const spot = u.price;
  const t0 = now ?? u.time ?? Math.floor(Date.now() / 1000);
  const tz = u.tz || 'America/New_York';
  const T = yearsToExpiry(chain.expiration, t0, tz);
  const q = u.dividendYield ?? 0;
  const dte = secondsToExpiry(chain.expiration, t0, tz) / 86400;

  const enrich = (type) => (c) => {
    const g = usableIv(c.iv) ? bsm(type, spot, c.strike, T, c.iv, rate, q) : null;
    return { ...c, mid: mid(c), greeks: g, liq: liquidity(c) };
  };
  const calls = chain.calls.map(enrich('call'));
  const puts = chain.puts.map(enrich('put'));

  const iv = atmIv(chain.calls, chain.puts, spot);
  const straddle = atmStraddle(chain.calls, chain.puts, spot);
  const em = expectedMove(spot, iv, T);
  const hv20 = historicalVol(dailyCloses, 20);
  const hv60 = historicalVol(dailyCloses, 60);
  const earnings = u.nextEarnings;
  const expiryClose = t0 + secondsToExpiry(chain.expiration, t0, tz);

  return {
    spot, T, dte, rate, q, calls, puts,
    atmIv: iv,
    expectedMove: em,
    range: em ? [spot - em, spot + em] : null,
    straddle,
    hv20, hv60,
    ivHv: iv && hv20 ? iv / hv20 : null,
    pcr: putCallRatio(chain.calls, chain.puts),
    maxPain: maxPain(chain.calls, chain.puts),
    earnings: earnings ? { ...earnings, beforeExpiry: earnings.time < expiryClose } : null,
  };
}
