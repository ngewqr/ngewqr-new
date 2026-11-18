import { atrValues } from '../indicators/atr.js';

/**
 * Swing pivots. A high (low) at bar i is a pivot when it is the maximum
 * (minimum) of the k bars on each side. The pivot only becomes knowable at
 * bar i + k, recorded as `confirmIndex`; consumers must not use it earlier.
 */
export function findPivots(bars, k = 5) {
  const pivots = [];
  for (let i = k; i + k < bars.length; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k && (isHigh || isLow); j++) {
      if (j === i) continue;
      // Strict on the left, non-strict on the right: equal highs pick the first.
      if (j < i ? bars[j].high >= bars[i].high : bars[j].high > bars[i].high) isHigh = false;
      if (j < i ? bars[j].low <= bars[i].low : bars[j].low < bars[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ type: 'high', index: i, confirmIndex: i + k, price: bars[i].high });
    if (isLow) pivots.push({ type: 'low', index: i, confirmIndex: i + k, price: bars[i].low });
  }
  return pivots;
}

/**
 * Support/resistance from clustered pivots.
 * - Pivots within tolMult × ATR(14) of a cluster's mean join that cluster.
 * - Level price = cluster mean. Score = Σ touch weight, weight 1 → 2 from
 *   oldest to newest bar so recent touches count more.
 * Returns the top `perSide` levels above and below the last close.
 * `atr` may be passed in (e.g. computed on a longer history); otherwise it is
 * computed from `bars`.
 */
export function supportResistance(bars, { k = 5, atrPeriod = 14, tolMult = 0.5, perSide = 3, atr } = {}) {
  if (bars.length < 2 * k + 1) return { above: [], below: [] };
  const atrNow = atr ?? atrValues(bars, atrPeriod).at(-1);
  if (!atrNow) return { above: [], below: [] };
  const tol = tolMult * atrNow;
  const last = bars.length - 1;
  const pivots = findPivots(bars, k).sort((a, b) => a.price - b.price);

  const clusters = [];
  for (const p of pivots) {
    const c = clusters.at(-1);
    if (c && Math.abs(p.price - c.sum / c.n) <= tol) {
      c.sum += p.price;
      c.n += 1;
      c.score += 1 + p.index / last;
    } else {
      clusters.push({ sum: p.price, n: 1, score: 1 + p.index / last });
    }
  }

  const close = bars[last].close;
  const levels = clusters.map((c) => ({ price: c.sum / c.n, touches: c.n, score: c.score }));
  const byScore = (a, b) => b.score - a.score || b.touches - a.touches;
  return {
    above: levels.filter((l) => l.price > close).sort(byScore).slice(0, perSide),
    below: levels.filter((l) => l.price <= close).sort(byScore).slice(0, perSide),
  };
}
