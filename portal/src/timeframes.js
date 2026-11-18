// Timeframe → Yahoo range/interval map.
// `range`/`interval` are what the view shows; `fetchRange` is longer so that
// slow indicators (SMA200) are fully warmed up at the first visible bar.

export const MARKET_TZ = 'America/New_York';

export const TIMEFRAMES = {
  '1D': { range: '1d',  interval: '5m',  fetchRange: '5d',  intraday: true,  window: { sessions: 1 } },
  '5D': { range: '5d',  interval: '15m', fetchRange: '1mo', intraday: true,  window: { sessions: 5 } },
  '1M': { range: '1mo', interval: '60m', fetchRange: '6mo', intraday: true,  window: { months: 1 } },
  '3M': { range: '3mo', interval: '1d',  fetchRange: '2y',  intraday: false, window: { months: 3 } },
  '6M': { range: '6mo', interval: '1d',  fetchRange: '2y',  intraday: false, window: { months: 6 } },
  '1Y': { range: '1y',  interval: '1d',  fetchRange: '2y',  intraday: false, window: { months: 12 } },
  '5Y': { range: '5y',  interval: '1wk', fetchRange: '10y', intraday: false, window: { months: 60 } },
};

export const TIMEFRAME_ORDER = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y'];

// Bars per year, used to annualize volatility from per-bar returns.
export const BARS_PER_YEAR = { '5m': 78 * 252, '15m': 26 * 252, '60m': 7 * 252, '1d': 252, '1wk': 52 };

const sessionFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: MARKET_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Trading-session date (YYYY-MM-DD, New York) for a bar time. */
export function sessionDate(time) {
  if (typeof time === 'string') return time;
  return sessionFmt.format(new Date(time * 1000));
}

/** Subtract whole calendar months from a YYYY-MM-DD string. */
export function minusMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

/** Index of the first bar inside the visible window for timeframe `tf`. */
export function visibleStartIndex(bars, tf) {
  if (!bars.length) return 0;
  const { window } = TIMEFRAMES[tf];
  const last = bars.length - 1;
  if (window.sessions) {
    let seen = 0;
    let prev = null;
    for (let i = last; i >= 0; i--) {
      const s = sessionDate(bars[i].time);
      if (s !== prev) {
        seen++;
        prev = s;
        if (seen > window.sessions) return i + 1;
      }
    }
    return 0;
  }
  const cutoff = minusMonths(sessionDate(bars[last].time), window.months);
  for (let i = 0; i <= last; i++) {
    if (sessionDate(bars[i].time) > cutoff) return i;
  }
  return last;
}
