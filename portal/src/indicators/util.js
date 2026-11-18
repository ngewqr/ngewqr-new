// Shared helpers for indicator modules. All pure.

/** Convert an index-aligned value array (null = no value) to chart points. */
export function toPoints(bars, values, extra) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    out.push(extra ? { time: bars[i].time, value: v, ...extra(i) } : { time: bars[i].time, value: v });
  }
  return out;
}

/** Last non-null value in an aligned array, or null. */
export function lastValue(values) {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null && values[i] !== undefined) return values[i];
  }
  return null;
}

export const closesOf = (bars) => bars.map((b) => b.close);

export function fmt(v, dp = 2) {
  return v === null || v === undefined ? 'n/a' : v.toFixed(dp);
}

/** Rolling mean over an aligned array that may start with nulls. */
export function rollingMean(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) { sum = 0; count = 0; continue; }
    sum += v;
    count++;
    if (count > n) sum -= values[i - n];
    if (count >= n) out[i] = sum / n;
  }
  return out;
}

/** Highest high / lowest low over the trailing n bars (inclusive). */
export function rollingHighLow(bars, n) {
  const hh = new Array(bars.length).fill(null);
  const ll = new Array(bars.length).fill(null);
  for (let i = n - 1; i < bars.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (bars[j].high > h) h = bars[j].high;
      if (bars[j].low < l) l = bars[j].low;
    }
    hh[i] = h;
    ll[i] = l;
  }
  return { hh, ll };
}
