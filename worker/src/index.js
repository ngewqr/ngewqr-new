// Yahoo Finance proxy for the TA portal.
// Routes (with or without an /api prefix):
//   GET /chart?symbol=AAPL&range=1y&interval=1d
//   GET /options?symbol=AAPL[&date=<unix>]
// Every request must carry a valid Cloudflare Access JWT.

import { normalizeChart, normalizeOptions, INTRADAY } from './normalize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,15}$/;
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y']);
const INTERVALS = new Set(['5m', '15m', '60m', '1d', '1wk']);

const ttlFor = (interval) => (INTRADAY.has(interval) ? 60 : interval === '1wk' ? 6 * 3600 : 15 * 60);

function json(body, status, env, request, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, request), ...extraHeaders },
  });
}

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  if (!origin || !env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
}

// ── Cloudflare Access JWT verification ────────────────────────────────────
let certCache = { keys: null, exp: 0 };

const b64urlToBytes = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function accessKeys(teamDomain) {
  if (certCache.keys && certCache.exp > Date.now()) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Cannot fetch Access certs');
  const { keys } = await res.json();
  certCache = { keys, exp: Date.now() + 3600_000 };
  return keys;
}

async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 403, error: 'Missing Access token' };
  if (env.DEV_BYPASS_ACCESS === 'true') return { ok: true }; // local `wrangler dev` only, via .dev.vars
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { ok: false, status: 500, error: 'Access verification not configured' };
  }
  try {
    const [h, p, s] = token.split('.');
    const header = b64urlJson(h);
    const payload = b64urlJson(p);
    if (header.alg !== 'RS256') throw new Error('alg');
    const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('kid');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!valid || payload.exp <= now || !aud.includes(env.ACCESS_AUD) || payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) {
      throw new Error('claims');
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 403, error: 'Invalid Access token' };
  }
}

// ── Yahoo crumb (options endpoint only; never sent to the browser) ────────
let crumbCache = { crumb: null, cookie: null, exp: 0 };

async function getCrumb(force = false) {
  if (!force && crumbCache.crumb && crumbCache.exp > Date.now()) return crumbCache;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
  const cookie = raw.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<')) throw new Error('Cannot obtain Yahoo crumb');
  crumbCache = { crumb, cookie, exp: Date.now() + 3600_000 };
  return crumbCache;
}

// ── Handlers ──────────────────────────────────────────────────────────────
async function handleChart(url, env, request) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  const range = url.searchParams.get('range') || '';
  const interval = url.searchParams.get('interval') || '';
  if (!SYMBOL_RE.test(symbol) || !RANGES.has(range) || !INTERVALS.has(interval)) {
    return json({ error: 'Invalid symbol, range or interval' }, 400, env, request);
  }
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=${interval}&includePrePost=false&events=div,splits`;
  const res = await fetch(upstream, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 404) return json({ error: `Unknown symbol ${symbol}` }, 404, env, request);
  if (!res.ok) return json({ error: `Upstream error ${res.status}` }, 502, env, request);
  return normalizeChart(await res.json(), interval);
}

async function handleOptions(url, env, request) {
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  const date = url.searchParams.get('date');
  if (!SYMBOL_RE.test(symbol) || (date && !/^\d{9,11}$/.test(date))) {
    return json({ error: 'Invalid symbol or date' }, 400, env, request);
  }
  for (const force of [false, true]) {
    const { crumb, cookie } = await getCrumb(force);
    const upstream = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`
      + `?crumb=${encodeURIComponent(crumb)}${date ? `&date=${date}` : ''}`;
    const res = await fetch(upstream, { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' } });
    if (res.status === 401 && !force) continue;
    if (!res.ok) return json({ error: `Upstream error ${res.status}` }, 502, env, request);
    return normalizeOptions(await res.json());
  }
  return json({ error: 'Upstream auth failed' }, 502, env, request);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(env, request), 'Access-Control-Allow-Methods': 'GET' } });
    }
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, env, request);

    const auth = await verifyAccess(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, env, request);

    const url = new URL(request.url);
    // Static portal files (assets binding). Matching files are normally served
    // before the Worker runs; this covers anything outside /api that falls through.
    if (env.ASSETS && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const path = url.pathname.replace(/^\/api/, '');
    const handler = path === '/chart' ? handleChart : path === '/options' ? handleOptions : null;
    if (!handler) return json({ error: 'Not found' }, 404, env, request);

    // Edge cache keyed on the normalized request URL (no auth headers).
    const ttl = path === '/options' ? 60 : ttlFor(url.searchParams.get('interval') || '');
    const cacheKey = new Request(`https://ta-cache.internal${path}?${[...url.searchParams].sort().map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `private, max-age=${ttl}`, 'X-Cache': 'HIT', ...corsHeaders(env, request) },
      });
    }

    try {
      const out = await handler(url, env, request);
      if (out instanceof Response) return out;
      const body = JSON.stringify(out);
      ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } })));
      return new Response(body, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `private, max-age=${ttl}`, 'X-Cache': 'MISS', ...corsHeaders(env, request) },
      });
    } catch (e) {
      return json({ error: e.message || 'Error' }, e.status || 502, env, request);
    }
  },
};
