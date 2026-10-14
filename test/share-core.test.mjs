// Run with:  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { handle, parsePayload, validPayload, cleanup, listStats, RETENTION_DAYS, DAY_MS, RATE_LIMIT_PER_HOUR } from '../netlify/lib/share-core.mjs';

// A Map that looks like a Netlify Blobs store.
function store() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })) }; },
  };
}

// Builds a payload the way the extension does: 'z' + base64url(deflate-raw(JSON)).
const mk = (obj, mode = 'z') => {
  const raw = Buffer.from(JSON.stringify(obj));
  return mode === 'z' ? 'z' + deflateRawSync(raw).toString('base64url') : 'j' + raw.toString('base64url');
};
const good = { v: 1, id: 'dQw4w9WgXcQ', t: 'Match 1', a: 'abcDEF123456', n: [[12.3, 17.3, 'Late split step'], [30, 33, '👀', '👀']] };
const post = (body) => new Request('https://x.test/api/share', { method: 'POST', body });
const get = (id, headers) => new Request('https://x.test/api/share/' + id, { headers });
const statsReq = (token) => new Request('https://x.test/api/stats', { headers: token ? { Authorization: 'Bearer ' + token } : {} });

test('valid payloads are accepted in both encodings; junk is not', () => {
  assert.ok(validPayload(mk(good)));
  assert.ok(validPayload(mk(good, 'j')));
  assert.equal(parsePayload(mk(good)).id, 'dQw4w9WgXcQ');
  assert.equal(validPayload('zzzz'), false);
  assert.equal(validPayload(mk({ ...good, extra: 1 })), false, 'unknown keys rejected');
  assert.equal(validPayload(mk({ ...good, id: 'short' })), false, 'bad video id');
  assert.equal(validPayload(mk({ ...good, n: [] })), false, 'no notes');
  assert.equal(validPayload(mk({ ...good, n: [[1, 2, 'x'.repeat(1001)]] })), false, 'note too long');
  assert.equal(validPayload('z' + deflateRawSync(Buffer.alloc(400000, 97)).toString('base64url')), false, 'inflate bomb');
});

test('create, open, dedupe, and count opens', async () => {
  const shares = store(), stats = store(), rates = store();
  const deps = { shares, stats, rates, ip: '1.1.1.1', statsToken: 'secret' };
  const p = mk(good);
  const r1 = await handle(post(p), deps);
  const { id } = await r1.json();
  assert.match(id, /^[A-Za-z0-9_-]{10}$/);
  const r2 = await handle(post(p), deps);
  assert.equal((await r2.json()).id, id, 'same notes give the same link');
  assert.equal(shares.m.size, 1);
  for (let i = 0; i < 3; i++) {
    const g = await handle(get(id), deps);
    assert.equal(g.status, 200);
    assert.equal(await g.text(), p);
  }
  const list = await listStats(stats);
  assert.equal(list.length, 1);
  assert.equal(list[0].opens, 3);
  assert.equal(list[0].notes, 2);
  assert.equal(list[0].video, 'dQw4w9WgXcQ');
  assert.equal(list[0].title, 'Match 1');
});

test('stats endpoint: 404 without a configured token, 401 for a wrong one, 200 for the right one', async () => {
  const deps = { shares: store(), stats: store(), rates: store(), ip: '2.2.2.2' };
  assert.equal((await handle(statsReq('x'), deps)).status, 404);
  deps.statsToken = 'secret';
  assert.equal((await handle(statsReq(), deps)).status, 401);
  assert.equal((await handle(statsReq('nope'), deps)).status, 401);
  const ok = await handle(statsReq('secret'), deps);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).links, []);
  assert.equal((await handle(new Request('https://x.test/api/stats', { method: 'POST' }), deps)).status, 405);
});

test('a counting failure never breaks sharing or opening', async () => {
  const broken = { async get() { throw new Error('boom'); }, async setJSON() { throw new Error('boom'); }, async list() { return { blobs: [] }; }, async delete() {} };
  const deps = { shares: store(), stats: broken, rates: store(), ip: '3.3.3.3' };
  const r = await handle(post(mk(good)), deps);
  assert.equal(r.status, 200);
  const { id } = await r.json();
  assert.equal((await handle(get(id), deps)).status, 200);
});

test('rate limit: creates beyond the hourly cap get 429', async () => {
  const deps = { shares: store(), stats: store(), rates: store(), ip: '4.4.4.4' };
  let last;
  for (let i = 0; i < RATE_LIMIT_PER_HOUR + 1; i++) last = await handle(post(mk({ ...good, t: 'n' + i })), deps);
  assert.equal(last.status, 429);
});

test('links expire after the retention window since the last open, and cleanup removes them and their counters', async () => {
  const shares = store(), stats = store(), rates = store();
  const t0 = 1_700_000_000_000;
  const deps = (now) => ({ shares, stats, rates, ip: '5.5.5.5', now: () => now });
  const { id } = await (await handle(post(mk(good)), deps(t0))).json();
  // opened on day 60: still alive, clock resets
  assert.equal((await handle(get(id), deps(t0 + 60 * DAY_MS))).status, 200);
  // day 140 is 80 days after the last open: alive
  assert.equal((await handle(get(id), deps(t0 + 140 * DAY_MS))).status, 200);
  // 100 days after that open: gone
  const gone = await handle(get(id), deps(t0 + 140 * DAY_MS + (RETENTION_DAYS + 10) * DAY_MS));
  assert.equal(gone.status, 404);
  // cleanup path
  const { id: id2 } = await (await handle(post(mk({ ...good, t: 'second' })), deps(t0))).json();
  const removed = await cleanup(shares, rates, t0 + (RETENTION_DAYS + 5) * DAY_MS, stats);
  assert.ok(removed >= 1);
  assert.equal(shares.m.has(id2), false);
  assert.equal(stats.m.has(id2), false);
});

test('bad requests', async () => {
  const deps = { shares: store(), stats: store(), rates: store(), ip: '6.6.6.6' };
  assert.equal((await handle(post('not a payload'), deps)).status, 400);
  assert.equal((await handle(get('short'), deps)).status, 404);
  assert.equal((await handle(get('AAAAAAAAAA'), deps)).status, 404);
  assert.equal((await handle(new Request('https://x.test/api/share', { method: 'OPTIONS' }), deps)).status, 204);
  assert.equal((await handle(new Request('https://x.test/api/share/AAAAAAAAAA', { method: 'DELETE' }), deps)).status, 405);
});

test('shapes: accepted when well formed, alone or with notes; bad rows rejected', () => {
  const row = [5, 9, 0, 20, 30, 50, 60];
  assert.ok(validPayload(mk({ ...good, s: [row, [6, 10, 1, 55, 20, 80, 50], [7, 11, 2, 10, 70, 40, 90]] })));
  assert.ok(validPayload(mk({ v: 1, id: 'dQw4w9WgXcQ', n: [], s: [row] })), 'drawings only');
  assert.equal(validPayload(mk({ ...good, n: [] })), false, 'still no notes and no shapes');
  assert.equal(validPayload(mk({ ...good, s: [] })), false, 'empty shapes list');
  assert.equal(validPayload(mk({ ...good, s: [[5, 9, 3, 20, 30, 50, 60]] })), false, 'unknown type');
  assert.equal(validPayload(mk({ ...good, s: [[5, 9, 0, 20, 30, 150, 60]] })), false, 'coordinate off the picture');
  assert.equal(validPayload(mk({ ...good, s: [[9, 5, 0, 20, 30, 50, 60]] })), false, 'ends before it starts');
  assert.equal(validPayload(mk({ ...good, s: [[5, 9, 0, 20, 30, 50]] })), false, 'short row');
  assert.equal(validPayload(mk({ ...good, s: [[5, 9, 0, 20, 30, 50, '60']] })), false, 'text where a number belongs');
  assert.equal(validPayload(mk({ ...good, s: Array.from({ length: 101 }, () => row) })), false, 'too many shapes');
  assert.ok(validPayload(mk({ ...good, s: Array.from({ length: 100 }, () => row) })));
});

test('a drawings-only link can be created and opened', async () => {
  const deps = { shares: store(), stats: store(), rates: store(), ip: '2.2.2.2' };
  const p = mk({ v: 1, id: 'dQw4w9WgXcQ', n: [], s: [[5, 9, 0, 20, 30, 50, 60]] });
  const { id } = await (await handle(post(p), deps)).json();
  assert.equal(await (await handle(get(id), deps)).text(), p);
  assert.equal((await listStats(deps.stats))[0].notes, 0);
});
