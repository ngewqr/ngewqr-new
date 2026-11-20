// Market strip: VIX level, context and today's session, shown above the chart.
import { fetchSeries } from './data.js';
import { visibleStartIndex } from './timeframes.js';
import { vixSummary } from './analysis/vix.js';
import { formatTime, nyTick } from './chart.js';

const $ = (s) => document.querySelector(s);
const pct = (v, dp = 0) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
};

let data = null;
let chart = null;

export async function initMarket() {
  const el = $('#market');
  el.addEventListener('click', (e) => {
    if (e.target.id === 'mk-hide') {
      const hidden = el.classList.toggle('collapsed');
      store.set('ta-market-hidden', hidden ? '1' : '0');
      if (!hidden) drawChart();
    }
  });
  if (store.get('ta-market-hidden') === '1') el.classList.add('collapsed');
  el.innerHTML = '<p class="dim mk-loading">Loading VIX…</p>';
  const [daily, intraday, d9, d3m] = await Promise.allSettled([
    fetchSeries('^VIX', '1Y'), fetchSeries('^VIX', '1D'), fetchSeries('^VIX9D', '1Y'), fetchSeries('^VIX3M', '1Y'),
  ]);
  if (daily.status !== 'fulfilled') { el.innerHTML = `<p class="dim">VIX unavailable: ${daily.reason?.message || 'error'}</p>`; return; }
  const bars = (r) => (r.status === 'fulfilled' ? r.value.bars : []);
  const s = vixSummary(bars(daily), bars(d9), bars(d3m));
  let session = [];
  if (intraday.status === 'fulfilled') {
    const ib = intraday.value.bars;
    session = ib.slice(visibleStartIndex(ib, '1D'));
  }
  data = { s, session, prevClose: bars(daily).at(-2)?.close ?? null };
  render();
}

function render() {
  const { s } = data;
  const el = $('#market');
  if (!s) { el.innerHTML = '<p class="dim">Not enough VIX history.</p>'; return; }
  const t = s.term;
  const termTxt = t
    ? `Term structure: VIX9D ${t.vix9d?.toFixed(2) ?? '–'} · VIX ${s.last.toFixed(2)} · VIX3M ${t.vix3m.toFixed(2)} (${t.text}).`
    : '';
  el.innerHTML = `
    <div class="mk-head">
      <span class="mk-label">VIX</span>
      <b class="mk-last">${s.last.toFixed(2)}</b>
      <span class="${s.change >= 0 ? 'neg' : 'pos'}">${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)} (${pct(s.changePct, 1)})</span>
      <span class="mk-regime tone-${s.regime.tone}">${s.regime.label}</span>
      <span class="dim">as of ${formatTime(s.time)}</span>
      <a class="mk-open" href="?t=%5EVIX&tf=6M">Open chart</a>
      <button type="button" id="mk-hide" class="mk-hide" aria-label="Show or hide the VIX panel"></button>
    </div>
    <div class="mk-body">
      <p class="mk-text">VIX is <b>${Math.abs(s.vsAvg * 100).toFixed(0)}% ${s.vsAvg >= 0 ? 'above' : 'below'}</b> its 20-day average of ${s.avg20.toFixed(1)}
        and higher than <b>${(s.percentile * 100).toFixed(0)}%</b> of the past year's closes (range ${s.low52.toFixed(1)}–${s.high52.toFixed(1)}). ${termTxt}</p>
      <div class="mk-chart-wrap"><div class="mk-chart-title dim">Latest session${data.prevClose ? ` · dashed line = prior close ${data.prevClose.toFixed(2)}` : ''}</div><div id="mk-chart" class="mk-chart"></div></div>
    </div>`;
  drawChart();
}

/** Re-create the mini chart (also called after a theme change). */
export function drawChart() {
  if (!data || !data.session.length) return;
  const host = $('#mk-chart');
  if (!host || $('#market').classList.contains('collapsed')) return;
  chart?.remove();
  const { createChart, AreaSeries, LineStyle } = globalThis.LightweightCharts;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(`--${n}`).trim();
  const up = data.prevClose === null || data.session.at(-1).close >= data.prevClose;
  const line = up ? v('down') : v('up'); // VIX rising = stress, shown in the "down" colour
  chart = createChart(host, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: v('muted-text') },
    grid: { vertLines: { visible: false }, horzLines: { color: v('grid') } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: nyTick },
    localization: { timeFormatter: formatTime },
    handleScroll: false,
    handleScale: false,
  });
  const ser = chart.addSeries(AreaSeries, {
    lineColor: line, topColor: `${line}55`, bottomColor: `${line}05`, lineWidth: 2, priceLineVisible: false,
  });
  ser.setData(data.session.map((b) => ({ time: b.time, value: b.close })));
  if (data.prevClose) ser.createPriceLine({ price: data.prevClose, color: v('level'), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
  chart.timeScale().fitContent();
}
