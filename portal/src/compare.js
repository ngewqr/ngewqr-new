// Compare mode: % return overlay rebased at the first common visible timestamp.

const key = (t) => String(t);

/**
 * @param {Array<{symbol, bars}>} list  visible-window bars per ticker, primary first
 * @returns {{ start, series: Array<{symbol, data: [{time, value}]}> }}
 */
export function rebase(list) {
  if (!list.length) return { start: null, series: [] };
  const sets = list.map((s) => new Set(s.bars.map((b) => key(b.time))));
  const common = list[0].bars.find((b) => sets.every((set) => set.has(key(b.time))));
  if (!common) return { start: null, series: list.map((s) => ({ symbol: s.symbol, data: [] })) };
  const start = common.time;
  const series = list.map((s) => {
    const i0 = s.bars.findIndex((b) => key(b.time) === key(start));
    const base = s.bars[i0].close;
    return {
      symbol: s.symbol,
      data: s.bars.slice(i0).map((b) => ({ time: b.time, value: (b.close / base - 1) * 100 })),
    };
  });
  return { start, series };
}

/** Total return, max drawdown and annualized volatility from per-bar closes. */
export function stats(bars, barsPerYear) {
  if (bars.length < 2) return { totalReturn: null, maxDrawdown: null, volatility: null };
  const closes = bars.map((b) => b.close);
  const totalReturn = (closes.at(-1) / closes[0] - 1) * 100;
  let peak = closes[0];
  let mdd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    mdd = Math.min(mdd, c / peak - 1);
  }
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  let volatility = null;
  if (rets.length >= 2) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(barsPerYear) * 100;
  }
  return { totalReturn, maxDrawdown: mdd * 100, volatility };
}
