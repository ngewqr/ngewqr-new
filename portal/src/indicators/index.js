// Registry of every indicator and theory module. Order here is the toggle order.
import sma from './sma.js';
import ema from './ema.js';
import bollinger from './bollinger.js';
import vwap from './vwap.js';
import volume from './volume.js';
import rsi from './rsi.js';
import macd from './macd.js';
import atr from './atr.js';
import theories from '../theories/index.js';

export const INDICATORS = [sma, ema, bollinger, vwap, volume, rsi, macd, atr];
export const THEORIES = theories;
export const MODULES = [...INDICATORS, ...THEORIES];

const ids = new Set();
for (const m of MODULES) {
  if (ids.has(m.id)) throw new Error(`Duplicate module id: ${m.id}`);
  ids.add(m.id);
}

export const byId = (id) => MODULES.find((m) => m.id === id);
export const DEFAULT_ON = ['sma', 'volume', 'rsi', 'macd'];
