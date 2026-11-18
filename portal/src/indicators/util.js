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
