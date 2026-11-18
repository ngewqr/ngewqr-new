import { TIMEFRAMES, TIMEFRAME_ORDER, BARS_PER_YEAR, visibleStartIndex } from './timeframes.js';
import { fetchSeries, cleanSymbol } from './data.js';
import { MODULES, INDICATORS, THEORIES, byId, DEFAULT_ON } from './indicators/index.js';
import { supportResistance } from './analysis/levels.js';
import { defaultSignals, divergenceSignals } from './analysis/signals.js';
import { rsiValues } from './indicators/rsi.js';
import { atrValues } from './indicators/atr.js';
import { rebase, stats } from './compare.js';
import { renderChart, formatTime } from './chart.js';
import { initOptions, optionsSymbolChanged } from './options.js';
import { stanceSeries, currentStance } from './analysis/stance.js';
import { scorecard, baseline, conditionalStats, HORIZONS } from './analysis/scorecard.js';

const $ = (sel) => document.querySelector(sel);
const SECTOR_ETFS = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC'];
const MAX_COMPARE = 5;

// ── State (lives in the URL) ───────────────────────────────────────────────
const state = { t: 'AAPL', tf: '1Y', cmp: [], ind: [...DEFAULT_ON], lv: true };

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.t = cleanSymbol(p.get('t')) || 'AAPL';
  state.tf = TIMEFRAMES[p.get('tf')] ? p.get('tf') : '1Y';
  state.cmp = (p.get('cmp') || '').split(',').map(cleanSymbol).filter((s) => s && s !== state.t).slice(0, MAX_COMPARE);
  state.ind = p.has('ind') ? p.get('ind').split(',').filter((id) => byId(id)) : [...DEFAULT_ON];
  state.lv = p.get('lv') !== '0';
}

function writeUrl() {
  const p = new URLSearchParams();
  p.set('t', state.t);
  p.set('tf', state.tf);
  if (state.cmp.length) p.set('cmp', state.cmp.join(','));
  p.set('ind', state.ind.join(','));
  if (!state.lv) p.set('lv', '0');
  const url = `${location.pathname}?${p.toString().replace(/%2C/g, ',').replace(/%5E/g, '^')}`;
  if (url !== `${location.pathname}${location.search}`) history.pushState(null, '', url);
}

// ── Per-viewer preferences (theme, palette) ────────────────────────────────
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
};

function applyPrefs() {
  const theme = store.get('ta-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  document.documentElement.dataset.palette = store.get('ta-palette') === 'cb' ? 'cb' : 'std';
  $('#palette-btn').setAttribute('aria-pressed', String(document.documentElement.dataset.palette === 'cb'));
}

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ── Controls ───────────────────────────────────────────────────────────────
function buildControls() {
  const tfBar = $('#tf-bar');
  tfBar.innerHTML = TIMEFRAME_ORDER.map((tf) => `<button type="button" data-tf="${tf}">${tf}</button>`).join('');
  tfBar.addEventListener('click', (e) => {
    const tf = e.target.closest('button')?.dataset.tf;
    if (tf && tf !== state.tf) { state.tf = tf; update(); }
  });

  const chip = (m) => `<label class="chip"><input type="checkbox" value="${m.id}"><span>${m.name}</span></label>`;
  $('#ind-bar').innerHTML = INDICATORS.map(chip).join('')
    + (THEORIES.length ? `<span class="sep">Theories</span>${THEORIES.map(chip).join('')}` : '')
    + '<label class="chip"><input type="checkbox" id="lv-toggle"><span>S/R levels</span></label>';
  $('#ind-bar').addEventListener('change', (e) => {
    if (e.target.id === 'lv-toggle') { state.lv = e.target.checked; update(); return; }
    const id = e.target.value;
    // keep registry order so pane order is stable
    const on = new Set(state.ind);
    if (e.target.checked) on.add(id); else on.delete(id);
    state.ind = MODULES.map((m) => m.id).filter((x) => on.has(x));
    update();
  });

  $('#ticker-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const sym = cleanSymbol($('#ticker').value);
    if (!sym) { showStatus('Ticker must be 1–15 characters: A–Z, 0–9, . - ^ ='); return; }
    state.t = sym;
    state.cmp = state.cmp.filter((s) => s !== sym);
    update();
  });

  $('#cmp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addCompare($('#cmp-input').value.split(/[\s,]+/));
    $('#cmp-input').value = '';
  });
  $('#cmp-quick').innerHTML = ['SPY', 'QQQ', '^GSPC'].map((s) => `<button type="button" data-add="${s}">+ ${s}</button>`).join('')
    + `<select id="sector" aria-label="Add sector ETF"><option value="">+ Sector ETF</option>${SECTOR_ETFS.map((s) => `<option>${s}</option>`).join('')}</select>`
    + '<button type="button" id="cmp-clear">Clear</button>';
  $('#cmp-quick').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'cmp-clear') { state.cmp = []; update(); } else if (b.dataset.add) addCompare([b.dataset.add]);
  });
  $('#sector').addEventListener('change', (e) => { if (e.target.value) addCompare([e.target.value]); e.target.value = ''; });
  $('#cmp-list').addEventListener('click', (e) => {
    const sym = e.target.closest('button')?.dataset.remove;
    if (sym) { state.cmp = state.cmp.filter((s) => s !== sym); update(); }
  });

  $('#theme-btn').addEventListener('click', () => {
    store.set('ta-theme', currentTheme() === 'dark' ? 'light' : 'dark');
    applyPrefs();
    draw();
  });
  $('#palette-btn').addEventListener('click', () => {
    store.set('ta-palette', document.documentElement.dataset.palette === 'cb' ? 'std' : 'cb');
    applyPrefs();
    draw();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!store.get('ta-theme')) draw(); });
  window.addEventListener('popstate', () => { readUrl(); load(); });
}

function addCompare(list) {
  const add = list.map(cleanSymbol).filter((s) => s && s !== state.t && !state.cmp.includes(s));
  if (!add.length) return;
  state.cmp = [...state.cmp, ...add].slice(0, MAX_COMPARE);
  update();
}

function syncControls() {
  $('#ticker').value = state.t;
  document.querySelectorAll('#tf-bar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tf === state.tf)));
  const intraday = TIMEFRAMES[state.tf].intraday;
  document.querySelectorAll('#ind-bar input[value]').forEach((i) => {
    i.checked = state.ind.includes(i.value);
    const m = byId(i.value);
    const na = m.intradayOnly && !intraday;
    i.disabled = na;
    i.closest('.chip').title = na ? 'Intraday timeframes only (1D, 5D, 1M)' : '';
  });
  $('#lv-toggle').checked = state.lv;
  $('#cmp-list').innerHTML = state.cmp.map((s) => `<span class="tag">${s}<button type="button" data-remove="${s}" aria-label="Remove ${s}">×</button></span>`).join('');
}

function showStatus(msg) {
  const el = $('#status');
  el.textContent = msg || '';
  el.hidden = !msg;
}

// ── Load + compute ─────────────────────────────────────────────────────────
let loadToken = 0;
let model = null;

function update() { writeUrl(); load(); }

async function load() {
  syncControls();
  const token = ++loadToken;
  document.body.classList.add('loading');
  showStatus('');
  const symbols = [state.t, ...state.cmp];
  const results = await Promise.allSettled(symbols.map((s) => fetchSeries(s, state.tf)));
  if (token !== loadToken) return;
  document.body.classList.remove('loading');

  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (results[0].status === 'rejected') {
    model = null;
    showStatus(errors.join(' · '));
    $('#chart').innerHTML = '';
    $('#summary').innerHTML = '';
    $('#cmp-table').innerHTML = '';
    return;
  }
  if (errors.length) showStatus(errors.join(' · '));
  model = compute(results[0].value, results.slice(1).map((r, i) => (r.status === 'fulfilled' ? r.value : { symbol: state.cmp[i], bars: null })));
  draw();
  loadMtf(token);
  optionsSymbolChanged(state.t);
  if (new URLSearchParams(location.search).has('debug')) globalThis.__taModel = model; // test hook
  document.body.dataset.ready = `${state.t}|${state.tf}|${state.cmp.join(',')}`;
}

function trimResult(result, startTime) {
  const keep = (t) => t >= startTime;
  return {
    ...result,
    series: result.series.map((s) => ({ ...s, data: s.data.filter((d) => keep(d.time)) })),
    signals: (result.signals || []).filter((s) => keep(s.time)),
  };
}

function compute(primary, others) {
  const tf = state.tf;
  const t = TIMEFRAMES[tf];
  const all = primary.bars;
  const i0 = visibleStartIndex(all, tf);
  const visible = all.slice(i0);
  const startTime = visible[0].time;

  const active = state.ind.map(byId).filter((m) => m && !(m.intradayOnly && !t.intraday));
  const layers = active.map((module) => {
    const params = structuredClone(module.params);
    const result = module.compute(all, params);
    return { module, result: trimResult(result, startTime), summary: result.summary };
  });

  const rsi = rsiValues(all.map((b) => b.close));
  const divergence = divergenceSignals(all, rsi).filter((s) => s.time >= startTime);
  const theorySignals = layers.filter((l) => THEORIES.includes(l.module)).flatMap((l) => l.result.signals);
  const seen = new Set();
  const allSignals = [...defaultSignals(all).filter((s) => s.time >= startTime), ...theorySignals]
    .filter((s) => { const k = `${s.kind}|${s.time}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

  const levels = state.lv ? supportResistance(visible, { atr: atrValues(all, 14).at(-1) }) : null;

  let compare = null;
  if (others.length) {
    const list = [{ symbol: primary.symbol || state.t, bars: visible }];
    for (const o of others) {
      if (!o.bars) continue;
      list.push({ symbol: o.symbol, bars: o.bars.slice(visibleStartIndex(o.bars, tf)) });
    }
    const rb = rebase(list);
    const statRows = list.map((s) => {
      const from = rb.start === null ? 0 : Math.max(0, s.bars.findIndex((b) => String(b.time) === String(rb.start)));
      return { symbol: s.symbol, ...stats(s.bars.slice(from), BARS_PER_YEAR[t.interval]) };
    });
    compare = { ...rb, statRows };
  }

  const { score } = stanceSeries(all);
  const stance = currentStance(all);
  const history = {
    bull: conditionalStats(all, (i) => score[i] !== null && score[i] >= 15),
    bear: conditionalStats(all, (i) => score[i] !== null && score[i] <= -15),
    base: baseline(all),
  };
  const card = scorecard(all, defaultSignals(all));

  return { primary, visible, layers, divergence, allSignals, levels, compare, intraday: t.intraday, stance, history, card, nBars: all.length, mtf: null };
}

// ── Stance across timeframes (one per bar interval) ───────────────────────
const MTF = [['5m', '1D'], ['15m', '5D'], ['1h', '1M'], ['Daily', '1Y'], ['Weekly', '5Y']];

async function loadMtf(token) {
  const sym = state.t;
  const res = await Promise.allSettled(MTF.map(([, tf]) => fetchSeries(sym, tf)));
  if (token !== loadToken || !model) return;
  model.mtf = MTF.map(([label], i) => ({ label, stance: res[i].status === 'fulfilled' ? currentStance(res[i].value.bars) : null }));
  drawSummary();
}

// ── Draw ───────────────────────────────────────────────────────────────────
let chartHandle = null;

function draw() {
  if (!model) return;
  chartHandle?.destroy();
  const mode = model.compare && model.compare.series.length > 1 ? 'compare' : 'price';
  chartHandle = renderChart($('#chart'), {
    intraday: model.intraday,
    mode,
    bars: model.visible,
    compare: model.compare,
    layers: model.layers,
    levels: model.levels,
    priceSignals: mode === 'price' ? model.divergence : [],
    allSignals: model.allSignals,
  }, $('#tooltip'));
  drawHeader();
  drawSummary();
  drawCompareTable(mode);
}

function drawHeader() {
  const v = model.visible;
  const first = v[0].close;
  const last = v.at(-1);
  const chg = (last.close / first - 1) * 100;
  const cur = model.primary.currency ? ` ${model.primary.currency}` : '';
  $('#quote').innerHTML = `<b>${model.primary.symbol || state.t}</b> <span>${last.close.toFixed(2)}${cur}</span>`
    + ` <span class="${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% (${state.tf})</span>`
    + ` <span class="dim">as of ${formatTime(last.time)}</span>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const pctTxt = (v, dp = 1) => (v === null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`);

function stanceHtml() {
  const st = model.stance;
  if (!st) return '<h2>Technical stance</h2><p class="dim">Not enough history for a stance on this timeframe.</p>';
  const votes = st.votes.map((v) => `<tr><td>${v.group}</td><td>${esc(v.name)}</td><td>${esc(v.reading)}</td><td class="vote v${v.vote}">${v.vote > 0 ? '+1' : v.vote < 0 ? '−1' : '0'}</td></tr>`).join('');
  const w = st.weights;
  const mtf = model.mtf
    ? `<div class="mtf">${model.mtf.map((m) => `<span class="mtf-cell tone-${m.stance?.tone || 'none'}"><small>${m.label}</small>${m.stance ? `${m.stance.label}<i>${Math.round(m.stance.score)}</i>` : 'n/a'}</span>`).join('')}</div>`
    : '<div class="mtf dim">Loading other timeframes…</div>';
  const h = model.history;
  const row = (name, s) => `<tr><td>${name}</td>${HORIZONS.map((k) => `<td>${s[k].n ? `${pctTxt(s[k].avg)} <small>${s[k].pctUp.toFixed(0)}% up</small>` : 'n/a'}</td>`).join('')}<td>${s[HORIZONS[0]].n}</td></tr>`;
  return `<h2>Technical stance</h2>
    <div class="stance tone-${st.tone}"><b>${st.label}</b> <span>${st.score >= 0 ? '+' : ''}${Math.round(st.score)}</span>
    <p>${st.positive} of ${st.votes.length} indicators positive, ${st.negative} negative · ADX ${st.adx.toFixed(1)} (${st.adx >= 25 ? 'trend weighted' : st.adx < 20 ? 'momentum weighted' : 'balanced'})</p></div>
    ${mtf}
    <details><summary>Why: indicator votes</summary><table class="mini"><thead><tr><th>Group</th><th>Indicator</th><th>Reading</th><th>Vote</th></tr></thead><tbody>${votes}</tbody></table>
    <p class="dim">Weights: trend ${(w.trend * 100).toFixed(0)}%, momentum ${(w.momentum * 100).toFixed(0)}%, volume ${(w.volume * 100).toFixed(0)}%. Describes the indicators; not a recommendation.</p></details>
    <details><summary>Historical check (this ticker, ${model.nBars} bars)</summary><table class="mini"><thead><tr><th>When stance was</th>${HORIZONS.map((k) => `<th>+${k} bars</th>`).join('')}<th>n</th></tr></thead><tbody>
    ${row('Bullish or stronger', h.bull)}${row('Bearish or weaker', h.bear)}${row('Any bar (baseline)', h.base)}</tbody></table>
    <p class="dim">Average forward return and share of positive outcomes. Overlapping windows; small samples are noisy. Past behaviour only.</p></details>`;
}

function scorecardHtml() {
  if (!model.card.length) return '';
  const rows = model.card.map((c) => `<tr class="tone-${c.tone}"><td>${esc(c.label)}</td><td>${c.count}</td>${HORIZONS.map((k) => `<td>${c.stats[k].n ? `${pctTxt(c.stats[k].avg)} <small>${c.stats[k].pctUp.toFixed(0)}%</small>` : 'n/a'}</td>`).join('')}</tr>`).join('');
  const b = model.history.base;
  return `<details><summary>Signal scorecard (${model.nBars} bars)</summary><table class="mini"><thead><tr><th>Signal</th><th>n</th>${HORIZONS.map((k) => `<th>+${k}</th>`).join('')}</tr></thead><tbody>${rows}
    <tr class="base"><td>Baseline (any bar)</td><td>${b[HORIZONS[0]].n}</td>${HORIZONS.map((k) => `<td>${pctTxt(b[k].avg)} <small>${b[k].pctUp?.toFixed(0) ?? 'n/a'}%</small></td>`).join('')}</tr></tbody></table>
    <p class="dim">Average return and % of cases up, N bars after each signal, over the fetched history. Compare against the baseline row.</p></details>`;
}

function drawSummary() {
  const ind = model.layers.map((l) => `<li><span class="k">${esc(l.module.name)}</span>${esc(l.summary.text)}</li>`).join('');
  const lv = model.levels
    ? `<li><span class="k">S/R levels</span>${[
      ...model.levels.above.map((l) => `R ${l.price.toFixed(2)} (${l.touches} touches)`),
      ...model.levels.below.map((l) => `S ${l.price.toFixed(2)} (${l.touches} touches)`),
    ].join(' · ') || 'none detected'}</li>`
    : '';
  const sigs = model.allSignals.slice(0, 60).map((s) => `<li class="tone-${s.tone}"><span class="k">${formatTime(s.time)}</span>${esc(s.label)}</li>`).join('');
  $('#summary').innerHTML = `${stanceHtml()}<h2>Indicators</h2><ul>${ind}${lv}</ul>${scorecardHtml()}`
    + `<h2>Signals in view <small>${model.allSignals.length}</small></h2>`
    + (sigs ? `<ul class="signals">${sigs}</ul>` : '<p class="dim">No signals in this window.</p>');
}

function drawCompareTable(mode) {
  const el = $('#cmp-table');
  if (mode !== 'compare') { el.innerHTML = ''; return; }
  const pct = (v) => (v === null ? 'n/a' : `${v >= 0 && v !== 0 ? '+' : ''}${v.toFixed(2)}%`);
  el.innerHTML = `<table><thead><tr><th>Ticker</th><th>Total return</th><th>Max drawdown</th><th>Ann. volatility</th></tr></thead><tbody>${
    model.compare.statRows.map((r, i) => `<tr><td><i class="swatch s${i}"></i>${esc(r.symbol)}</td><td>${pct(r.totalReturn)}</td><td>${pct(r.maxDrawdown)}</td><td>${r.volatility === null ? 'n/a' : `${r.volatility.toFixed(1)}%`}</td></tr>`).join('')
  }</tbody></table><p class="dim">Rebased to 0% at ${model.compare.start === null ? 'n/a' : formatTime(model.compare.start)}. Volatility = stdev of per-bar returns × √(bars per year).</p>`;
}

// ── Boot ───────────────────────────────────────────────────────────────────
applyPrefs();
buildControls();
initOptions(() => state.t);
readUrl();
load();
