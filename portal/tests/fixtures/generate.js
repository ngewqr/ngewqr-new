// Regenerates the synthetic fixtures. Deterministic (seeded); run with
//   node portal/tests/fixtures/generate.js
// Synthetic data is used so no Yahoo data is redistributed in the repo.
import { writeFileSync } from 'node:fs';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r4 = (v) => Math.round(v * 10000) / 10000;

function walk(n, rand, start, drift) {
  const out = [];
  let c = start;
  for (let i = 0; i < n; i++) {
    const regime = Math.sin(i / 60) * drift; // slow trend cycles → crosses happen
    const o = c * (1 + (rand() - 0.5) * 0.004);
    c = o * (1 + regime + (rand() - 0.5) * 0.03);
    const h = Math.max(o, c) * (1 + rand() * 0.01);
    const l = Math.min(o, c) * (1 - rand() * 0.01);
    const v = Math.round(1e6 * (0.6 + rand()) * (rand() < 0.04 ? 3.5 : 1));
    out.push({ open: r4(o), high: r4(h), low: r4(l), close: r4(c), volume: v });
  }
  return out;
}

// 600 weekday bars from 2023-01-02.
const rand = mulberry32(42);
const daily = walk(600, rand, 100, 0.004);
const d = new Date(Date.UTC(2023, 0, 2));
for (const b of daily) {
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  b.time = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 1);
}

// 5 sessions × 78 five-minute bars, 09:30–15:55 New York (EST, UTC−5).
const intraday = walk(390, mulberry32(7), 150, 0.001);
const sessions = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
intraday.forEach((b, i) => {
  const s = sessions[Math.floor(i / 78)];
  b.time = Date.parse(`${s}T14:30:00Z`) / 1000 + (i % 78) * 300;
});

const dir = new URL('.', import.meta.url);
writeFileSync(new URL('synthetic-daily.json', dir), JSON.stringify(daily));
writeFileSync(new URL('synthetic-intraday.json', dir), JSON.stringify(intraday));
console.log('wrote', daily.length, intraday.length);
