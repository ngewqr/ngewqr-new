import { toPoints, lastValue } from './util.js';
import { smaValues } from './sma.js';
import { volumeSignals } from '../analysis/signals.js';

const compact = (v) => {
  if (v === null) return 'n/a';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

export default {
  id: 'volume',
  name: 'Volume',
  pane: 'separate',
  params: { avgPeriod: 20, spikeMult: 2 },
  minBars: 1,
  compute(bars, params) {
    const vols = bars.map((b) => b.volume);
    const avg = smaValues(vols, params.avgPeriod);
    const last = vols.length ? vols[vols.length - 1] : null;
    const a = lastValue(avg);
    const ratio = last !== null && a ? last / a : null;
    return {
      series: [
        {
          id: 'volume', type: 'histogram', color: 'muted',
          data: toPoints(bars, vols, (i) => ({ tone: bars[i].close >= bars[i].open ? 'up' : 'down' })),
        },
        { id: `vol-avg${params.avgPeriod}`, type: 'line', color: 'c2', data: toPoints(bars, avg) },
      ],
      levels: [],
      signals: volumeSignals(bars, params.avgPeriod, params.spikeMult),
      summary: {
        value: last,
        state: ratio !== null && ratio > params.spikeMult ? 'spike' : 'normal',
        text: `Volume ${compact(last)}, ${ratio === null ? 'n/a' : ratio.toFixed(2)}× ${params.avgPeriod}-bar average`,
      },
    };
  },
};
