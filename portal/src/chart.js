// Chart rendering on TradingView Lightweight Charts v5 (global `LightweightCharts`).
import { MARKET_TZ } from './timeframes.js';

const LWC = () => globalThis.LightweightCharts;

const PRICE_PANE_PX = 380;
const SUB_PANE_PX = 130;

const nyClock = new Intl.DateTimeFormat('en-US', { timeZone: MARKET_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const nyDay = new Intl.DateTimeFormat('en-US', { timeZone: MARKET_TZ, month: 'short', day: 'numeric' });
const utcDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });

/** Axis labels in New York time for intraday (unix) bars; default for dates. */
export function nyTick(t, type) {
  if (typeof t !== 'number') return null;
  const d = new Date(t * 1000);
  return type <= 2 ? nyDay.format(d) : nyClock.format(d);
}

export function timeKey(t) {
  if (t === null || t === undefined) return null;
  if (typeof t === 'object') return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  return String(t);
}

export function formatTime(t) {
  if (typeof t === 'number') {
    const d = new Date(t * 1000);
    return `${nyDay.format(d)} ${nyClock.format(d)} ET`;
  }
  const k = timeKey(t);
  return utcDay.format(new Date(`${k}T00:00:00Z`));
}

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(`--${n}`).trim();
  const keys = ['bg', 'surface', 'text', 'muted-text', 'grid', 'border', 'up', 'down', 'up-soft', 'down-soft',
    'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'muted', 'warn', 'bull', 'bear', 'info', 'level'];
  return Object.fromEntries(keys.map((k) => [k, v(k)]));
}

const TONE_KEY = { warn: 'warn', bull: 'bull', bear: 'bear', info: 'info' };
const CMP_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

function toMarkers(signals, colors) {
  return signals
    .map((s) => ({
      time: s.time,
      position: s.position === 'below' ? 'belowBar' : 'aboveBar',
      color: colors[TONE_KEY[s.tone] || 'info'],
      shape: s.tone === 'bull' ? 'arrowUp' : s.tone === 'bear' ? 'arrowDown' : 'circle',
      size: s.tone === 'info' ? 0.6 : 1,
    }))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/**
 * @param {HTMLElement} host
 * @param {object} view
 *   intraday, mode ('price'|'compare'), symbol, bars (visible), compare (rebased series),
 *   layers [{ module, result }] already trimmed to the visible window,
 *   levels { above, below } | null, priceSignals [] (markers on the price pane)
 * @param {HTMLElement} tooltipEl
 */
export function renderChart(host, view, tooltipEl) {
  const { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle } = LWC();
  const colors = readColors();
  host.innerHTML = '';

  const overlays = view.mode === 'price' ? view.layers.filter((l) => l.module.pane === 'overlay') : [];
  const separates = view.layers.filter((l) => l.module.pane === 'separate');
  host.style.height = `${PRICE_PANE_PX + SUB_PANE_PX * separates.length}px`;

  const chart = createChart(host, {
    autoSize: true,
    layout: {
      background: { color: colors.surface },
      textColor: colors['muted-text'],
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      panes: { separatorColor: colors.border, separatorHoverColor: colors.grid },
    },
    grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
    rightPriceScale: { borderColor: colors.border },
    timeScale: {
      borderColor: colors.border,
      timeVisible: view.intraday,
      secondsVisible: false,
      tickMarkFormatter: nyTick,
    },
    localization: { timeFormatter: formatTime },
    crosshair: { mode: 0 },
  });

  // lookups for the tooltip: series → Map(timeKey → value)
  const rows = []; // { label, map, fmt }
  const addLookup = (label, data, fmt = (v) => v.toFixed(2)) => {
    rows.push({ label, map: new Map(data.map((d) => [timeKey(d.time), d.value])), fmt });
  };

  // ── Pane 0: price or compare ──
  let priceSeries;
  if (view.mode === 'compare') {
    view.compare.series.forEach((s, i) => {
      const ser = chart.addSeries(LineSeries, {
        color: colors[CMP_COLORS[i % CMP_COLORS.length]],
        lineWidth: i === 0 ? 3 : 2,
        title: s.symbol,
        priceFormat: { type: 'custom', formatter: (v) => `${v.toFixed(1)}%` },
      }, 0);
      ser.setData(s.data);
      if (i === 0) priceSeries = ser;
      addLookup(s.symbol, s.data, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
    });
    if (priceSeries) priceSeries.createPriceLine({ price: 0, color: colors.level, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false });
  } else {
    priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.up, downColor: colors.down, borderUpColor: colors.up, borderDownColor: colors.down,
      wickUpColor: colors.up, wickDownColor: colors.down,
    }, 0);
    priceSeries.setData(view.bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  }

  for (const { result } of overlays) {
    for (const s of result.series) {
      const ser = chart.addSeries(LineSeries, {
        color: colors[s.color] || colors.c1,
        lineWidth: 1.5,
        lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      }, 0);
      ser.setData(s.data);
      addLookup(s.id.toUpperCase(), s.data);
    }
  }

  if (view.levels && view.mode === 'price') {
    for (const [side, list] of [['R', view.levels.above], ['S', view.levels.below]]) {
      for (const l of list) {
        priceSeries.createPriceLine({
          price: l.price, color: colors.level, lineStyle: LineStyle.Dashed, lineWidth: 1,
          axisLabelVisible: true, title: `${side} ×${l.touches}`,
        });
      }
    }
  }

  // SMA20 crosses are frequent; they stay in the summary panel but not as chart markers.
  const priceSignals = [...view.priceSignals, ...overlays.flatMap((l) => l.result.signals)]
    .filter((s) => !/^close-(above|below)-sma20$/.test(s.kind));
  if (priceSeries) createSeriesMarkers(priceSeries, toMarkers(priceSignals, colors));

  // ── Separate panes ──
  separates.forEach(({ module, result }, idx) => {
    const pane = idx + 1;
    let first = null;
    for (const s of result.series) {
      let ser;
      if (s.type === 'histogram') {
        const isVol = module.id === 'volume';
        ser = chart.addSeries(HistogramSeries, {
          priceFormat: isVol ? { type: 'volume' } : { type: 'price', precision: 2, minMove: 0.01 },
          priceLineVisible: false,
          lastValueVisible: false,
        }, pane);
        ser.setData(s.data.map((d) => ({
          time: d.time, value: d.value,
          color: d.tone ? colors[d.tone === 'up' ? 'up-soft' : 'down-soft'] : colors.muted,
        })));
        if (!isVol || view.mode !== 'price') {
          addLookup(s.id.toUpperCase(), s.data, isVol ? (v) => Math.round(v).toLocaleString('en-US') : undefined);
        } // in price mode the OHLC row already shows volume
      } else {
        ser = chart.addSeries(LineSeries, {
          color: colors[s.color] || colors.c1, lineWidth: 1.5, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false,
          ...(module.id === 'volume' || s.volume ? { priceFormat: { type: 'volume' } } : {}),
        }, pane);
        ser.setData(s.data);
        addLookup(s.id.toUpperCase(), s.data, module.id === 'volume' || s.volume ? (v) => Math.round(v).toLocaleString('en-US') : undefined);
      }
      if (!first || (first.seriesType() === 'Histogram' && s.type === 'line')) first = ser;
    }
    if (first) {
      for (const lv of result.levels || []) {
        first.createPriceLine({ price: lv.value, color: colors.level, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: lv.label || '' });
      }
      if (result.signals?.length && module.id !== 'volume') createSeriesMarkers(first, toMarkers(result.signals, colors));
    }
  });

  const panes = chart.panes();
  panes.forEach((p, i) => p.setStretchFactor(i === 0 ? PRICE_PANE_PX / SUB_PANE_PX : 1));
  chart.timeScale().fitContent();

  // ── Tooltip (crosshair is shared across panes) ──
  const barMap = new Map((view.bars || []).map((b) => [timeKey(b.time), b]));
  const sigMap = new Map();
  for (const s of view.allSignals || []) {
    const k = timeKey(s.time);
    if (!sigMap.has(k)) sigMap.set(k, []);
    sigMap.get(k).push(s.label);
  }
  chart.subscribeCrosshairMove((param) => {
    const k = timeKey(param.time);
    if (!k || !param.point) { tooltipEl.hidden = true; return; }
    const parts = [`<div class="tt-time">${formatTime(param.time)}</div>`];
    const b = barMap.get(k);
    if (b && view.mode === 'price') {
      parts.push(`<div class="tt-ohlc">O ${b.open.toFixed(2)} H ${b.high.toFixed(2)} L ${b.low.toFixed(2)} C ${b.close.toFixed(2)}</div>`,
        `<div class="tt-row"><span>VOL</span><b>${Math.round(b.volume).toLocaleString('en-US')}</b></div>`);
    }
    for (const r of rows) {
      const v = r.map.get(k);
      if (v !== undefined) parts.push(`<div class="tt-row"><span>${r.label}</span><b>${r.fmt(v)}</b></div>`);
    }
    for (const label of sigMap.get(k) || []) parts.push(`<div class="tt-sig">${label}</div>`);
    tooltipEl.innerHTML = parts.join('');
    tooltipEl.hidden = false;
    const w = host.clientWidth;
    const x = param.point.x + 16 + 220 > w ? param.point.x - 236 : param.point.x + 16;
    tooltipEl.style.transform = `translate(${Math.max(4, x)}px, 8px)`;
  });

  return { chart, destroy: () => chart.remove() };
}
