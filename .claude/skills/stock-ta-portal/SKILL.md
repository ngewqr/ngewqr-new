---
name: stock-ta-portal
description: Build, extend and maintain the private stock technical-analysis portal — price charts for 1D/5D/1M/3M/6M/1Y/5Y, auto-drawn indicators, multi-ticker comparison, and custom trading theories added as indicator modules. Use when asked to add a stock indicator or theory, change timeframes, fix chart or data issues, adjust the Yahoo proxy Worker, or change the Cloudflare Access gate. Triggers on: "add this theory", "add indicator", "RSI/MACD/Bollinger/VWAP", "support and resistance", "compare tickers", "timeframe", "chart portal", "TA portal".
---

# Stock Technical-Analysis Portal

A private, login-gated portal for **personal analysis, learning and trade review**. It charts any US ticker across fixed timeframes, auto-draws technical indicators, and runs the owner's own theories as plug-in modules.

**Scope guardrail:** personal and team use only. Output describes what the data shows ("RSI crossed above 70 on 12 Mar"). It never phrases output as advice to others ("buy", "sell", "you should"). If a request would open the portal to outside or paying users, stop and flag that this changes data licensing (Yahoo terms) and possibly securities regulation.

## Architecture

| Layer | Choice |
|---|---|
| Frontend | Static HTML + vanilla JS (ES modules), no build step |
| Charts | TradingView Lightweight Charts, pinned version from cdnjs/jsdelivr |
| Data | Yahoo Finance via a Cloudflare Worker proxy (browser cannot call Yahoo directly: CORS) |
| Hosting | Cloudflare Pages, deployed from this repo |
| Gate | Cloudflare Access (email allow-list) on the portal subdomain **and** the Worker route |

### File layout

```
portal/
  index.html              # shell: ticker search, timeframe bar, chart panes, summary panel
  src/
    app.js                # wiring, state, URL params (?t=AAPL&tf=1Y&cmp=SPY,QQQ)
    data.js               # fetch via Worker, normalize bars, in-memory cache
    timeframes.js         # timeframe → Yahoo range/interval map (below)
    chart.js              # create panes, draw series, markers, price lines
    compare.js            # % return overlay for multiple tickers
    indicators/
      index.js            # registry: import + export every module
      sma.js ema.js rsi.js macd.js bollinger.js vwap.js atr.js volume.js
    analysis/
      levels.js           # support/resistance detection
      signals.js          # crossovers, overbought/oversold, divergence
    theories/
      README.md           # one section per theory: source text, rules, params
      <theory-id>.js      # one file per owner theory
  tests/
    fixtures/             # saved bar data (JSON) for deterministic tests
    indicators.test.js
worker/
  src/index.js            # Yahoo proxy
  wrangler.toml
```

## Data

### Timeframe map

| Button | Yahoo `range` | `interval` | Notes |
|---|---|---|---|
| 1D | `1d` | `5m` | Include pre/post market off by default |
| 5D | `5d` | `15m` | |
| 1M | `1mo` | `60m` | Daily bars give only ~21 points; too thin |
| 3M | `3mo` | `1d` | |
| 6M | `6mo` | `1d` | |
| 1Y | `1y` | `1d` | |
| 5Y | `5y` | `1wk` | |

Indicators need warm-up bars (e.g. SMA200 needs 200). Fetch a **longer range than displayed** and trim on draw, e.g. 1Y view fetches `2y` so SMA200 is valid from the first visible bar.

### Worker proxy

- Endpoint: `GET /chart?symbol=AAPL&range=1y&interval=1d` → forwards to `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=…&interval=…&includePrePost=false&events=div,splits`.
- Validate `symbol` against `^[A-Z0-9.\-^=]{1,15}$` and `range`/`interval` against an allow-list. Reject everything else with 400.
- Set a browser-like `User-Agent`. Cache responses at the edge: intraday 60 s, daily 15 min, weekly 6 h.
- Options chain (`/v7/finance/options/{symbol}`) requires Yahoo's cookie + crumb. The Worker fetches and caches the crumb; never expose it to the browser.
- Return only normalized JSON: `{ symbol, currency, tz, bars: [{ time, open, high, low, close, volume }] }`.

### Normalization rules

- `time`: UNIX seconds for intraday; `YYYY-MM-DD` business-day string for daily/weekly (Lightweight Charts format).
- Use **adjusted close** for daily and weekly so splits/dividends do not create false gaps. Scale O/H/L by the same ratio.
- Drop bars with null close. Never forward-fill prices.
- Market time zone is `America/New_York`. Intraday session boundaries use it, not the viewer's local time.

## Indicator module contract

Every indicator and every theory is one file exporting this shape:

```js
export default {
  id: 'rsi',                       // unique, kebab-case
  name: 'RSI (14)',
  pane: 'separate',                // 'overlay' (on price) | 'separate' (own pane)
  params: { period: 14, upper: 70, lower: 30 },
  minBars: 15,                     // bars needed before first valid value
  compute(bars, params) {
    return {
      series: [                    // lines/histograms to draw
        { id: 'rsi', type: 'line', data: [{ time, value }] },
      ],
      levels: [                    // optional horizontal reference lines
        { value: 70, label: 'Overbought' },
      ],
      signals: [                   // optional chart markers
        { time, kind: 'overbought', label: 'RSI > 70', position: 'above', tone: 'warn' },
      ],
      summary: { value: 63.2, state: 'neutral', text: 'RSI 63.2, neutral' },
    };
  },
};
```

Hard rules for `compute`:

1. **Pure.** No fetching, DOM or global state. Same input, same output.
2. **No look-ahead.** A value or signal at bar `t` may use only bars `0..t`. Pivot-based logic that needs right-side bars must place the signal at the bar where it became *knowable*, not at the pivot.
3. **Warm-up:** omit points before `minBars`. Never emit `NaN`, `null` or `0` placeholders.
4. Register the module in `indicators/index.js` (or `theories/` is auto-registered through the same registry).

## Reference formulas

| Indicator | Definition |
|---|---|
| SMA(n) | Mean of last `n` closes |
| EMA(n) | `α = 2/(n+1)`; seed with SMA(n) of first `n` closes; `EMA_t = α·C_t + (1−α)·EMA_{t−1}` |
| RSI(14) | Wilder smoothing: avg gain/loss seeded by simple mean of first 14 changes, then `avg = (prev·13 + current)/14`; `RSI = 100 − 100/(1 + avgGain/avgLoss)`; if avgLoss = 0, RSI = 100 |
| MACD(12,26,9) | `MACD = EMA12 − EMA26`; `signal = EMA9(MACD)`; `hist = MACD − signal` |
| Bollinger(20,2) | Middle = SMA20; bands = middle ± 2·σ, σ = **population** std-dev of last 20 closes |
| ATR(14) | True range = max(H−L, \|H−C_prev\|, \|L−C_prev\|); Wilder-smoothed |
| VWAP | Σ(typical price·vol)/Σvol, typical = (H+L+C)/3; **resets each session**; intraday timeframes only (hide on daily+) |
| 52-week high/low | Max high / min low over trailing 252 daily bars |

## Auto-analysis

### Support and resistance (`analysis/levels.js`)

1. Find swing pivots: a high (low) is a pivot if it is the max (min) of the 5 bars on each side.
2. Cluster pivots whose prices are within `0.5 × ATR14` of each other; level price = mean of the cluster.
3. Score = touch count, weighted toward recent touches. Draw the top 3 levels above and top 3 below the last close as dashed price lines labelled with touch count.

### Default signals (`analysis/signals.js`)

| Signal | Rule |
|---|---|
| Golden cross / death cross | SMA50 crosses above / below SMA200 |
| Price vs MA | Close crosses SMA20, SMA50 or SMA200 |
| RSI zones | Crosses above 70 or below 30, and the return back inside |
| MACD cross | MACD crosses signal line; note whether above or below zero |
| Bollinger | Close outside a band; squeeze when band width is at its 6-month low |
| Volume spike | Volume > 2 × 20-bar average volume |
| Divergence | Price makes a higher high while RSI makes a lower high (bearish), or the reverse (bullish), across the last two confirmed pivots |

The summary panel lists each indicator's current `summary.text`, followed by signals in the visible window, newest first.

## Compare mode

- Rebase each ticker to 0% at the first **common** timestamp in the visible window: `pct = (close / close_first − 1) × 100`.
- Align on timestamps; do not interpolate missing bars.
- Fixed colors per slot (primary ticker first). Default comparisons offered: `SPY`, `QQQ`, `^GSPC`, sector ETF.
- Show a table below the chart: total return, max drawdown, annualized volatility (`stdev(daily returns) × √252`) per ticker.

## Adding an owner theory (main workflow)

When the owner sends a theory (text, PDF, screenshot, or notes):

1. **Restate it as testable rules** before writing code: inputs, parameters with defaults, exact entry/exit or state conditions, which timeframes it applies to. Write this into `theories/README.md` under a new heading, quoting the owner's source text.
2. **List ambiguities** (e.g. "close above or touch?", "which moving-average type?", "how many bars confirm?") and ask the owner. Do not guess silently. If an assumption is unavoidable, record it in the README as `Assumption:`.
3. Implement `theories/<id>.js` against the module contract. Reuse helpers from `indicators/` (import `ema`, `atr`, etc.) instead of re-implementing.
4. Add a fixture test: at least one known bar sequence with hand-checked expected values or signals, plus one look-ahead test (truncating future bars must not change past output).
5. Render on AAPL at 1Y and 5D, take a screenshot, and check that markers land where the rules say they should.
6. Report back with: the rules as implemented, the assumptions made, and the screenshot.

## Access gate

- Cloudflare Access application covers the portal hostname **and** the Worker route. An un-gated Worker would leak the data feed.
- Policy: `Include → Emails` allow-list maintained by the owner. Session duration 24 h.
- The Worker additionally checks the `Cf-Access-Jwt-Assertion` header and returns 403 if absent.
- Never commit emails, Cloudflare tokens or account IDs to the repo. Use `wrangler secret` and Pages environment variables.

## Testing and verification

- `node --test portal/tests/` must pass before any commit.
- Indicator tests compare against fixture values to 4 decimal places.
- Before reporting a chart change as done, load it in headless Chromium (Playwright) with a fixture-backed mock of the Worker and confirm: every timeframe renders, no console errors, warm-up is trimmed, and markers appear.

## UI conventions

- Dark and light themes from CSS tokens; up candles green, down red, with a colorblind-safe alternate palette toggle.
- Panes: price (with overlays) on top, then volume, then one pane per `separate` indicator, in toggle order.
- Crosshair syncs across all panes. Tooltip shows OHLCV plus each active indicator value at that bar.
- State lives in the URL so any view can be bookmarked or shared within the team.
- Footer on every page: "Personal analysis only. Data from Yahoo Finance, may be delayed. Not investment advice."
