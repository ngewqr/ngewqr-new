// Options panel: chain for one expiry with greeks, liquidity flags and summary stats.
// Loads only while the panel is open.
import { fetchOptions, fetchSeries } from './data.js';
import { analyzeChain, defaultExpiry, secondsToExpiry, usableIv, DEFAULT_RATE } from './analysis/options-math.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n2 = (v, dp = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(dp));
const pct = (v, dp = 1) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(dp)}%`);
const int = (v) => (v ? Math.round(v).toLocaleString('en-US') : '–');
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const nyDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
};

let symbol = null;
let expiry = null; // selected expiration (unix), per symbol
let showAll = false;
let token = 0;

export function initOptions(getSymbol) {
  const panel = $('#opt-panel');
  panel.open = store.get('ta-opt-open') === '1';
  panel.addEventListener('toggle', () => {
    store.set('ta-opt-open', panel.open ? '1' : '0');
    if (panel.open) load(getSymbol());
  });
  $('#opt-body').addEventListener('change', (e) => {
    if (e.target.id === 'opt-expiry') { expiry = Number(e.target.value); load(symbol); }
  });
  $('#opt-body').addEventListener('click', (e) => {
    if (e.target.id === 'opt-strikes') { showAll = !showAll; load(symbol); }
  });
}

/** Call after every main load; reloads the panel only when it is open. */
export function optionsSymbolChanged(sym) {
  if (sym !== symbol) { expiry = null; showAll = false; }
  symbol = sym;
  if ($('#opt-panel').open) load(sym);
  else $('#opt-body').innerHTML = '';
}

async function load(sym) {
  symbol = sym;
  const my = ++token;
  const body = $('#opt-body');
  if (!body.innerHTML) body.innerHTML = '<p class="dim">Loading options…</p>';
  body.classList.add('busy');
  try {
    // First call without a date gives the expiry list; then fetch the chosen expiry.
    const first = await fetchOptions(sym);
    const now = first.underlying?.time ?? Math.floor(Date.now() / 1000);
    const tz = first.underlying?.tz;
    if (!expiry || !first.expirations.includes(expiry)) expiry = defaultExpiry(first.expirations, now, 30, 7, tz);
    const [chain, daily] = await Promise.all([
      expiry === first.expiration ? first : fetchOptions(sym, expiry),
      fetchSeries(sym, '1Y').catch(() => null),
    ]);
    if (my !== token) return;
    const a = analyzeChain(chain, daily ? daily.bars.map((b) => b.close) : []);
    body.innerHTML = render(chain, a, now, tz);
  } catch (e) {
    if (my === token) body.innerHTML = `<p class="status">${esc(e.message)}</p>`;
  } finally {
    if (my === token) body.classList.remove('busy');
  }
}

function render(chain, a, now, tz) {
  const opts = chain.expirations.map((e) => {
    const d = Math.max(0, Math.round(secondsToExpiry(e, now, tz) / 86400));
    return `<option value="${e}"${e === chain.expiration ? ' selected' : ''}>${dateFmt.format(new Date(e * 1000))} (${d}d)</option>`;
  }).join('');

  const spot = a.spot;
  const cur = chain.underlying?.currency ? ` ${chain.underlying.currency}` : '';
  const em = a.expectedMove;
  const st = a.straddle;
  const earn = a.earnings;
  const earnTxt = earn
    ? `${nyDate.format(new Date(earn.time * 1000))}${earn.estimate ? ' (est.)' : ''}`
    : 'none listed';
  const card = (k, v, sub = '', cls = '') => `<div class="ocard ${cls}"><small>${k}</small><b>${v}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const ivHvTxt = a.ivHv === null ? '' : a.ivHv > 1.2 ? 'IV above recent realized' : a.ivHv < 0.8 ? 'IV below recent realized' : 'IV near recent realized';

  const cards = [
    card('Spot', `${n2(spot)}${cur}`, chain.underlying?.marketState === 'REGULAR' ? 'market open' : (chain.underlying?.marketState || '').toLowerCase()),
    card('Days to expiry', n2(a.dte, a.dte < 2 ? 1 : 0), dateFmt.format(new Date(chain.expiration * 1000))),
    card('ATM IV', pct(a.atmIv), 'interpolated at spot'),
    card('Expected move (1σ)', em ? `±${n2(em)}` : '–', em ? `±${pct(em / spot)} → ${n2(a.range[0])} to ${n2(a.range[1])}` : ''),
    card('ATM straddle', st ? n2(st.price) : '–', st ? `strike ${st.strike}, ±${pct(st.price / spot)} priced in` : ''),
    card('Historical vol', `${pct(a.hv20)} / ${pct(a.hv60)}`, '20-day / 60-day'),
    card('IV ÷ HV20', a.ivHv === null ? '–' : `${n2(a.ivHv)}×`, ivHvTxt),
    card('Put/call ratio', `${n2(a.pcr.volume)} vol`, `${n2(a.pcr.openInterest)} open interest`),
    card('Max pain', a.maxPain ?? '–', a.maxPain ? `${pct(a.maxPain / spot - 1)} from spot` : ''),
    card('Next earnings', earnTxt, earn?.beforeExpiry ? 'before this expiry: IV usually drops after the report' : earn ? 'after this expiry' : '', earn?.beforeExpiry ? 'warn' : ''),
  ].join('');

  // Strike window: 12 either side of spot unless "all".
  const strikes = [...new Set([...a.calls, ...a.puts].map((c) => c.strike))].sort((x, y) => x - y);
  let lo = 0;
  let hi = strikes.length;
  if (!showAll) {
    const i = strikes.findIndex((k) => k >= spot);
    const c = i === -1 ? strikes.length : i;
    lo = Math.max(0, c - 12);
    hi = Math.min(strikes.length, c + 12);
  }
  const callBy = new Map(a.calls.map((c) => [c.strike, c]));
  const putBy = new Map(a.puts.map((c) => [c.strike, c]));

  const side = (c) => {
    if (!c) return '<td colspan="9" class="empty"></td>';
    const g = c.greeks;
    const cls = `${c.itm ? 'itm' : ''} ${c.liq.thin ? 'thin' : ''}`;
    const warn = c.liq.thin ? `<i title="${esc(c.liq.reasons.join(', '))}">⚠</i>` : '';
    const cells = [
      n2(c.bid), n2(c.ask), c.liq.spread === null ? '–' : pct(c.liq.spread, 0),
      usableIv(c.iv) ? pct(c.iv) : '–', g ? n2(g.delta) : '–', g ? n2(g.theta) : '–', g ? n2(g.vega) : '–', int(c.volume), `${int(c.openInterest)}${warn}`,
    ];
    return cells.map((v) => `<td class="${cls}">${v}</td>`).join('');
  };

  let spotRow = false;
  const rows = strikes.slice(lo, hi).map((k) => {
    let marker = '';
    if (!spotRow && k >= spot) {
      spotRow = true;
      marker = `<tr class="spot-row"><td colspan="19">Spot ${n2(spot)}${em ? ` · expected range ${n2(a.range[0])}–${n2(a.range[1])}` : ''}</td></tr>`;
    }
    const inRange = a.range && k >= a.range[0] && k <= a.range[1] ? ' in-range' : '';
    return `${marker}<tr>${side(callBy.get(k))}<th class="strike${inRange}${k === a.maxPain ? ' maxpain' : ''}">${k}</th>${side(putBy.get(k))}</tr>`;
  }).join('');

  const head = ['Bid', 'Ask', 'Spr', 'IV', 'Δ', 'Θ/day', 'Vega', 'Vol', 'OI'];
  return `
    <div class="opt-controls">
      <label>Expiry <select id="opt-expiry">${opts}</select></label>
      <button type="button" id="opt-strikes">${showAll ? 'Strikes near spot' : `All ${strikes.length} strikes`}</button>
    </div>
    <div class="ocards">${cards}</div>
    <div class="chain-wrap"><table class="chain">
      <thead><tr><th colspan="9" class="side">Calls</th><th></th><th colspan="9" class="side">Puts</th></tr>
      <tr>${head.map((h) => `<th>${h}</th>`).join('')}<th>Strike</th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="dim">Greeks: Black-Scholes from Yahoo's IV, r = ${(DEFAULT_RATE * 100).toFixed(1)}% assumed, dividend yield ${pct(a.q, 2)}. Θ per calendar day, vega per 1 vol point. ⚠ = thin: no two-sided quote, spread over 10% of mid, or open interest under 100. Shaded = in the money; strikes in bold fall inside the expected range; underlined strike = max pain. Quotes may be delayed. Describes the chain; not a recommendation.</p>`;
}
