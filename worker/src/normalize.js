// Yahoo chart JSON → { symbol, currency, tz, bars }. Pure; shared with tests.

export const INTRADAY = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m']);

const dateFormatters = new Map();
function dateIn(tz, unixSeconds) {
  let f = dateFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(tz, f);
  }
  return f.format(new Date(unixSeconds * 1000));
}

/** True when YYYY-MM-DD `b` falls less than 7 days after week-start bar `a`. */
function sameWeek(a, b) {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) < 7 * 86400_000;
}

const ok = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Rules:
 * - Intraday `time` = UNIX seconds; daily/weekly = YYYY-MM-DD in the exchange time zone.
 * - Daily/weekly use adjusted close; O/H/L scaled by the same adjclose/close ratio.
 * - Bars with a null close are dropped; nothing is forward-filled.
 * - Times are strictly ascending; on a duplicate time the later bar wins.
 */
export function normalizeChart(json, interval) {
  const result = json?.chart?.result?.[0];
  if (!result) {
    const msg = json?.chart?.error?.description || 'No data';
    const err = new Error(msg);
    err.status = 404;
    throw err;
  }
  const meta = result.meta || {};
  const tz = meta.exchangeTimezoneName || 'America/New_York';
  const intraday = INTRADAY.has(interval);
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose;

  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (!ok(close)) continue;
    let open = ok(q.open?.[i]) ? q.open[i] : close;
    let high = ok(q.high?.[i]) ? q.high[i] : Math.max(open, close);
    let low = ok(q.low?.[i]) ? q.low[i] : Math.min(open, close);
    let c = close;
    if (!intraday && adj && ok(adj[i]) && close !== 0) {
      const r = adj[i] / close;
      open *= r;
      high *= r;
      low *= r;
      c = adj[i];
    }
    // Yahoo appends a flat, zero-volume closing print (e.g. 16:00) to intraday data: not a bar.
    if (intraday && q.volume?.[i] === 0 && open === close && high === close && low === close) continue;
    const time = intraday ? ts[i] : dateIn(tz, ts[i]);
    const bar = { time, open, high, low, close: c, volume: ok(q.volume?.[i]) ? q.volume[i] : 0 };
    const prev = bars.at(-1);
    if (prev && prev.time === time) bars[bars.length - 1] = bar;
    else if (prev && interval === '1wk' && sameWeek(prev.time, time)) {
      // Yahoo appends a live "today" bar after the current week's bar: fold it in.
      prev.close = bar.close;
      prev.high = Math.max(prev.high, bar.high);
      prev.low = Math.min(prev.low, bar.low);
      prev.volume = Math.max(prev.volume, bar.volume);
    } else if (!prev || prev.time < time) bars.push(bar);
  }
  return { symbol: meta.symbol || '', currency: meta.currency || '', tz, bars };
}

/** Yahoo options JSON → compact chain. */
export function normalizeOptions(json) {
  const r = json?.optionChain?.result?.[0];
  if (!r) {
    const err = new Error(json?.optionChain?.error?.description || 'No options data');
    err.status = 404;
    throw err;
  }
  const pick = (o) => ({
    contract: o.contractSymbol,
    strike: o.strike,
    last: o.lastPrice ?? null,
    bid: o.bid ?? null,
    ask: o.ask ?? null,
    volume: o.volume ?? 0,
    openInterest: o.openInterest ?? 0,
    iv: o.impliedVolatility ?? null,
    itm: !!o.inTheMoney,
  });
  const chain = r.options?.[0] || {};
  return {
    symbol: r.underlyingSymbol,
    expirations: r.expirationDates || [],
    expiration: chain.expirationDate ?? null,
    calls: (chain.calls || []).map(pick),
    puts: (chain.puts || []).map(pick),
  };
}
