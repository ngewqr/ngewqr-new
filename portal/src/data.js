import { TIMEFRAMES } from './timeframes.js';

// Worker base URL. Default: same-origin /api route (one Access app covers both).
// Override with <meta name="ta-api-base" content="https://...">.
const API_BASE = (typeof document !== 'undefined'
  && document.querySelector('meta[name="ta-api-base"]')?.content) || '/api';

const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,15}$/;
const cache = new Map(); // key → { at, promise }
const TTL_MS = { intraday: 60_000, daily: 15 * 60_000 };

export function cleanSymbol(s) {
  const sym = String(s || '').trim().toUpperCase();
  return SYMBOL_RE.test(sym) ? sym : null;
}

/** Fetch normalized bars for `symbol` covering the timeframe plus indicator warm-up. */
export function fetchSeries(symbol, tf) {
  const t = TIMEFRAMES[tf];
  const key = `${symbol}|${t.fetchRange}|${t.interval}`;
  const ttl = t.intraday ? TTL_MS.intraday : TTL_MS.daily;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;

  const url = `${API_BASE}/chart?symbol=${encodeURIComponent(symbol)}&range=${t.fetchRange}&interval=${t.interval}`;
  const promise = fetch(url, { credentials: 'include' }).then(async (res) => {
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON (e.g. Access login page) */ }
    if (!res.ok || !body) {
      const reason = res.status === 403 ? 'Not signed in (Access)' : body?.error || `HTTP ${res.status}`;
      throw new Error(`${symbol}: ${reason}`);
    }
    if (!body.bars?.length) throw new Error(`${symbol}: no data for ${tf}`);
    return body;
  });
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

/** Options chain for one expiry (default: Yahoo's nearest). Cached 60 s. */
export function fetchOptions(symbol, date) {
  const key = `opt|${symbol}|${date || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.promise;
  const url = `${API_BASE}/options?symbol=${encodeURIComponent(symbol)}${date ? `&date=${date}` : ''}`;
  const promise = fetch(url, { credentials: 'include' }).then(async (res) => {
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok || !body) throw new Error(`${symbol} options: ${res.status === 403 ? 'Not signed in (Access)' : body?.error || `HTTP ${res.status}`}`);
    if (!body.expirations?.length) throw new Error(`${symbol}: no listed options`);
    return body;
  });
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
