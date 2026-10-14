'use strict';
// Film Room content script, part 4 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// SHARE-LINK CODEC
// A link is  SHARE_BASE + '#' + payload.  The part after '#' never goes to any server.
// payload = 'z' + base64url(deflate-raw(JSON))   or   'j' + base64url(JSON) as a fallback.
// JSON = { v:1, id:<video id>, t:<title>, n:[[start, end, text(, emoji)], ...], a:<anonymous author id>,
//          s:[[start, end, type 0-2, x1, y1, x2, y2], ...] (optional: shapes; older viewers ignore it) }
// ---------------------------------------------------------------
function toB64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readAll(readable, cap) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    total += r.value.length;
    if (total > cap) {
      reader.cancel();
      throw new Error('too big');
    }
    chunks.push(r.value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  chunks.forEach((c) => { out.set(c, off); off += c.length; });
  return out;
}

async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return readAll(cs.readable, MAX_BYTES);
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return readAll(ds.readable, MAX_BYTES);
}

async function encodeShare(videoId, title, noteList, author, shapeList) {
  const obj = {
    v: 1,
    id: videoId,
    t: (title || '').slice(0, 120),
    a: AUTHOR_RE.test(author || '') ? author : undefined, // who made the link: lets you recognise your own
    // An emoji-only note also puts the emoji in the text slot, so the older viewer page still shows it.
    n: noteList.map((n) => {
      const row = [Math.round(n.start * 10) / 10, Math.round(n.end * 10) / 10, n.text || n.emoji || ''];
      if (n.emoji) row.push(n.emoji);
      return row;
    }),
  };
  if (shapeList && shapeList.length) {
    obj.s = shapeList.slice(0, MAX_SHAPES).map((s) => [round1(s.start), round1(s.end), SHAPE_TYPES.indexOf(s.type), round1(s.x1), round1(s.y1), round1(s.x2), round1(s.y2)]);
  }
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try {
      return 'z' + toB64Url(await deflate(raw));
    } catch (err) {
      warn(err);
    }
  }
  return 'j' + toB64Url(raw);
}

// A link can be crafted by anyone: validate everything before using it.
function sanitizeShare(obj) {
  if (!obj || obj.v !== 1 || typeof obj.id !== 'string' || !YT_ID_RE.test(obj.id) || !Array.isArray(obj.n)) return null;
  const drawn = [];
  if (Array.isArray(obj.s)) {
    obj.s.slice(0, MAX_SHAPES).forEach((r) => {
      if (!Array.isArray(r) || r.length < 7) return;
      const sh = cleanShape({ type: SHAPE_TYPES[r[2]], start: r[0], end: r[1], x1: r[3], y1: r[4], x2: r[5], y2: r[6], id: newId() });
      if (sh) drawn.push(sh);
    });
  }
  const out = [];
  obj.n.slice(0, MAX_NOTES).forEach((row) => {
    if (!Array.isArray(row) || row.length < 3) return;
    const s = Number(row[0]);
    const e = Number(row[1]);
    let t = row[2];
    if (!isFinite(s) || !isFinite(e) || typeof t !== 'string') return;
    if (s < 0 || s > 1000000 || e <= s || e - s > 3600) return;
    t = t.trim().slice(0, MAX_TEXT);
    const emoji = cleanEmoji(row[3]);
    if (emoji && t === emoji) t = ''; // emoji-only note (see encodeShare)
    if (!t && !emoji) return;
    out.push({ id: newId(), start: s, end: e, text: t, emoji: emoji });
  });
  if (!out.length && !drawn.length) return null;
  out.sort((a, b) => a.start - b.start);
  drawn.sort((a, b) => a.start - b.start);
  return { id: obj.id, notes: out, shapes: drawn, author: typeof obj.a === 'string' && AUTHOR_RE.test(obj.a) ? obj.a : '' };
}

async function decodeShare(payload) {
  if (typeof payload !== 'string' || payload.length > MAX_HASH_CHARS || !PAYLOAD_RE.test(payload)) return null;
  let bytes = fromB64Url(payload.slice(1));
  if (payload.charAt(0) === 'z') bytes = await inflate(bytes);
  if (bytes.length > MAX_BYTES) return null;
  return sanitizeShare(JSON.parse(new TextDecoder().decode(bytes)));
}

// Short links: the notes are kept on the server and the link carries only an id. If the service can't be
// reached, callers fall back to the long link, so sharing always works.
// The call goes through the extension's background worker (not blocked by YouTube's page rules); if that
// isn't available it tries a direct request.
async function apiCall(msg) {
  const withTimeout = (p) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), SHORT_TIMEOUT_MS))]);
  try {
    const r = await withTimeout(chrome.runtime.sendMessage(Object.assign({ type: 'fr-api' }, msg)));
    if (r && typeof r.status === 'number' && r.status > 0) return r; // an answer from the service (even an error)
  } catch (err) {
    warn(err);
  }
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, SHORT_TIMEOUT_MS);
    const init = typeof msg.payload === 'string'
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: msg.payload }
      : { cache: 'no-store' };
    if (ctl) init.signal = ctl.signal;
    const r = await fetch(typeof msg.payload === 'string' ? SHARE_API : SHARE_API + '/' + msg.id, init);
    const text = await r.text();
    clearTimeout(timer);
    return { ok: r.ok, status: r.status, text: text };
  } catch (err) {
    warn(err);
    return null;
  }
}

async function createShortId(payload) {
  const r = await apiCall({ payload: payload });
  if (!r || !r.ok) return null;
  try {
    const j = JSON.parse(r.text);
    return j && typeof j.id === 'string' && /^[A-Za-z0-9_-]{10}$/.test(j.id) ? j.id : null;
  } catch (err) {
    return null;
  }
}

async function fetchShortPayload(id) {
  const r = await apiCall({ id: id });
  return r && r.ok ? r.text : null;
}
