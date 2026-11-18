// Historical forward returns after each signal kind. This deliberately looks
// at bars AFTER each signal: it is an after-the-fact evaluation of the
// history, never an input to any signal or indicator.

export const HORIZONS = [5, 10, 20];

const indexByTime = (bars) => new Map(bars.map((b, i) => [String(b.time), i]));

function forward(bars, i, h) {
  return i + h < bars.length ? bars[i + h].close / bars[i].close - 1 : null;
}

function summarize(rets) {
  if (!rets.length) return { n: 0, avg: null, pctUp: null };
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  return { n: rets.length, avg: avg * 100, pctUp: (rets.filter((r) => r > 0).length / rets.length) * 100 };
}

/** Baseline: forward returns from every bar, for comparison. */
export function baseline(bars, horizons = HORIZONS) {
  return Object.fromEntries(horizons.map((h) => {
    const rets = [];
    for (let i = 0; i < bars.length; i++) { const r = forward(bars, i, h); if (r !== null) rets.push(r); }
    return [h, summarize(rets)];
  }));
}

/** Per signal kind: count and forward-return stats at each horizon. */
export function scorecard(bars, signals, horizons = HORIZONS) {
  const idx = indexByTime(bars);
  const byKind = new Map();
  for (const s of signals) {
    const i = idx.get(String(s.time));
    if (i === undefined) continue;
    if (!byKind.has(s.kind)) byKind.set(s.kind, { kind: s.kind, label: s.label, tone: s.tone, indices: [] });
    byKind.get(s.kind).indices.push(i);
  }
  return [...byKind.values()].map((k) => ({
    kind: k.kind,
    label: k.label.replace(/\s*\(.*\)$/, '').replace(/ \d+(\.\d+)?× .*$/, ' spike'),
    tone: k.tone,
    count: k.indices.length,
    stats: Object.fromEntries(horizons.map((h) => [h, summarize(k.indices.map((i) => forward(bars, i, h)).filter((r) => r !== null))])),
  })).sort((a, b) => b.count - a.count);
}

/** Forward-return stats for bars matching a predicate on an aligned array. */
export function conditionalStats(bars, predicate, horizons = HORIZONS) {
  return Object.fromEntries(horizons.map((h) => {
    const rets = [];
    for (let i = 0; i < bars.length; i++) {
      if (!predicate(i)) continue;
      const r = forward(bars, i, h);
      if (r !== null) rets.push(r);
    }
    return [h, summarize(rets)];
  }));
}
