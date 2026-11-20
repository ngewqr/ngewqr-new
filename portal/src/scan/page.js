// Scanner page: fetch the universe, prepare once, then render any date instantly.
import { fetchSeries } from '../data.js';
import { UNIVERSE } from './universe.js';
import { prepare, row, breadth, tierOutcomes, HORIZONS, TESTED_H } from '../analysis/scan.js';
import { initMarket, drawChart as drawMarket } from '../market.js';
import { sessionDate } from '../timeframes.js';

/** True while `date` is today's New York session and the regular session has not closed. */
function inProgress(date) {
  const now = Math.floor(Date.now() / 1000);
  if (sessionDate(now) !== date) return false;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) < 16 * 60;
}

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v, dp = 1) => (v === null || v === undefined ? '–' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`);
const CONCURRENCY = 6;
const LOOKBACK = 60;

const TIERS = [
  { id: 'bullish', name: 'Bullish setup', desc: 'bullish signal today, stance bullish, nothing bearish against it' },
  { id: 'bearish', name: 'Bearish setup', desc: 'bearish signal today, stance bearish, nothing bullish against it' },
  { id: 'mixed', name: 'Mixed', desc: 'signals that disagree with each other or with the stance' },
  { id: 'watch', name: 'Watch', desc: 'no directional signal, but an unusual move or volume' },
  { id: 'quiet', name: 'Quiet', desc: 'nothing notable today' },
];

const state = { preps: new Map(), dates: [], date: null, showQuiet: false, query: '' };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
};

function applyPrefs() {
  const theme = store.get('ta-theme');
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  document.documentElement.dataset.palette = store.get('ta-palette') === 'cb' ? 'cb' : 'std';
}

async function loadAll() {
  const status = $('#scan-status');
  const queue = [...UNIVERSE];
  let done = 0;
  const failed = [];
  const tick = () => {
    status.innerHTML = `<div class="progress"><i style="width:${(done / UNIVERSE.length) * 100}%"></i></div><span class="dim">Loading ${done} / ${UNIVERSE.length} tickers…</span>`;
  };
  tick();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        const { bars } = await fetchSeries(u.symbol, '1Y');
        state.preps.set(u.symbol, { meta: u, prep: prepare(bars) });
      } catch { failed.push(u.symbol); }
      done++;
      tick();
    }
  }));
  const ref = state.preps.get('SPY') || state.preps.values().next().value;
  if (!ref) { status.innerHTML = '<p class="status">No data loaded. Check that you are signed in.</p>'; return; }
  state.dates = ref.prep.bars.map((b) => b.time).slice(-120).reverse();
  status.innerHTML = failed.length ? `<p class="dim">Not loaded: ${failed.map(esc).join(', ')}</p>` : '';
}

function rowsFor(date) {
  const rows = [];
  for (const { meta, prep } of state.preps.values()) {
    const i = prep.index.get(String(date));
    if (i === undefined || i < 1) continue;
    rows.push(row(prep, i, meta));
  }
  return rows;
}

const spark = (vals) => {
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const w = 80;
  const h = 22;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * (h - 2) - 1).toFixed(1)}`).join(' ');
  const up = vals.at(-1) >= vals[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
};

function renderBreadth(b) {
  if (!b) return '';
  const washed = b.sectors.filter((s) => s.washed).map((s) => s.sector);
  const tone = b.score >= 70 ? 'bear' : b.score >= 40 ? 'warn' : 'info';
  const label = b.score >= 70 ? 'Washout' : b.score >= 40 ? 'Broad selling' : b.up >= 0.6 ? 'Broad strength' : 'Normal';
  return `<div class="breadth tone-${tone}">
    <span class="mk-label">BREADTH</span><span class="pill tone-${tone}">${label}</span>
    <span>${(b.down3 * 100).toFixed(0)}% of ${b.n} stocks down 3%+ · ${(b.up * 100).toFixed(0)}% up · ${washed.length ? `washed out: ${washed.map(esc).join(', ')}` : 'no sector washed out'}</span>
    <b class="score">${b.score}<small>/100</small></b>
    <div class="sector-bars">${b.sectors.map((s) => `<span title="${esc(s.sector)}: median ${pct(s.median)}, ${(s.downShare * 100).toFixed(0)}% down (${s.n})" class="sb ${s.median < 0 ? 'neg' : 'pos'}${s.washed ? ' washed' : ''}"><i style="height:${Math.min(100, Math.abs(s.median) * 100 * 15)}%"></i><small>${esc(s.sector.split(' ')[0].slice(0, 6))}</small></span>`).join('')}</div>
  </div>`;
}

function renderTable(rows) {
  const q = state.query.trim().toUpperCase();
  const shown = rows.filter((r) => !q || r.symbol.includes(q) || r.sector.toUpperCase().includes(q));
  const order = (r) => -(r.tested.avg ?? -1) * (r.tested.n ? 1 : 0.0001);
  return TIERS.filter((t) => t.id !== 'quiet' || state.showQuiet || q).map((t) => {
    const list = shown.filter((r) => r.tier === t.id).sort((a, b) => order(a) - order(b));
    if (!list.length) return '';
    return `<tbody class="tier tier-${t.id}"><tr class="tier-head"><th colspan="12">${t.name} · ${list.length} <span class="dim">${t.desc}</span></th></tr>
      ${list.map((r) => `<tr class="srow" data-symbol="${esc(r.symbol)}">
        <td class="tk"><b>${esc(r.symbol)}</b></td>
        <td class="dim">${esc(r.sector)}</td>
        <td>${r.close.toFixed(2)} <span class="${r.change >= 0 ? 'pos' : 'neg'}">${pct(r.change)}</span></td>
        <td class="st">${r.stance === null ? '–' : `${Math.round(r.stance)} <small>${esc(r.stanceLabel)}</small>`}</td>
        <td class="sigs">${r.signals.map((s) => `<span class="sig tone-${s.tone}">${esc(s.label.replace(/\s*\(.*\)$/, ''))}</span>`).join('') || '<span class="dim">–</span>'}</td>
        <td class="tested">${r.tested.n ? `${pct(r.tested.avg)} <small>${(r.tested.pctUp * 100).toFixed(0)}% up · n ${r.tested.n}</small>` : '<span class="dim">–</span>'}</td>
        <td class="notes">${r.notes.map((n) => `<span class="note tone-${n.tone}">${esc(n.text)}</span>`).join('')}</td>
        <td>${spark(r.spark)}</td>
        ${HORIZONS.map((h) => `<td class="fwd ${r.forward[h] === null ? '' : r.forward[h] >= 0 ? 'pos' : 'neg'}">${pct(r.forward[h])}</td>`).join('')}
      </tr>`).join('')}</tbody>`;
  }).join('');
}

function renderRecord(rows) {
  const day = { 5: tierOutcomes(rows, 5), 20: tierOutcomes(rows, 20) };
  // Lookback: pool rows from the LOOKBACK sessions up to the selected date.
  const i0 = state.dates.indexOf(state.date);
  const window = state.dates.slice(i0, i0 + LOOKBACK);
  const pooled = window.flatMap((d) => rowsFor(d));
  const look = { 5: tierOutcomes(pooled, 5), 20: tierOutcomes(pooled, 20) };
  const cell = (o) => (o ? `${pct(o.avg)} <small>${(o.pctUp * 100).toFixed(0)}% up · n ${o.n}</small>` : '<span class="dim">–</span>');
  const ids = [...TIERS.map((t) => t.id), 'all'];
  const name = (id) => (id === 'all' ? 'All stocks (baseline)' : TIERS.find((t) => t.id === id).name);
  return `<h2>Track record</h2>
    <table class="mini record"><thead><tr><th>Tier</th><th>This date +5d</th><th>This date +20d</th><th>Last ${window.length} sessions +5d</th><th>+20d</th></tr></thead><tbody>
    ${ids.map((id) => `<tr class="${id === 'all' ? 'base' : ''}"><td>${name(id)}</td><td>${cell(day[5][id])}</td><td>${cell(day[20][id])}</td><td>${cell(look[5][id])}</td><td>${cell(look[20][id])}</td></tr>`).join('')}
    </tbody></table>
    <p class="dim">Average stock return after being placed in each tier, compared with all stocks. Only completed windows count, so recent dates show fewer results. Overlapping windows; past behaviour only, not a forecast. "Tested" in the table = that stock's own average ${TESTED_H}-day move after the same signal types, using outcomes known on the scan date.</p>`;
}

function render() {
  const rows = rowsFor(state.date);
  const b = breadth(rows);
  const counts = Object.fromEntries(TIERS.map((t) => [t.id, rows.filter((r) => r.tier === t.id).length]));
  $('#breadth').innerHTML = renderBreadth(b);
  const live = state.date === state.dates[0] && inProgress(state.date);
  $('#scan-summary').innerHTML = `${live ? '<span class="pill tone-warn">Session in progress: signals can change by the close</span> ' : ''}${state.date} · ${rows.length} tickers · ${TIERS.map((t) => `${counts[t.id]} ${t.name.toLowerCase()}`).join(' · ')}`;
  $('#scan-body').innerHTML = renderTable(rows) || '<tbody><tr><td colspan="12" class="dim">No rows match.</td></tr></tbody>';
  $('#record').innerHTML = renderRecord(rows);
  const p = new URLSearchParams(location.search);
  p.set('d', state.date);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

function bind() {
  $('#scan-date').addEventListener('change', (e) => { state.date = e.target.value; render(); });
  $('#show-quiet').addEventListener('change', (e) => { state.showQuiet = e.target.checked; render(); });
  $('#scan-search').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('#scan-body').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.srow');
    if (tr) location.href = `./?t=${encodeURIComponent(tr.dataset.symbol)}&tf=6M`;
  });
  $('#theme-btn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    store.set('ta-theme', cur === 'dark' ? 'light' : 'dark');
    applyPrefs();
    drawMarket();
  });
}

(async () => {
  applyPrefs();
  bind();
  initMarket();
  await loadAll();
  if (!state.dates.length) return;
  const want = new URLSearchParams(location.search).get('d');
  state.date = state.dates.includes(want) ? want : state.dates[0];
  $('#scan-date').innerHTML = state.dates.map((d, i) => `<option value="${d}"${d === state.date ? ' selected' : ''}>${i === 0 ? `Latest · ${d}` : d}</option>`).join('');
  $('#scan-controls').hidden = false;
  render();
  document.body.dataset.ready = '1';
})();
