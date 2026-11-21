// VIX context: level vs its own history and the term structure. Pure.
// Describes conditions; it is not a forecast or a recommendation.

export const REGIMES = [
  { max: 15, label: 'Calm', tone: 'bull' },
  { max: 20, label: 'Normal', tone: 'info' },
  { max: 30, label: 'Elevated', tone: 'warn' },
  { max: Infinity, label: 'Stressed', tone: 'bear' },
];

export const regimeFor = (v) => REGIMES.find((r) => v < r.max);

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Share (0..1) of the trailing `n` closes strictly below the latest close. */
export function percentileRank(closes, n = 252) {
  if (closes.length < 2) return null;
  const last = closes.at(-1);
  const window = closes.slice(-n - 1, -1);
  return window.filter((c) => c < last).length / window.length;
}

/**
 * @param vix daily bars for ^VIX (needs ≥ 21 bars)
 * @param vix9d / vix3m daily bars for ^VIX9D / ^VIX3M (optional)
 */
export function vixSummary(vix, vix9d = [], vix3m = []) {
  if (vix.length < 21) return null;
  const closes = vix.map((b) => b.close);
  const last = closes.at(-1);
  const prev = closes.at(-2);
  const avg20 = mean(closes.slice(-20));
  const year = closes.slice(-252);
  const lastOf = (bars) => (bars.length ? bars.at(-1).close : null);
  const v9 = lastOf(vix9d);
  const v3m = lastOf(vix3m);
  let term = null;
  if (v3m) {
    const ratio = last / v3m;
    term = {
      vix9d: v9,
      vix3m: v3m,
      ratio,
      state: ratio > 1 ? 'inverted' : ratio > 0.95 ? 'flat' : 'normal',
      text: ratio > 1
        ? 'inverted: near-term fear priced above 3-month'
        : ratio > 0.95 ? 'flat: little gap between near-term and 3-month' : 'normal upward slope: no near-term stress priced',
    };
  }
  return {
    time: vix.at(-1).time,
    last,
    change: last - prev,
    changePct: last / prev - 1,
    avg20,
    vsAvg: last / avg20 - 1,
    percentile: percentileRank(closes, 252),
    high52: Math.max(...year),
    low52: Math.min(...year),
    regime: regimeFor(last),
    term,
  };
}
