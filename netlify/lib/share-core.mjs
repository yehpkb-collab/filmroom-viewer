// Film Room short links: the logic, kept free of Netlify specifics so it can be tested with a plain Map.
//
//   POST /api/share        body = the share payload ('z...' or 'j...', the part after # in a long link)
//                          -> { id }   (the short link is  <viewer>/#s<id>)
//   GET  /api/share/<id>   -> the payload as text, or 404 when unknown / expired
//
// The id is a hash of the payload, so sharing the same notes twice gives the same link and stores nothing new.
// A link expires RETENTION_DAYS after it was last opened (opening it resets the clock).

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const RETENTION_DAYS = 90;
export const DAY_MS = 86400000;
export const ID_LEN = 10;
export const RATE_LIMIT_PER_HOUR = 40;

const PAYLOAD_RE = /^[zj][A-Za-z0-9_-]+$/;
const ID_RE = new RegExp('^[A-Za-z0-9_-]{' + ID_LEN + '}$');
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_PAYLOAD_CHARS = 60000; // same ceiling the extension and viewer use for a link
const MAX_BYTES = 262144;
const MAX_NOTES = 300;
const MAX_TEXT = 1000; // clients trim to 300; this is just a sanity cap

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function reply(status, body, extra) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, CORS, extra || {});
  return new Response(body, { status, headers });
}

const json = (status, obj) => reply(status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
const text = (status, s) => reply(status, s, { 'Content-Type': 'text/plain; charset=utf-8' });

export const idFor = (payload) =>
  createHash('sha256').update(payload).digest('base64url').slice(0, ID_LEN);

// Only a well-formed Film Room payload is stored: this is not a general file host.
export function validPayload(payload) {
  if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD_CHARS || !PAYLOAD_RE.test(payload)) return false;
  let obj;
  try {
    let bytes = Buffer.from(payload.slice(1), 'base64url');
    if (payload.charAt(0) === 'z') bytes = inflateRawSync(bytes, { maxOutputLength: MAX_BYTES });
    if (bytes.length > MAX_BYTES) return false;
    obj = JSON.parse(bytes.toString('utf8'));
  } catch (e) {
    return false;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (Object.keys(obj).some((k) => k !== 'v' && k !== 'id' && k !== 't' && k !== 'n')) return false;
  if (obj.v !== 1 || typeof obj.id !== 'string' || !YT_ID_RE.test(obj.id)) return false;
  if (obj.t !== undefined && (typeof obj.t !== 'string' || obj.t.length > 300)) return false;
  if (!Array.isArray(obj.n) || obj.n.length < 1 || obj.n.length > MAX_NOTES) return false;
  return obj.n.every((row) =>
    Array.isArray(row) && (row.length === 3 || row.length === 4) &&
    Number.isFinite(row[0]) && Number.isFinite(row[1]) &&
    typeof row[2] === 'string' && row[2].length <= MAX_TEXT &&
    (row.length === 3 || (typeof row[3] === 'string' && row[3].length <= 16)));
}

async function allowed(rateStore, ip, now) {
  if (!rateStore) return true;
  const who = createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 16);
  const key = who + '-' + Math.floor(now / 3600000);
  let n = 0;
  try {
    const cur = await rateStore.get(key, { type: 'json' });
    n = cur && Number.isFinite(cur.n) ? cur.n : 0;
  } catch (e) { /* if the counter can't be read, let the request through */ }
  if (n >= RATE_LIMIT_PER_HOUR) return false;
  try { await rateStore.setJSON(key, { n: n + 1 }); } catch (e) { /* ignore */ }
  return true;
}

// deps: { shares, rates?, ip?, now? }  where shares/rates look like a Netlify Blobs store
export async function handle(req, deps) {
  const now = deps.now ? deps.now() : Date.now();
  const shares = deps.shares;
  const method = req.method.toUpperCase();
  if (method === 'OPTIONS') return reply(204, null);

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const m = path.match(/\/api\/share(?:\/([^/]+))?$/);
  if (!m) return text(404, 'Not found');

  if (method === 'POST' && !m[1]) {
    const payload = (await req.text()).trim();
    if (!validPayload(payload)) return json(400, { error: 'That is not a Film Room share payload.' });
    if (!(await allowed(deps.rates, deps.ip, now))) return json(429, { error: 'Too many links created. Try again later.' });
    const id = idFor(payload);
    const existing = await shares.get(id, { type: 'json' });
    const rec = existing && existing.p === payload ? existing : { p: payload, c: now };
    rec.o = now;
    await shares.setJSON(id, rec);
    return json(200, { id });
  }

  if (method === 'GET' && m[1]) {
    const id = decodeURIComponent(m[1]);
    if (!ID_RE.test(id)) return text(404, 'Not found');
    const rec = await shares.get(id, { type: 'json' });
    if (!rec || typeof rec.p !== 'string') return text(404, 'Not found');
    if (now - (rec.o || rec.c || 0) > RETENTION_DAYS * DAY_MS) {
      await shares.delete(id);
      return text(404, 'Expired');
    }
    if (now - (rec.o || 0) > DAY_MS) { // opening a link keeps it alive; no need to write on every view
      rec.o = now;
      await shares.setJSON(id, rec);
    }
    return text(200, rec.p);
  }

  return text(405, 'Method not allowed');
}

// Daily housekeeping: drop links nobody has opened for RETENTION_DAYS, and old rate-limit counters.
export async function cleanup(shares, rates, now) {
  now = now || Date.now();
  let removed = 0;
  const { blobs } = await shares.list();
  for (const b of blobs.slice(0, 2000)) {
    const rec = await shares.get(b.key, { type: 'json' });
    if (!rec || now - (rec.o || rec.c || 0) > RETENTION_DAYS * DAY_MS) {
      await shares.delete(b.key);
      removed++;
    }
  }
  if (rates) {
    const hour = Math.floor(now / 3600000);
    const r = await rates.list();
    for (const b of r.blobs.slice(0, 2000)) {
      const bucket = parseInt(b.key.split('-').pop(), 10);
      if (!(bucket >= hour - 1)) await rates.delete(b.key);
    }
  }
  return removed;
}
