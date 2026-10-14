(() => {
  'use strict';

  // ---------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------
  const SHOW_BADGE = false;      // debug only: a small "Film Room vX" badge on the video (the version is in the panel footer)
  const DEFAULT_DURATION = 5;   // seconds a new note stays on screen
  const MIN_DURATION = 0.5;
  const MAX_DURATION = 30;
  const DURATION_STEP = 0.5;
  const AUTO_CAP = 12;          // the longest a note's automatic stay can be (long notes need time to read)
  const NOTE_FONT_MAX = 22;   // px: biggest text for notes drawn on the video
  const UI_FONT_MAX = 18;     // px: biggest text for the note box, list, and toast
  const UNDO_MS = 8000;           // how long "Undo" stays up after you delete notes
  // Quick bookmark (Alt+B): an emoji-only note dropped at the current moment, no box, video keeps playing.
  const BOOKMARK_EMOJI = '\u{1F440}';    // the built-in default (Watch this); you can pick another in the Alt+L list
  const BOOKMARK_DURATION = 3;          // seconds it stays on screen
  const BOOKMARK_WINDOW_MS = 8000;      // press 1-8 within this long to change its emoji
  // Lead-in: people press the key a moment AFTER they notice something, so new notes start a little early.
  const LEAD_CHOICES = [0, 1, 2, 3, 5]; // seconds you can choose from (saved in your settings)
  const LEAD_DEFAULT = 2;
  const PAUSE_GRACE_MS = 3000;          // paused this recently = you just stopped it to react, so still lead in
  const LIVE_EPS = 0.15;                // a note counts as on screen this much before its start: a seek can land a frame short of it
  const NUDGE_STEP = 1;                 // seconds: the - / + buttons in the note box
  // Notes on screen together stack in one column, bottom-centre of the video PICTURE,
  // clear of the broadcast scorebug (top-left). x / w are percent of the picture.
  // (y is still saved with each note for future drag-to-move, but the stack ignores it.)
  const DEFAULT_POS = { x: 25, y: 72, w: 50 };
  // Each note on the video can be dragged away from the stack and reshaped on its own (saved with the note).
  // A moved note keeps x (left edge), y (top edge) and w (width), all in % of the picture.
  const NOTE_MIN_W = 15;
  const NOTE_MAX_W = 90;
  // Text size has three steps (small / medium / large), set with the - and + buttons; medium is the default.
  // It is separate from the shape: dragging a note's corner changes its width only, never its text size.
  const SIZE_MULT = { '-1': 0.8, '0': 1, '1': 1.3 };
  const SIZE_NAMES = { '-1': 'small', '0': 'medium', '1': 'large' };
  const DRAG_SLOP = 4;          // px you must move before a note leaves the stack (so a plain click never moves it)
  const STORAGE_PREFIX = 'fr_notes:';
  const SHARED_PREFIX = 'fr_shared:';
  const AUTHOR_KEY = 'fr_author';              // an anonymous id for this install; tags the links you make
  const AUTHOR_RE = /^[A-Za-z0-9_-]{6,24}$/;
  const SETTINGS_KEY = 'fr_settings';   // { panel: true/false }: the docked-panel on/off choice
  const FIRSTRUN_KEY = 'fr_firstrun';   // true once the first-run card has been dismissed
  const EXPORT_APP = 'film-room-notes'; // marks a file made by Export
  const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
  const IMPORT_MAX_VIDEOS = 2000;
  const IMPORT_MAX_NOTES = 1000;        // per video, on import (a share link holds at most MAX_NOTES)
  const SLOW_MS = 250;                  // how often the watcher checks when no note is about to show
  const FAST_LEAD_S = 0.6;              // switch to per-frame updates this close to a note starting

  // The default emoji set: one click in the note box. Each has a meaning and a colour accent
  // (watch = amber, good = green, bad = red, ask = blue). Anything else can still be typed into the text.
  const EMOJIS = [
    { c: '\u{1F440}', k: 'watch', m: 'Watch this' },
    { c: '\u{1F3AF}', k: 'watch', m: 'Target or placement' },
    { c: '\u{1F4A1}', k: 'watch', m: 'Tip or idea' },
    { c: '\u2705', k: 'good', m: 'Good execution' },
    { c: '\u2B50', k: 'good', m: 'Great, copy this' },
    { c: '\u274C', k: 'bad', m: 'Poor execution' },
    { c: '\u26A0\uFE0F', k: 'bad', m: 'Risky choice' },
    { c: '\u{1F914}', k: 'ask', m: 'Why? Discuss this' },
  ];

  // Where the viewer page lives (GitHub Pages). Shared links point here.
  const SHARE_BASE = 'https://filmroom-viewer.netlify.app/';
  const LONG_LINK_WARN = 3500;  // characters
  const SHARE_API = SHARE_BASE + 'api/share';     // short-link service (same site as the viewer page)
  const SHORT_RE = /^s[A-Za-z0-9_-]{10}$/;        // a short link is  SHARE_BASE + '#s' + 10 characters
  const SHORT_TIMEOUT_MS = 6000;                  // give up on the service after this and use a long link

  // Share-link limits (links are untrusted input)
  const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const PAYLOAD_RE = /^[zj][A-Za-z0-9_-]+$/;
  const MAX_HASH_CHARS = 60000;
  const MAX_BYTES = 262144;
  const MAX_NOTES = 300;
  const MAX_TEXT = 300;

  // ---------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------
  let overlay = null;
  let stackEl = null;
  let debugEl = null;
  let toastEl = null;
  let toastTimer = null;
  let captureEl = null;
  let captureLabel = null;
  let textInput = null;
  let secsInput = null;      // the duration slider
  let durLabel = null;
  let emojiBtns = [];
  let shareBoxEl = null;
  let shareInput = null;
  let freeEl = null;         // holds the notes you moved away from the stack
  let noteDrag = null;
  let undoEl = null;
  let undoTimer = null;
  let undoTextEl = null;
  let undoRestore = null;    // what the Undo button brings back

  let notes = [];            // your notes for the current video, sorted by start (saved)
  let sharedNotes = [];      // notes someone shared with you, read-only (saved separately)
  let viewNotes = [];        // both, merged and sorted: what is drawn on the video
  let noteEls = [];          // DOM elements, same order as viewNotes
  let currentVideoId = null;

  let captureOpen = false;
  let captureStart = 0;
  let wasPlaying = false;
  let pickedEmoji = '';      // emoji chosen in the note box ('' = none)
  let editingId = null;      // id of the note being edited, or null for a new note
  let durTouched = false;    // does the slider decide the end? (so editing never changes a duration by accident)
  let durByUser = false;     // did YOU move the slider? Then the automatic length-based stay leaves it alone
  let editBookmarkLen = null; // length of the text-less note being edited (a bookmark that may gain words), else null
  let editSnap = null;       // a copy of the note as it was when its edit box opened (Cancel puts its place and size back)
  let lastBookmarkId = null; // the bookmark you just made (digits 1-8 change its emoji for a few seconds)
  let followPanel = null;    // a note just added: the side panel scrolls to it as soon as it can (set by followMark)
  let bookmarkEmoji = BOOKMARK_EMOJI; // what Alt+B drops (saved with your settings)
  let bmOpen = false;                 // is the Alt+B picker in the panel expanded? (it starts folded away)
  let leadIn = LEAD_DEFAULT;          // seconds new notes and bookmarks start before the key press (saved)
  let pausedAt = 0;                   // when the video was last paused (0 = playing, or you moved around while paused)
  let capturePress = 0;               // the moment you pressed the key (a frozen snapshot, never ticks)
  let pausedByUs = false;             // did the note box pause the video? (only when editing an old note)
  let startLabel = null;
  let nudgeMinus = null;
  let nudgePlus = null;
  let panelBmBtn = null;              // the + Bookmark button in the docked panel
  let captureHint = null;             // the move / reshape tip in the edit box
  let capDelBtn = null;               // Delete, in the edit box (not shown for a new note)
  let panelPrevBtn = null;            // Prev / Next in the docked panel (dimmed while there are no notes)
  let panelNextBtn = null;
  let bookmarkUntil = 0;

  let lastLayoutKey = '';

  let panelEl = null;        // the docked panel in YouTube's right column
  let panelListEl = null;
  let panelCountEl = null;
  let panelRmBtn = null;     // "Remove shared" in the header (only while notes shared with you are loaded)
  let panelBmRowEl = null;   // the Alt+B default emoji and lead-in, folded away until you open it
  let panelRows = [];
  let panelEnabled = true;   // remembered across videos and sessions
  let settingsLoaded = false;
  let lastActiveKey = '';
  let firstRunEl = null;     // the one-time "how to start" card
  let firstRunSeen = true;   // until storage says otherwise, don't show it
  let tickTimer = 0;
  let lastPanelSync = 0;

  // ---------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------
  const keyFor = (videoId) => STORAGE_PREFIX + videoId;
  const sharedKeyFor = (videoId) => SHARED_PREFIX + videoId;
  const stopEvent = (e) => e.stopPropagation();

  function isolate(el, types) {
    types.forEach((t) => el.addEventListener(t, stopEvent));
  }

  function getPlayer() {
    return document.getElementById('movie_player');
  }

  function getVideo(player) {
    const p = player || getPlayer();
    if (!p) return null;
    return p.querySelector('video.html5-main-video') || p.querySelector('video');
  }

  function fmt(seconds) {
    const t = Math.max(0, Math.floor(seconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = String(t % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + s : m + ':' + s;
  }

  // The small clapperboard mark in the list and panel headers (drawn here, so there is no image to load).
  function brandIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'fr-brand-icon');
    svg.setAttribute('aria-hidden', 'true');
    [['M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9z', '1'], ['M3.6 5.4l16-2.6.7 4L4.3 9.6z', '.8']].forEach((d) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d[0]);
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('opacity', d[1]);
      svg.appendChild(path);
    });
    return svg;
  }

  // An emoji on a tinted tile; the tint is the note's meaning colour (set by an fr-k-* class on a parent).
  function emojiTile(emoji) {
    const t = document.createElement('span');
    t.className = 'fr-tile';
    t.textContent = emoji;
    return t;
  }

  // Small person badge: this note came from someone else.
  function avatarEl() {
    const a = document.createElement('span');
    a.className = 'fr-avatar';
    a.title = 'Shared with you';
    return a;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function warn(err) {
    console.warn('[Film Room]', err);
  }

  const emojiInfo = (c) => EMOJIS.find((e) => e.c === c) || null;
  const cleanEmoji = (c) => (typeof c === 'string' && emojiInfo(c) ? c : ''); // only the default set is accepted

  // ---------------------------------------------------------------
  // SHARE-LINK CODEC
  // A link is  SHARE_BASE + '#' + payload.  The part after '#' never goes to any server.
  // payload = 'z' + base64url(deflate-raw(JSON))   or   'j' + base64url(JSON) as a fallback.
  // JSON = { v:1, id:<video id>, t:<title>, n:[[start, end, text], ...], a:<anonymous author id> }
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

  async function encodeShare(videoId, title, noteList, author) {
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
    if (!out.length) return null;
    out.sort((a, b) => a.start - b.start);
    return { id: obj.id, notes: out, author: typeof obj.a === 'string' && AUTHOR_RE.test(obj.a) ? obj.a : '' };
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

  // ---------------------------------------------------------------
  // STORAGE (chrome.storage.local): your notes and shared notes are kept apart
  // ---------------------------------------------------------------
  function save(key, value) {
    try {
      const p = chrome.storage.local.set({ [key]: value });
      if (p && p.catch) p.catch(warn);
    } catch (err) {
      warn(err); // e.g. extension was reloaded while this tab was open: refresh the tab
    }
  }

  function persist() {
    if (currentVideoId) save(keyFor(currentVideoId), notes);
  }

  // This install's anonymous author id: made once, kept in storage, put in every link you make. When a link
  // with your own id comes back to you, its notes are already yours, so they are not imported again.
  let myAuthorId = '';
  async function getAuthorId() {
    if (myAuthorId) return myAuthorId;
    try {
      const res = await chrome.storage.local.get(AUTHOR_KEY);
      const have = res && res[AUTHOR_KEY];
      if (typeof have === 'string' && AUTHOR_RE.test(have)) {
        myAuthorId = have;
        return myAuthorId;
      }
    } catch (err) {
      warn(err);
    }
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    myAuthorId = toB64Url(bytes); // 12 characters
    save(AUTHOR_KEY, myAuthorId);
    return myAuthorId;
  }

  function persistShared() {
    if (currentVideoId) save(sharedKeyFor(currentVideoId), sharedNotes);
  }

  function cleanList(list) {
    return Array.isArray(list)
      ? list.filter((n) => n && isFinite(n.start) && isFinite(n.end) && typeof n.text === 'string')
             .map((n) => cleanPlacement(Object.assign({}, n, { emoji: cleanEmoji(n.emoji) })))
             .sort((a, b) => a.start - b.start)
      : [];
  }

  function loadNotes(videoId) {
    try {
      const p = chrome.storage.local.get([keyFor(videoId), sharedKeyFor(videoId)]);
      p.then((res) => {
        if (currentVideoId !== videoId) return; // user already moved on
        notes = cleanList(res && res[keyFor(videoId)]);
        sharedNotes = cleanList(res && res[sharedKeyFor(videoId)]);
        rebuildView();
        renderNotes();
        return importFromHash(videoId);
      }).catch(warn);
    } catch (err) {
      warn(err);
    }
  }

  // If this page was opened from a shared link (youtube.com/watch?v=ID#fr=PAYLOAD), load those notes.
  async function importFromHash(videoId) {
    const h = location.hash || '';
    if (h.indexOf('#fr=') !== 0) return;
    let result = null;
    try {
      result = await decodeShare(h.slice(4));
    } catch (err) {
      warn(err);
    }
    if (currentVideoId !== videoId) return;
    try {
      history.replaceState(null, '', location.pathname + location.search); // so a refresh doesn't re-import
    } catch (err) {
      warn(err);
    }
    if (!result || result.id !== videoId) {
      toast('That shared link couldn\u2019t be read.');
      return;
    }
    const me = await getAuthorId();
    if (currentVideoId !== videoId) return;
    if (result.author && result.author === me) {
      // Your own link: these notes are already yours. Also drop old shared copies (made before links carried
      // an author id, or from your own earlier links) so nothing shows twice.
      const keep = sharedNotes.filter((n) => n.a && n.a !== me);
      if (keep.length !== sharedNotes.length) {
        sharedNotes = keep;
        persistShared();
        rebuildView();
        renderNotes();
      }
      toast('That\u2019s your own link, so your notes are already here.');
      return;
    }
    result.notes.forEach((n) => { n.a = result.author; }); // remember who these came from
    sharedNotes = result.notes;
    persistShared();
    rebuildView();
    renderNotes();
    const fresh = shownShared().length;
    toast(!fresh
      ? 'Those notes are already in your list.'
      : 'Shared notes loaded (' + fresh + (fresh < sharedNotes.length ? ' new' : '') + '). Alt+L to see them.');
  }

  // ---------------------------------------------------------------
  // BUILD UI
  // ---------------------------------------------------------------
  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'fr-overlay';

    // --- note stack: notes on screen at the same time stack upward, oldest at the bottom ---
    stackEl = document.createElement('div');
    stackEl.id = 'fr-stack';
    overlay.appendChild(stackEl);
    freeEl = document.createElement('div');
    freeEl.id = 'fr-free';
    overlay.appendChild(freeEl);
    // Clicks on notes never reach YouTube (they would pause the video); dragging is handled per note.
    [stackEl, freeEl].forEach((c) => ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerup', 'contextmenu'].forEach((t) => c.addEventListener(t, stopEvent)));

    // --- toast ---
    toastEl = document.createElement('div');
    toastEl.id = 'fr-toast';
    overlay.appendChild(toastEl);

    // --- capture / edit box (Alt+N, or the pencil in the list) ---
    captureEl = document.createElement('div');
    captureEl.id = 'fr-capture';

    const rowTop = document.createElement('div');
    rowTop.className = 'fr-cap-row';
    captureLabel = document.createElement('span');
    captureLabel.className = 'fr-cap-label';
    rowTop.appendChild(captureLabel);
    const emojiBar = document.createElement('span');
    emojiBar.className = 'fr-emojibar';
    emojiBtns = EMOJIS.map((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fr-emo fr-k-' + e.k;
      b.textContent = e.c;
      b.title = e.m;
      b.setAttribute('aria-label', e.m);
      b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep typing focus in the text box
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        pickEmoji(pickedEmoji === e.c ? '' : e.c); // click again to clear
      });
      emojiBar.appendChild(b);
      return b;
    });
    rowTop.appendChild(emojiBar);
    captureEl.appendChild(rowTop);

    // Where the note starts: a fixed line (it never ticks while you type) with - / + to fine-tune it.
    const rowStart = document.createElement('div');
    rowStart.className = 'fr-cap-row fr-cap-startrow';
    startLabel = document.createElement('span');
    startLabel.className = 'fr-cap-dur fr-cap-start';
    const mkNudge = (txt, dir, tip) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fr-btn fr-nudge';
      b.textContent = txt;
      b.title = tip;
      b.addEventListener('mousedown', (ev) => ev.preventDefault()); // keep typing focus in the text box
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        nudgeStart(dir * NUDGE_STEP);
      });
      return b;
    };
    nudgeMinus = mkNudge('\u2212 ' + NUDGE_STEP + ' s', -1, 'Start the note ' + NUDGE_STEP + ' second earlier');
    nudgePlus = mkNudge('+ ' + NUDGE_STEP + ' s', 1, 'Start the note ' + NUDGE_STEP + ' second later');
    rowStart.appendChild(startLabel);
    rowStart.appendChild(nudgeMinus);
    rowStart.appendChild(nudgePlus);
    captureEl.appendChild(rowStart);

    textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.maxLength = 200;
    textInput.placeholder = 'Add a note, or just pick an emoji';
    textInput.title = 'Enter saves \u00b7 Esc cancels';
    textInput.className = 'fr-cap-text';
    captureEl.insertBefore(textInput, rowStart); // kind, then the words, then when and how long
    textInput.addEventListener('input', syncAutoDuration);

    const rowDur = document.createElement('div');
    rowDur.className = 'fr-cap-row';
    const durCaption = document.createElement('span');
    durCaption.className = 'fr-cap-dur';
    durCaption.textContent = 'Stays';
    secsInput = document.createElement('input');
    secsInput.type = 'range';
    secsInput.min = String(MIN_DURATION);
    secsInput.max = String(MAX_DURATION);
    secsInput.step = String(DURATION_STEP);
    secsInput.className = 'fr-cap-secs';
    secsInput.title = 'How long the note stays on screen. Shorten it if the camera cuts away.';
    secsInput.addEventListener('input', () => {
      durTouched = true;
      durByUser = true;
      updateDurLabel();
    });
    durLabel = document.createElement('span');
    durLabel.className = 'fr-cap-dur fr-cap-durval';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'fr-btn fr-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', saveCapture);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'fr-btn fr-btn-text';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', cancelCapture);
    capDelBtn = document.createElement('button');
    capDelBtn.type = 'button';
    capDelBtn.className = 'fr-btn fr-btn-text fr-cap-del';
    capDelBtn.textContent = 'Delete';
    capDelBtn.title = 'Delete this note (you can undo it for a few seconds)';
    capDelBtn.style.display = 'none';
    capDelBtn.addEventListener('click', () => {
      const id = editingId;
      if (!id) return;
      closeCapture(true);
      deleteNote(id);
    });
    rowDur.appendChild(durCaption);
    rowDur.appendChild(secsInput);
    rowDur.appendChild(durLabel);
    rowDur.appendChild(saveBtn);
    rowDur.appendChild(cancelBtn);
    rowDur.appendChild(capDelBtn);
    captureEl.appendChild(rowDur);
    captureHint = document.createElement('div'); // only while editing a saved note
    captureHint.className = 'fr-cap-hint';
    captureHint.textContent = 'Drag the note on the video to move it. Drag its corner to reshape it.';
    captureEl.appendChild(captureHint);
    overlay.appendChild(captureEl);

    // --- share box: only shown if the clipboard is blocked, so the link can be copied by hand ---
    shareBoxEl = document.createElement('div');
    shareBoxEl.id = 'fr-sharebox';
    const shareLabel = document.createElement('span');
    shareLabel.className = 'fr-cap-label';
    shareLabel.textContent = 'Copy this link (Ctrl+C)';
    shareInput = document.createElement('input');
    shareInput.type = 'text';
    shareInput.readOnly = true;
    shareInput.className = 'fr-cap-text';
    const shareClose = document.createElement('button');
    shareClose.type = 'button';
    shareClose.className = 'fr-btn';
    shareClose.textContent = 'Close';
    shareClose.addEventListener('click', closeShareBox);
    shareBoxEl.appendChild(shareLabel);
    shareBoxEl.appendChild(shareInput);
    shareBoxEl.appendChild(shareClose);
    overlay.appendChild(shareBoxEl);

    // Keep YouTube's keyboard shortcuts (space, f, k, m...) from firing while typing.
    [textInput, secsInput, shareInput].forEach((input) => {
      ['keydown', 'keyup', 'keypress'].forEach((type) => input.addEventListener(type, onInputKey));
    });
    // Keep clicks in our UI from toggling play/pause or triggering the player.
    const mouseTypes = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'];
    isolate(captureEl, mouseTypes);
    isolate(shareBoxEl, mouseTypes);

    // --- undo bar (shown for a few seconds after you delete a note) ---
    undoEl = document.createElement('div');
    undoEl.id = 'fr-undo';
    undoTextEl = document.createElement('span');
    undoTextEl.textContent = 'Note deleted.';
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'fr-btn';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', undoDelete);
    undoEl.appendChild(undoTextEl);
    undoEl.appendChild(undoBtn);
    overlay.appendChild(undoEl);
    isolate(undoEl, mouseTypes);

    buildPanel();

    // --- version badge (hover for the shortcuts) ---
    if (SHOW_BADGE) {
      debugEl = document.createElement('div');
      debugEl.id = 'fr-debug';
      let ver = '';
      try {
        const m = chrome.runtime.getManifest();
        ver = m.version_name || m.version || '';
      } catch (e) { /* extension reloaded: no badge version */ }
      debugEl.textContent = 'Film Room' + (ver ? ' v' + ver : '');
      debugEl.title = 'Alt+N add note\nAlt+B bookmark\nAlt+E end note\nAlt+S share\nAlt+P panel\nAlt+, and Alt+. step through notes';
      isolate(debugEl, mouseTypes);
      overlay.appendChild(debugEl);
    }
  }

  // Merge your notes and shared notes into one sorted list for display.
  // Shared notes you don't already have. A shared note identical to one of yours (same time, length, text and
  // emoji, e.g. you opened a link to your own notes) is hidden, so nothing shows twice. Nothing is deleted:
  // if you later delete your copy, the shared one shows again.
  function shownShared() {
    return sharedNotes.filter((s) => !notes.some((n) =>
      Math.abs(n.start - s.start) < 0.05 && Math.abs(n.end - s.end) < 0.05 &&
      (n.text || '') === (s.text || '') && (n.emoji || '') === (s.emoji || '')));
  }

  function rebuildView() {
    const mine = notes.map((n) => ({ start: n.start, end: n.end, text: n.text, emoji: n.emoji || '', shared: false, ref: n }));
    const theirs = shownShared().map((n) => ({ start: n.start, end: n.end, text: n.text, emoji: n.emoji || '', shared: true, ref: n }));
    viewNotes = mine.concat(theirs).sort((a, b) => a.start - b.start || (a.shared ? 1 : 0) - (b.shared ? 1 : 0));
  }

  function renderNotes() {
    noteEls.forEach((el) => el.remove());
    noteEls = viewNotes.map((n) => {
      const el = document.createElement('div');
      const info = emojiInfo(n.emoji);
      el.className = 'fr-item fr-text' + (n.shared ? ' fr-shared' : '') + (info ? ' fr-k-' + info.k : '') +
        (n.emoji && !n.text ? ' fr-emoji-only' : '');
      if (n.emoji) {
        const em = document.createElement('span');
        em.className = 'fr-emoji fr-tile';
        em.textContent = n.emoji;
        el.appendChild(em);
      }
      if (n.text) {
        const span = document.createElement('span');
        span.className = 'fr-label';
        span.textContent = n.text; // textContent, never innerHTML
        el.appendChild(span);
      }
      if (n.shared) el.appendChild(avatarEl());
      const timer = document.createElement('span'); // time left on screen; the main loop shrinks it
      timer.className = 'fr-timer';
      el.appendChild(timer);
      el._timer = timer;
      el.title = n.shared ? 'Drag to move \u00b7 drag the corner to reshape \u00b7 \u2212 / + for text size \u00b7 double-click to put it back' : 'Double-click to edit \u00b7 drag to move \u00b7 drag the corner to reshape \u00b7 \u2212 / + for text size';
      const grip = document.createElement('span');
      grip.className = 'fr-note-grip';
      grip.title = 'Drag to reshape this note (the text size stays the same)';
      el.appendChild(grip);
      const ctl = document.createElement('span');
      ctl.className = 'fr-note-ctl';
      [['\u2212', -1, 'Smaller text'], ['+', 1, 'Bigger text']].forEach((def) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = def[0];
        b.title = def[2];
        b.addEventListener('pointerdown', stopEvent); // pressing a button never starts a drag
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          stepNoteSize(el, n.ref, def[1]);
        });
        ctl.appendChild(b);
      });
      if (!n.shared) { // a note of yours: edit it right here (the same as the pencil in the lists)
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'fr-nc-edit';
        edit.textContent = '\u270E';
        edit.title = 'Edit this note: text, emoji, how long it stays (or double-click it)';
        edit.addEventListener('pointerdown', stopEvent);
        edit.addEventListener('click', (ev) => {
          ev.stopPropagation();
          openCapture(n.ref);
        });
        ctl.appendChild(edit);
      }
      const back = document.createElement('button'); // only on a note you have moved (CSS)
      back.type = 'button';
      back.className = 'fr-nc-back';
      back.textContent = '\u21BA';
      back.title = 'Put this note back in its usual place';
      back.addEventListener('pointerdown', stopEvent);
      back.addEventListener('click', (ev) => {
        ev.stopPropagation();
        unplaceNote(n.ref);
      });
      ctl.appendChild(back);
      el.appendChild(ctl);
      el.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('.fr-note-ctl')) return;
        beginNotePointer(e.target === grip ? 'resize' : 'move', e, el, n.ref);
      });
      // Double-click edits your own note. (A note shared with you cannot be edited: there it still puts a moved note back.)
      el.addEventListener('dblclick', () => {
        if (n.shared) unplaceNote(n.ref);
        else openCapture(n.ref);
      });
      placeNoteEl(el, n.ref);
      syncNoteCtl(el, n.ref);
      return el;
    });
    markEditing();
    refreshPanel();
  }

  // Scrolling helpers for the two lists. They only ever scroll the list itself, never the page.
  function rowVisible(box, row) {
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
  }

  // Bring a row fully into view (nothing moves if it already is). False if the list is not on screen right now.
  function revealRow(box, row) {
    if (!box || !row || !box.clientHeight) return false;
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
    return true;
  }

  // A note or bookmark was just added: the panel list follows it, so the newest one is never hidden below the fold.
  function followMark(note) {
    followPanel = note;
  }

  function applyPanelFollow() {
    if (!followPanel || !panelListEl) return;
    const i = viewNotes.findIndex((v) => v.ref === followPanel);
    const row = i >= 0 ? panelRows[i] : null;
    if (!row) { followPanel = null; return; }
    if (revealRow(panelListEl, row)) followPanel = null; // otherwise the panel is not on screen: it scrolls when it is
  }

  // ---- small helpers ----
  const round1 = (v) => Math.round(v * 10) / 10;
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---- the notes on the video: each one can be moved and scaled on its own ----
  const sizeOf = (ref) => (ref && (ref.size === -1 || ref.size === 1) ? ref.size : 0);

  // A note you never touched flows in the stack (earliest on top, newest at the bottom).
  // One you moved or scaled sits where you put it, at its own size.
  function placeNoteEl(el, ref) {
    const placed = !!(ref && ref.placed === true);
    const host = placed ? freeEl : stackEl;
    if (el.parentElement !== host) host.appendChild(el);
    el.classList.toggle('fr-moved', placed);
    const mult = SIZE_MULT[sizeOf(ref)];
    el.style.fontSize = mult === 1 ? '' : mult + 'em'; // the text size comes from the - / + step, whether moved or not
    if (placed) {
      el.style.left = ref.x + '%';
      el.style.top = ref.y + '%';
      el.style.width = ref.w + '%';
    } else {
      el.style.left = el.style.top = el.style.width = '';
    }
  }

  function syncNoteCtl(el, ref) {
    const sz = sizeOf(ref);
    const btns = el.querySelectorAll('.fr-note-ctl button');
    if (btns[0]) btns[0].disabled = sz <= -1;
    if (btns[1]) btns[1].disabled = sz >= 1;
    const info = el.querySelector('.fr-note-ctl');
    if (info) info.title = 'Text size: ' + SIZE_NAMES[sz];
  }

  // The - / + on a note: one step smaller or bigger, for this note only.
  function stepNoteSize(el, ref, delta) {
    const next = clampNum(sizeOf(ref) + delta, -1, 1);
    if (next === sizeOf(ref)) return;
    if (next === 0) delete ref.size;
    else ref.size = next;
    persistNote(ref);
    placeNoteEl(el, ref);
    if (ref.placed === true && overlay) { // bigger text makes a taller box: keep it inside the picture
      const o = overlay.getBoundingClientRect();
      const hPct = o.height ? el.getBoundingClientRect().height / o.height * 100 : 0;
      if (ref.y + hPct > 100) {
        ref.y = round1(Math.max(0, 100 - hPct));
        placeNoteEl(el, ref);
        persistNote(ref);
      }
    }
    syncNoteCtl(el, ref);
  }

  // Keep a note placement sane (also used on data read back from storage)
  function cleanPlacement(n) {
    if (n.size !== -1 && n.size !== 1) delete n.size;
    if (n.placed !== true) {
      delete n.placed;
      return n;
    }
    const w = clampNum(isFinite(Number(n.w)) ? Number(n.w) : DEFAULT_POS.w, NOTE_MIN_W, NOTE_MAX_W);
    n.w = round1(w);
    n.x = round1(clampNum(isFinite(Number(n.x)) ? Number(n.x) : DEFAULT_POS.x, 0, 100 - w));
    n.y = round1(clampNum(isFinite(Number(n.y)) ? Number(n.y) : DEFAULT_POS.y, 0, 95));
    return n;
  }

  function persistNote(ref) {
    if (notes.indexOf(ref) >= 0) persist();
    else persistShared();
  }

  function unplaceNote(ref) {
    if (!ref || ref.placed !== true) return;
    delete ref.placed; // (its text size step is kept)
    ref.x = DEFAULT_POS.x;
    ref.y = DEFAULT_POS.y;
    ref.w = DEFAULT_POS.w;
    persistNote(ref);
    renderNotes();
    toast('Note put back in the stack.');
  }

  function beginNotePointer(kind, e, el, ref) {
    if (e.button != null && e.button > 0) return;
    if (!overlay || !ref) return;
    const o = overlay.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!o.width || !o.height) return;
    e.preventDefault();
    e.stopPropagation();
    noteDrag = {
      kind: kind, el: el, ref: ref, sx: e.clientX, sy: e.clientY, started: false,
      x0: (r.left - o.left) / o.width * 100, y0: (r.top - o.top) / o.height * 100, w0: r.width / o.width * 100,
      ow: o.width, oh: o.height,
    };
    const move = (ev) => {
      const d = noteDrag;
      if (!d) return;
      const dxPx = ev.clientX - d.sx;
      const dyPx = ev.clientY - d.sy;
      if (!d.started) {
        if (Math.abs(dxPx) < DRAG_SLOP && Math.abs(dyPx) < DRAG_SLOP) return; // still just a click
        d.started = true; // from here on this note is placed by you, not by the stack
        d.ref.placed = true;
        d.el.classList.add('fr-dragging');
      }
      const dx = dxPx / d.ow * 100;
      const dy = dyPx / d.oh * 100;
      let w = d.w0;
      let x = d.x0;
      let y = d.y0;
      if (d.kind === 'move') {
        x = clampNum(d.x0 + dx, 0, 100 - d.w0);
        y = d.y0 + dy;
      } else {
        w = clampNum(d.w0 + dx, NOTE_MIN_W, Math.min(NOTE_MAX_W, 100 - d.x0));
      }
      d.ref.x = round1(x);
      d.ref.w = round1(w);
      d.ref.y = round1(clampNum(y, 0, 95));
      placeNoteEl(d.el, d.ref);
      const hPct = d.el.getBoundingClientRect().height / d.oh * 100; // its height depends on its width and text
      if (d.ref.y + hPct > 100) {
        d.ref.y = round1(Math.max(0, 100 - hPct));
        placeNoteEl(d.el, d.ref);
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      const d = noteDrag;
      noteDrag = null;
      if (!d) return;
      d.el.classList.remove('fr-dragging');
      if (d.started) {
        cleanPlacement(d.ref);
        persistNote(d.ref);
        // If you let go away from the note, the browser aims the click at the player behind it, which would pause the video. Swallow it.
        const swallow = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', swallow, true);
        setTimeout(() => document.removeEventListener('click', swallow, true), 60);
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  }

  // ---------------------------------------------------------------
  // ACTIONS
  // ---------------------------------------------------------------
  function seekTo(seconds) {
    const v = getVideo();
    if (v) v.currentTime = seconds;
  }

  function deleteNote(id) {
    const gone = notes.find((n) => n.id === id);
    if (!gone) return;
    notes = notes.filter((n) => n.id !== id);
    persist();
    rebuildView();
    renderNotes();
    showUndo('Note deleted.', () => {
      if (!notes.some((n) => n.id === gone.id)) notes.push(gone);
      notes.sort((a, b) => a.start - b.start);
      followMark(gone);
      persist();
      rebuildView();
      renderNotes();
      toast('Note restored.');
    });
  }

  // Whatever you just deleted can be brought back for a few seconds (one note, or all the shared notes).
  function showUndo(label, restore) {
    if (!undoEl) return;
    undoRestore = restore;
    undoTextEl.textContent = label;
    clearTimeout(undoTimer);
    undoEl.style.display = 'flex';
    undoTimer = setTimeout(hideUndo, UNDO_MS);
  }

  function hideUndo() {
    clearTimeout(undoTimer);
    undoRestore = null;
    if (undoEl) undoEl.style.display = 'none';
  }

  function undoDelete() {
    const restore = undoRestore;
    if (!restore) return;
    hideUndo();
    restore();
  }

  // Alt+E: the camera cut away and your note is still up? End it right here.
  function endNoteHere() {
    const v = getVideo();
    if (!v) return;
    const t = v.currentTime;
    const live = notes.filter((n) => isLive(n, t));
    if (!live.length) {
      const sharedLive = shownShared().some((n) => isLive(n, t));
      toast(sharedLive ? 'The note on screen was shared with you, so you can\u2019t change it.' : 'None of your notes is on screen right now.');
      return;
    }
    const n = live.reduce((a, b) => (b.start > a.start ? b : a)); // the most recent one
    n.end = Math.round(Math.max(n.start + MIN_DURATION, Math.floor(t * 10) / 10) * 10) / 10;
    persist();
    rebuildView();
    renderNotes();
    toast('Note ends here (' + fmt(n.end) + ').');
  }

  // Is this note on screen at video time t? Jumping to a note (list click, Edit, Previous / Next) puts the video
  // exactly at the note's start, but players often land a hair before it (frame snapping), and a paused video would
  // then never show the note. So a note is live from a moment before its start.
  const isLive = (n, t) => t >= n.start - LIVE_EPS && t < n.end;

  // ---- lead-in ----
  const cleanSizeStep = (v) => (v === -1 || v === 1 ? v : 0);
  const cleanLead = (v) => (LEAD_CHOICES.indexOf(v) >= 0 ? v : LEAD_DEFAULT);

  // How far back to start a new note. Playing: the full lead-in. Paused: only if you paused a moment ago
  // (you stopped to react). A video you stepped or sat on for a while is where you meant it to be.
  function leadFor(v) {
    if (!v.paused) return leadIn;
    return pausedAt && Date.now() - pausedAt <= PAUSE_GRACE_MS ? leadIn : 0;
  }

  const startFor = (pressed, lead) => Math.max(0, Math.floor((pressed - lead) * 10 + 1e-6) / 10);

  function onVideoEvent(e) {
    const t = e.target;
    if (!t || t.tagName !== 'VIDEO') return;
    if (e.type === 'pause') pausedAt = Date.now();
    else if (e.type !== 'seeked') pausedAt = 0; // play, or a seek while paused: no longer "just paused"
    tick(); // react at once: a seek or play/pause changes what should be on screen
  }

  function setLead(n) {
    leadIn = cleanLead(n);
    saveSettings();
    renderPanelBm();
    toast(leadIn ? 'New notes will start ' + leadIn + ' s before you press.' : 'New notes will start right where you press.');
  }

  // ---- quick bookmark ----
  const bookmarkWindowActive = () => !!lastBookmarkId && Date.now() < bookmarkUntil;

  // Alt+B: one key, one bookmark. Press 1-8 right after to pick a different emoji.
  function bookmarkHere() {
    if (captureOpen) return;
    const v = getVideo();
    if (!v || !currentVideoId) return;
    const pressed = Math.floor(v.currentTime * 10 + 1e-6) / 10; // the frozen moment of the key press
    const t = startFor(pressed, leadFor(v));                  // bookmarks start a little before it
    const near = notes.find((n) => !n.text && n.emoji && Math.abs(n.start - t) < 1);
    if (near) { // a second press at the same moment never makes a duplicate
      lastBookmarkId = near.id;
      bookmarkUntil = Date.now() + BOOKMARK_WINDOW_MS;
      toast('Already bookmarked here.', BOOKMARK_WINDOW_MS, { keys: true });
      return;
    }
    const note = {
      id: newId(),
      start: t,
      end: Math.round((pressed + BOOKMARK_DURATION) * 10) / 10,
      x: DEFAULT_POS.x,
      y: DEFAULT_POS.y,
      w: DEFAULT_POS.w,
      text: '',
      emoji: bookmarkEmoji,
    };
    notes.push(note);
    notes.sort((a, b) => a.start - b.start);
    followMark(note);
    persist();
    rebuildView();
    renderNotes();
    lastBookmarkId = note.id;
    bookmarkUntil = Date.now() + BOOKMARK_WINDOW_MS;
    toast('Bookmarked at ' + fmt(t) + (t < pressed ? ' (' + round1(pressed - t) + ' s early)' : ''), BOOKMARK_WINDOW_MS, { emoji: bookmarkEmoji, keys: true });
  }

  // The + Bookmark buttons say which emoji they drop.
  function syncBookmarkButtons() {
    if (panelBmBtn) panelBmBtn.textContent = '+ Bookmark ' + bookmarkEmoji;
  }

  // Make this emoji what Alt+B drops from now on (remembered). Bookmarks you already made are not touched.
  function setBookmarkDefault(index) {
    bookmarkEmoji = EMOJIS[index].c;
    bmOpen = false;
    saveSettings();
    syncBookmarkButtons();
    renderPanelBm();
    toast('Alt+B will now drop ' + EMOJIS[index].m + '.', 3500, { emoji: EMOJIS[index].c });
  }

  function setBookmarkEmoji(index) {
    const note = notes.find((n) => n.id === lastBookmarkId);
    if (!note) return;
    note.emoji = EMOJIS[index].c;
    persist();
    rebuildView();
    renderNotes();
    bookmarkUntil = Date.now() + BOOKMARK_WINDOW_MS; // you can still change your mind
    toast(EMOJIS[index].m + ' at ' + fmt(note.start), BOOKMARK_WINDOW_MS, { emoji: EMOJIS[index].c, keys: true });
  }

  function clearShared() {
    const prev = sharedNotes;
    const count = shownShared().length;
    if (!prev.length) return;
    sharedNotes = [];
    persistShared();
    rebuildView();
    renderNotes();
    showUndo(count + (count === 1 ? ' shared note removed.' : ' shared notes removed.'), () => {
      if (sharedNotes.length) { // a new link was opened in the meantime: don't overwrite it
        toast('Newer shared notes are loaded, so the removed ones were not brought back.');
        return;
      }
      sharedNotes = prev;
      persistShared();
      rebuildView();
      renderNotes();
      toast('Shared notes restored.');
    });
  }

  // opt.emoji: show it on a tile before the message. opt.keys: add the "press 1-8 to change it" row (after Alt+B).
  function toast(message, ms, opt) {
    if (!toastEl) return;
    opt = opt || {};
    toastEl.textContent = '';
    toastEl.classList.toggle('fr-toast-tile', !!opt.emoji);
    const main = document.createElement('div');
    main.className = 'fr-toast-main';
    if (opt.emoji) {
      const info = emojiInfo(opt.emoji);
      const tile = emojiTile(opt.emoji);
      tile.classList.add('fr-toast-tile');
      if (info) tile.classList.add('fr-k-' + info.k);
      main.appendChild(tile);
    }
    const msg = document.createElement('span');
    msg.className = 'fr-toast-msg';
    msg.textContent = message;
    main.appendChild(msg);
    toastEl.appendChild(main);
    if (opt.keys) {
      const keys = document.createElement('div');
      keys.className = 'fr-toast-keys';
      const cap = document.createElement('span');
      cap.textContent = 'Change it:';
      keys.appendChild(cap);
      EMOJIS.forEach((e, i) => {
        const k = document.createElement('span');
        k.className = 'fr-toast-key';
        const num = document.createElement('i');
        num.textContent = String(i + 1);
        k.appendChild(num);
        k.appendChild(document.createTextNode(e.c));
        keys.appendChild(k);
      });
      toastEl.appendChild(keys);
    }
    toastEl.classList.add('fr-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('fr-on'), ms || 3500);
  }

  // ---- sharing ----
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // fall through to the older method
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (err) {
      return false;
    }
  }

  function closeShareBox() {
    if (shareBoxEl) shareBoxEl.style.display = 'none';
  }

  async function shareLink() {
    if (!currentVideoId) return;
    if (!notes.length) {
      toast('No notes to share yet. Press Alt+N to add one.');
      return;
    }
    const title = (document.title || '').replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/, '');
    let url;
    let isShort = false;
    try {
      const payload = await encodeShare(currentVideoId, title, notes, await getAuthorId());
      toast('Making share link\u2026');
      const id = await createShortId(payload);
      isShort = !!id;
      url = SHARE_BASE + '#' + (id ? 's' + id : payload); // service unreachable: the long link still works
    } catch (err) {
      warn(err);
      toast('Couldn\u2019t build the share link.');
      return;
    }
    const ok = await copyText(url);
    if (ok) {
      toast(!isShort && url.length > LONG_LINK_WARN
        ? 'Link copied, but it\u2019s long (' + url.length + ' characters). Some apps may cut it off.'
        : 'Share link copied (' + notes.length + (notes.length === 1 ? ' note)' : ' notes)'));
    } else {
      shareInput.value = url;
      shareBoxEl.style.display = 'flex';
      shareInput.focus();
      shareInput.select();
    }
  }

  // ---- capture / edit ----
  function pickEmoji(c) {
    pickedEmoji = c;
    emojiBtns.forEach((b, i) => b.classList.toggle('fr-sel', EMOJIS[i].c === c));
  }

  const sliderSecs = () => {
    const v = parseFloat(secsInput.value);
    return isFinite(v) ? v : DEFAULT_DURATION;
  };

  // How long a note's words need: 5 s after the press for a short one (as always), more for a long one, up to 12 s.
  function autoDuration(text) {
    const n = (text || '').trim().length;
    if (!n) return DEFAULT_DURATION;
    const secs = clampNum(2 + n / 12, DEFAULT_DURATION, AUTO_CAP);
    return Math.round(secs / DURATION_STEP) * DURATION_STEP;
  }

  // As you type, the slider follows the length of the words, until you move it yourself.
  // A new note gets its stay from the text. An old text-less note (a bookmark) that gains words gets the same stay on top
  // of what it had; an old note that already had words is never changed this way.
  function syncAutoDuration() {
    if (!captureOpen || durByUser) return;
    const text = textInput.value.trim();
    if (!editingId) {
      secsInput.value = String(autoDuration(text));
    } else if (editBookmarkLen != null) {
      if (text) {
        const len = Math.round((editBookmarkLen - BOOKMARK_DURATION + autoDuration(text)) / DURATION_STEP) * DURATION_STEP;
        secsInput.max = String(Math.max(parseFloat(secsInput.max) || MAX_DURATION, Math.ceil(len)));
        secsInput.value = String(len);
        durTouched = true; // from here the slider decides the end
      } else {
        secsInput.value = String(editBookmarkLen);
        durTouched = false; // back to a bookmark: it keeps its own end
      }
    } else {
      return;
    }
    updateDurLabel();
    updateStartLabel();
  }

  // Where the note will end. A new note stays up for the chosen time after you PRESSED the key
  // (so the lead-in seconds are extra, not taken out of it). An old note keeps its end unless you move the slider.
  function captureEndTime() {
    if (!editingId) return round1(capturePress + sliderSecs());
    if (durTouched) return round1(captureStart + sliderSecs());
    const n = notes.find((x) => x.id === editingId);
    return n ? n.end : round1(captureStart + sliderSecs());
  }

  function updateDurLabel() {
    durLabel.textContent = sliderSecs().toFixed(1) + ' s  \u00b7  ends at ' + fmt(captureEndTime());
  }

  function updateStartLabel() {
    let txt = 'Starts ' + fmt(captureStart);
    if (!editingId && capturePress > captureStart) txt += '  \u00b7  you pressed ' + fmt(capturePress);
    startLabel.textContent = txt;
    nudgeMinus.disabled = captureStart <= 0;
    nudgePlus.disabled = captureStart >= (editingId ? captureEndTime() - MIN_DURATION : capturePress) - 1e-6;
  }

  function nudgeStart(delta) {
    if (!captureOpen) return;
    const maxStart = editingId ? captureEndTime() - MIN_DURATION : capturePress;
    const next = round1(clampNum(captureStart + delta, 0, Math.max(0, maxStart)));
    if (next === captureStart) return;
    if (editingId) {
      const n = notes.find((x) => x.id === editingId);
      if (n && !durTouched) { // keep the end where it was; the slider shows the new length
        const len = Math.max(MIN_DURATION, round1(n.end - next));
        secsInput.max = String(Math.max(parseFloat(secsInput.max) || MAX_DURATION, Math.ceil(len)));
        secsInput.value = String(len);
      }
      const v = getVideo();
      if (v) v.currentTime = next; // show where it now starts
    }
    captureStart = next;
    updateStartLabel();
    updateDurLabel();
  }

  // note = one of your own notes to edit; leave it out for a new note at the current moment.
  function openCapture(note) {
    if (!overlay || captureOpen) return;
    const video = getVideo();
    if (!video) return;

    wasPlaying = !video.paused;
    editingId = note ? note.id : null;
    durTouched = false;
    durByUser = false;
    editBookmarkLen = note && !note.text ? round1(note.end - note.start) : null;
    editSnap = note ? JSON.parse(JSON.stringify(note)) : null;
    // Only editing an old note pauses (and jumps to it). A NEW note leaves the video exactly as it is:
    // playing keeps playing, paused stays paused. The start time is frozen right now, at the key press.
    pausedByUs = !!note;
    if (note) video.pause();

    if (note) {
      captureStart = note.start;
      video.currentTime = note.start; // show the note on screen while you edit it
      const dur = Math.round((note.end - note.start) * 10) / 10;
      secsInput.max = String(Math.max(MAX_DURATION, Math.ceil(dur)));
      secsInput.value = String(dur);
      textInput.value = note.text;
      pickEmoji(note.emoji || '');
    } else {
      capturePress = Math.floor(video.currentTime * 10 + 1e-6) / 10; // floor, so the note is already live at this moment
      captureStart = startFor(capturePress, leadFor(video));
      secsInput.max = String(MAX_DURATION);
      secsInput.value = String(DEFAULT_DURATION);
      textInput.value = '';
      pickEmoji('');
    }

    captureLabel.textContent = note ? 'Edit note' : 'New note';
    updateStartLabel();
    updateDurLabel();
    // Editing: the box opens on the half of the picture the note is NOT in, so the note stays free to grab.
    captureEl.classList.toggle('fr-cap-top', !!note && (note.placed === true ? note.y > 40 : true));
    captureHint.style.display = note ? 'block' : 'none';
    capDelBtn.style.display = note ? '' : 'none';
    captureEl.style.display = 'flex';
    if (overlay) overlay.classList.add('fr-capturing'); // the notes step back while you write
    captureOpen = true;
    markEditing();
    textInput.focus();
  }

  // The note being edited stays bright, outlined and grabbable while the rest step back.
  function markEditing() {
    noteEls.forEach((el, i) => {
      const vn = viewNotes[i];
      el.classList.toggle('fr-editing', !!(captureOpen && editingId && vn && !vn.shared && vn.ref && vn.ref.id === editingId));
    });
  }

  // Cancel: close the box and put the note back as it was (its place and size too, which you can change while editing).
  function cancelCapture() {
    if (captureOpen && editingId && editSnap) {
      const n = notes.find((x) => x.id === editingId);
      if (n) {
        const keys = ['x', 'y', 'w', 'placed', 'size'];
        const before = JSON.stringify(keys.map((k) => n[k]));
        keys.forEach((k) => {
          if (editSnap[k] === undefined) delete n[k];
          else n[k] = editSnap[k];
        });
        if (JSON.stringify(keys.map((k) => n[k])) !== before) {
          persist();
          renderNotes();
        }
      }
    }
    closeCapture(true);
  }

  function closeCapture(resume) {
    if (!captureEl) return;
    captureEl.style.display = 'none';
    if (overlay) overlay.classList.remove('fr-capturing');
    captureOpen = false;
    editingId = null;
    editSnap = null;
    editBookmarkLen = null;
    markEditing();
    textInput.blur();
    const resumeIt = resume && wasPlaying && pausedByUs;
    pausedByUs = false;
    if (resumeIt) {
      const v = getVideo();
      if (v) {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      }
    }
  }

  function saveCapture() {
    const text = textInput.value.trim();
    if (!text && !pickedEmoji) {
      if (editingId) {
        toast('Add some text or pick an emoji first.');
        return;
      }
      closeCapture(true); // a new note with nothing in it is just cancelled
      return;
    }

    const editing = editingId ? notes.find((n) => n.id === editingId) : null;
    if (editingId && !editing) {
      closeCapture(true); // the note was deleted while the box was open
      return;
    }

    const maxSecs = parseFloat(secsInput.max) || MAX_DURATION;
    let secs = parseFloat(secsInput.value);
    if (!isFinite(secs)) secs = DEFAULT_DURATION;
    secs = Math.min(maxSecs, Math.max(MIN_DURATION, secs));

    if (editing) {
      const end = captureEndTime(); // before the start moves
      editing.text = text;
      editing.emoji = pickedEmoji;
      editing.start = captureStart;  // you may have nudged it
      editing.end = Math.max(end, round1(captureStart + MIN_DURATION));
    } else {
      const added = {
        id: newId(),
        start: captureStart,
        end: Math.round((capturePress + secs) * 10) / 10,
        x: DEFAULT_POS.x,
        y: DEFAULT_POS.y,
        w: DEFAULT_POS.w,
        text: text,
        emoji: pickedEmoji,
      };
      notes.push(added);
      followMark(added); // the lists scroll to the new note (an edit never moves them)
    }
    notes.sort((a, b) => a.start - b.start);

    persist();
    rebuildView();
    renderNotes();
    closeCapture(true);
  }

  function onInputKey(e) {
    e.stopPropagation(); // never let YouTube see keys typed into our boxes
    if (e.type !== 'keydown') return;
    if (e.target === shareInput) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeShareBox();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      saveCapture();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCapture();
    }
  }

  function onKeyDown(e) {
    if (!overlay || overlay.style.display !== 'block') return; // not on a watch page, or an ad is playing
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Digits 1-8, only for a few seconds after Alt+B: pick the emoji (and keep YouTube from jumping the video).
    if (bookmarkWindowActive() && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Digit[1-8]$/.test(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      setBookmarkEmoji(parseInt(e.code.slice(5), 10) - 1);
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    if (e.code === 'KeyN') {
      e.preventDefault();
      e.stopPropagation();
      dismissFirstRun();
      openCapture();
    } else if (e.code === 'KeyS') {
      e.preventDefault();
      e.stopPropagation();
      shareLink();
    } else if (e.code === 'KeyB') {
      e.preventDefault();
      e.stopPropagation();
      dismissFirstRun();
      bookmarkHere();
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      e.stopPropagation();
      endNoteHere();
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      e.stopPropagation();
      setPanel(!panelEnabled);
    } else if (e.code === 'Period') {
      e.preventDefault();
      e.stopPropagation();
      stepNote(1);
    } else if (e.code === 'Comma') {
      e.preventDefault();
      e.stopPropagation();
      stepNote(-1);
    }
  }


  // ---------------------------------------------------------------
  // BACKUP: Export all your notes to a file, Import them on another computer (or after a reinstall).
  // The file is plain JSON:  { app, v:1, exported, notes: { <videoId>: [ ...your notes ] } }.
  // Import is a merge: notes already there (same time, length, text and emoji) are skipped, nothing is overwritten.
  // ---------------------------------------------------------------
  async function exportAll() {
    let all;
    try {
      all = await chrome.storage.local.get(null);
    } catch (err) {
      warn(err);
      toast('Couldn’t read your notes. Reload the tab and try again.');
      return;
    }
    const out = {};
    let count = 0;
    let videos = 0;
    Object.keys(all || {}).forEach((k) => {
      if (k.indexOf(STORAGE_PREFIX) !== 0) return;
      const id = k.slice(STORAGE_PREFIX.length);
      const list = all[k];
      if (!YT_ID_RE.test(id) || !Array.isArray(list) || !list.length) return;
      out[id] = list;
      count += list.length;
      videos++;
    });
    if (!count) {
      toast('No notes to export yet.');
      return;
    }
    const file = { app: EXPORT_APP, v: 1, exported: new Date().toISOString(), notes: out };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'film-room-notes-' + new Date().toISOString().slice(0, 10) + '.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Exported ' + count + (count === 1 ? ' note' : ' notes') + ' from ' + videos + (videos === 1 ? ' video.' : ' videos.'), 5000);
  }

  // A note read from an import file is untrusted: keep only what a note is allowed to hold.
  function cleanImported(row) {
    if (!row || typeof row !== 'object') return null;
    const start = Number(row.start);
    const end = Number(row.end);
    if (!isFinite(start) || !isFinite(end) || start < 0 || start > 1000000 || end <= start || end - start > 3600) return null;
    const text = typeof row.text === 'string' ? row.text.trim().slice(0, MAX_TEXT) : '';
    const emoji = cleanEmoji(row.emoji);
    if (!text && !emoji) return null;
    const n = { id: '', start: round1(start), end: round1(end), text: text, emoji: emoji };
    ['placed', 'x', 'y', 'w', 'size'].forEach((k) => { if (row[k] !== undefined) n[k] = row[k]; });
    return cleanPlacement(n);
  }

  const sameNote = (a, b) =>
    Math.abs(a.start - b.start) < 0.05 && Math.abs(a.end - b.end) < 0.05 &&
    (a.text || '') === (b.text || '') && (a.emoji || '') === (b.emoji || '');

  async function importFile(file) {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      toast('That file is too big to be a Film Room export.');
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      toast('That isn’t a Film Room export file.');
      return;
    }
    if (!data || data.app !== EXPORT_APP || data.v !== 1 || !data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) {
      toast('That isn’t a Film Room export file.');
      return;
    }
    const ids = Object.keys(data.notes).filter((id) => YT_ID_RE.test(id)).slice(0, IMPORT_MAX_VIDEOS);
    if (!ids.length) {
      toast('No notes found in that file.');
      return;
    }
    let existing;
    try {
      existing = await chrome.storage.local.get(ids.map(keyFor));
    } catch (err) {
      warn(err);
      toast('Couldn’t read your notes. Reload the tab and try again.');
      return;
    }
    const used = new Set();
    const fresh = () => {
      let id;
      do { id = newId(); } while (used.has(id));
      used.add(id);
      return id;
    };
    const writes = {};
    let added = 0;
    let skipped = 0;
    let touched = 0;
    ids.forEach((vid) => {
      const incoming = Array.isArray(data.notes[vid]) ? data.notes[vid].slice(0, IMPORT_MAX_NOTES) : [];
      const have = cleanList(existing && existing[keyFor(vid)]);
      have.forEach((n) => used.add(n.id));
      let changed = false;
      incoming.forEach((row) => {
        const n = cleanImported(row);
        if (!n) return;
        if (have.some((h) => sameNote(h, n))) { skipped++; return; }
        n.id = fresh();
        have.push(n);
        added++;
        changed = true;
      });
      if (changed) {
        have.sort((a, b) => a.start - b.start);
        writes[keyFor(vid)] = have;
        touched++;
      }
    });
    if (!added) {
      toast(skipped ? 'Everything in that file is already here.' : 'No usable notes in that file.');
      return;
    }
    try {
      await chrome.storage.local.set(writes);
    } catch (err) {
      warn(err);
      toast('Couldn’t save the imported notes.');
      return;
    }
    if (currentVideoId) loadNotes(currentVideoId); // show them now if this video was in the file
    toast('Imported ' + added + (added === 1 ? ' note' : ' notes') + ' across ' + touched + (touched === 1 ? ' video' : ' videos') +
      (skipped ? ' (' + skipped + ' already here).' : '.'), 5000);
  }

  // ---------------------------------------------------------------
  // FIRST RUN: one small card the first time Film Room is on a video. Gone for good once dismissed,
  // or as soon as you press Alt+B or Alt+N yourself.
  // ---------------------------------------------------------------
  function dismissFirstRun() {
    if (firstRunSeen) return;
    firstRunSeen = true;
    if (firstRunEl) firstRunEl.classList.remove('fr-on');
    save(FIRSTRUN_KEY, true);
  }

  function buildFirstRun() {
    firstRunEl = document.createElement('div');
    firstRunEl.id = 'fr-firstrun';
    const head = document.createElement('div');
    head.className = 'fr-fr-title';
    head.textContent = 'Film Room is on for this video';
    firstRunEl.appendChild(head);
    const kb = (k) => {
      const el = document.createElement('kbd');
      el.textContent = k;
      return el;
    };
    [['B', 'drops a bookmark while the video plays'], ['N', 'adds a note with words or an emoji'], ['S', 'copies a link to share your notes']].forEach((r) => {
      const line = document.createElement('div');
      line.className = 'fr-fr-line';
      line.appendChild(kb('Alt'));
      line.appendChild(document.createTextNode('+'));
      line.appendChild(kb(r[0]));
      line.appendChild(document.createTextNode(r[1]));
      firstRunEl.appendChild(line);
    });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'fr-btn fr-btn-primary';
    ok.textContent = 'Got it';
    ok.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissFirstRun();
    });
    firstRunEl.appendChild(ok);
    ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'].forEach((t) => firstRunEl.addEventListener(t, stopEvent));
    overlay.appendChild(firstRunEl);
  }

  function maybeShowFirstRun() {
    if (firstRunSeen || !overlay || !settingsLoaded || captureOpen) return;
    if (!firstRunEl) buildFirstRun();
    if (!firstRunEl.classList.contains('fr-on')) firstRunEl.classList.add('fr-on');
  }

  // ---------------------------------------------------------------
  // DOCKED PANEL: the timestamped list with Previous / Next, docked in YouTube's right column.
  // On/off is remembered (Alt+P, or the buttons). It only appears when the video has notes.
  // ---------------------------------------------------------------
  function saveSettings() {
    save(SETTINGS_KEY, { panel: panelEnabled, bookmark: bookmarkEmoji, lead: leadIn });
  }

  function loadSettings() {
    try {
      chrome.storage.local.get([SETTINGS_KEY, FIRSTRUN_KEY]).then((res) => {
        const st = res && res[SETTINGS_KEY];
        firstRunSeen = !!(res && res[FIRSTRUN_KEY]);
        if (st && typeof st.panel === 'boolean') panelEnabled = st.panel;
        bookmarkEmoji = cleanEmoji(st && st.bookmark) || BOOKMARK_EMOJI;
        leadIn = cleanLead(st && st.lead);
        syncBookmarkButtons();
        renderPanelBm();
        settingsLoaded = true;
        syncPanel();
      }).catch((err) => {
        warn(err);
        settingsLoaded = true;
      });
    } catch (err) {
      warn(err);
      settingsLoaded = true;
    }
  }

  // The toolbar button (background.js) and other tabs change the settings through storage: follow them live.
  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[SETTINGS_KEY]) return;
        const v = changes[SETTINGS_KEY].newValue;
        const be = cleanEmoji(v && v.bookmark) || BOOKMARK_EMOJI;
        if (be !== bookmarkEmoji) { // the Alt+B default was changed in another tab
          bookmarkEmoji = be;
          syncBookmarkButtons();
          renderPanelBm();
        }
        const ld = cleanLead(v && v.lead);
        if (ld !== leadIn) { // the lead-in was changed in another tab
          leadIn = ld;
          renderPanelBm();
        }
        const on = !(v && v.panel === false);
        if (on === panelEnabled) return; // our own change, already handled
        panelEnabled = on;
        syncPanel();
        toast(on ? 'Docked panel on.' : 'Docked panel off.');
      });
    } catch (err) {
      warn(err);
    }
  }

  function setPanel(on) {
    panelEnabled = on;
    saveSettings();
    syncPanel();
    toast(on
      ? 'Docked panel on.'
      : 'Docked panel hidden. Click the Film Room toolbar button or press Alt+P to bring it back.');
  }

  // The word part of a Prev / Next button: hidden when the panel is narrow, leaving just the arrow.
  function lblSpan(text) {
    const sp = document.createElement('span');
    sp.className = 'fr-lbl';
    sp.textContent = text;
    return sp;
  }

  function panelButton(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the video, so space still pauses
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.id = 'fr-panel';

    const head = document.createElement('div');
    head.className = 'fr-panel-head';
    const title = document.createElement('span');
    title.className = 'fr-panel-title';
    title.appendChild(brandIcon());
    title.appendChild(document.createTextNode('Film Room'));
    panelCountEl = document.createElement('span');
    panelCountEl.className = 'fr-panel-count';
    head.appendChild(title);
    head.appendChild(panelCountEl);
    panelRmBtn = panelButton('Remove shared', 'fr-panel-hide fr-panel-rm', () => clearShared());
    panelRmBtn.title = 'Remove the notes shared with you (your own notes are not affected). You can undo it for a few seconds.';
    panelRmBtn.style.display = 'none';
    head.appendChild(panelRmBtn);
    head.appendChild(panelButton('Hide', 'fr-panel-hide', () => setPanel(false)));
    panelEl.appendChild(head);

    const steps = document.createElement('div');
    steps.className = 'fr-panel-steps';
    const prevBtn = panelButton('', 'fr-panel-btn', () => stepNote(-1));
    panelPrevBtn = prevBtn;
    prevBtn.appendChild(document.createTextNode('\u2039'));
    prevBtn.appendChild(lblSpan(' Prev'));
    prevBtn.title = 'Previous note (Alt+,)';
    const nextBtn = panelButton('', 'fr-panel-btn', () => stepNote(1));
    panelNextBtn = nextBtn;
    nextBtn.appendChild(lblSpan('Next '));
    nextBtn.appendChild(document.createTextNode('\u203a'));
    nextBtn.title = 'Next note (Alt+.)';
    steps.appendChild(prevBtn);
    steps.appendChild(nextBtn);
    const noteBtn = panelButton('+ Note', 'fr-panel-btn fr-panel-note', () => openCapture());
    noteBtn.title = 'Add a note at this moment (same as Alt+N)';
    steps.appendChild(noteBtn);
    panelBmBtn = panelButton('+ Bookmark ' + bookmarkEmoji, 'fr-panel-btn fr-panel-bm', () => bookmarkHere());
    panelBmBtn.title = 'Drop a bookmark at this moment (same as Alt+B)';
    steps.appendChild(panelBmBtn);
    panelEl.appendChild(steps);

    panelListEl = document.createElement('div');
    panelListEl.className = 'fr-panel-list';
    panelEl.appendChild(panelListEl);

    panelBmRowEl = document.createElement('div');
    panelBmRowEl.className = 'fr-pbm-row';
    panelEl.appendChild(panelBmRowEl);
    const copyBtn = panelButton('Copy link', 'fr-panel-copy', () => shareLink());
    copyBtn.title = 'Copy a share link to your notes (Alt+S)';
    panelEl.appendChild(copyBtn);
    // Backup: all your notes to a file and back (for a second computer, a reinstall, or a safety copy).
    const fileRow = document.createElement('div');
    fileRow.className = 'fr-panel-files';
    const exportBtn = panelButton('Export notes', 'fr-panel-copy', () => exportAll());
    exportBtn.title = 'Save all your notes (every video) to a file';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json,application/json';
    importInput.style.display = 'none';
    importInput.addEventListener('change', () => {
      const f = importInput.files && importInput.files[0];
      importInput.value = '';
      importFile(f);
    });
    const importBtn = panelButton('Import notes', 'fr-panel-copy', () => importInput.click());
    importBtn.title = 'Add notes from a file made by Export (nothing is overwritten)';
    fileRow.appendChild(exportBtn);
    fileRow.appendChild(importBtn);
    fileRow.appendChild(importInput);
    panelEl.appendChild(fileRow);
    renderPanelBm();

    const foot = document.createElement('div');
    foot.className = 'fr-panel-foot';
    const keyCap = (k) => {
      const kb = document.createElement('kbd');
      kb.textContent = k;
      return kb;
    };
    const say = (t) => document.createTextNode(t);
    [keyCap('Alt'), keyCap('P'), say('hides this panel'), say('\u00b7'), keyCap('Alt'), keyCap(','), keyCap('Alt'), keyCap('.'), say('step through notes')]
      .forEach((n) => foot.appendChild(n));
    let ver = '';
    try {
      const m = chrome.runtime.getManifest();
      ver = m.version_name || m.version || '';
    } catch (e) { /* extension reloaded: no version */ }
    if (ver) {
      const v = document.createElement('span');
      v.className = 'fr-panel-ver';
      v.textContent = 'v' + ver;
      foot.appendChild(v);
    }
    panelEl.appendChild(foot);
  }

  // Alt+B settings: folded it is one quiet line ("Alt+B bookmark 👀 · 2 s early ▾"); click it to pick the default emoji and lead-in.
  // (Pressing 1-8 right after Alt+B only changes that one note, never this default.)
  function renderPanelBm() {
    if (!panelBmRowEl) return;
    panelBmRowEl.textContent = '';
    panelBmRowEl.classList.toggle('fr-open', bmOpen);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'fr-pbm-toggle';
    toggle.title = 'Choose what Alt+B drops, and how early it starts';
    const label = document.createElement('span');
    label.className = 'fr-pbm-label';
    label.textContent = 'Alt+B bookmark';
    const cur = document.createElement('span');
    cur.className = 'fr-pbm-cur';
    cur.textContent = bookmarkEmoji;
    const lead = document.createElement('span');
    lead.className = 'fr-pbm-lead';
    lead.textContent = leadIn ? '\u00b7 ' + leadIn + ' s early' : '\u00b7 no lead-in';
    const chev = document.createElement('span');
    chev.className = 'fr-pbm-chev';
    chev.textContent = bmOpen ? '\u25B4' : '\u25BE';
    toggle.appendChild(label);
    toggle.appendChild(cur);
    toggle.appendChild(lead);
    toggle.appendChild(chev);
    toggle.addEventListener('mousedown', (e) => e.preventDefault());
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      bmOpen = !bmOpen;
      renderPanelBm();
    });
    panelBmRowEl.appendChild(toggle);
    if (!bmOpen) return;
    const opts = document.createElement('div');
    opts.className = 'fr-pbm-opts';
    EMOJIS.forEach((em, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fr-pbm-emo' + (em.c === bookmarkEmoji ? ' fr-sel' : '');
      b.textContent = em.c;
      b.title = em.m + ' \u00b7 make this the Alt+B bookmark';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        setBookmarkDefault(i);
      });
      opts.appendChild(b);
    });
    panelBmRowEl.appendChild(opts);
    // How many seconds before you press that new notes and bookmarks start.
    const leads = document.createElement('div');
    leads.className = 'fr-pbm-leads';
    const cap = document.createElement('span');
    cap.className = 'fr-pbm-leadcap';
    cap.textContent = 'Start early by';
    leads.appendChild(cap);
    LEAD_CHOICES.forEach((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fr-pbm-leadbtn' + (n === leadIn ? ' fr-sel' : '');
      b.textContent = n + ' s';
      b.title = n ? 'New notes and bookmarks start ' + n + ' s before you press the key' : 'No lead-in: start exactly where you press';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        setLead(n);
      });
      leads.appendChild(b);
    });
    panelBmRowEl.appendChild(leads);
  }

  // One chronological timeline: your notes and shared notes together, shared ones tagged.
  function refreshPanel() {
    if (!panelEl) return;
    const keepScroll = panelListEl.scrollTop; // a rebuild must not throw you back to the top
    panelListEl.textContent = '';
    panelRows = viewNotes.map((n) => {
      const row = document.createElement('div');
      const info = emojiInfo(n.emoji);
      const emojiOnly = !!(n.emoji && !n.text);
      row.className = 'fr-prow' + (n.shared ? ' fr-pshared' : '') + (info ? ' fr-k-' + info.k : '') + (emojiOnly ? ' fr-emoji-row' : '');
      row.title = info ? info.m + ' \u00b7 click to jump to this note' : 'Jump to this note';
      const time = document.createElement('span');
      time.className = 'fr-ptime';
      time.textContent = fmt(n.start);
      const txt = document.createElement('span');
      txt.className = 'fr-ptext';
      txt.textContent = n.text; // textContent, never innerHTML
      row.appendChild(time);
      if (n.emoji) row.appendChild(emojiTile(n.emoji));
      row.appendChild(txt);
      if (emojiOnly && info) {
        const meaning = document.createElement('span');
        meaning.className = 'fr-pmeaning';
        meaning.textContent = info.m;
        row.appendChild(meaning);
      }
      if (n.shared) {
        const who = document.createElement('span');
        who.className = 'fr-pwho';
        who.appendChild(avatarEl());
        who.appendChild(document.createTextNode('Shared'));
        row.appendChild(who);
      }
      if (!n.shared && n.ref) { // your own note: edit or delete it right here (a shared one is read-only)
        const acts = document.createElement('span');
        acts.className = 'fr-pacts';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'fr-pedit';
        edit.textContent = '\u270E';
        edit.title = 'Edit this note: text, emoji, how long it stays';
        edit.addEventListener('click', (e) => {
          e.stopPropagation();
          openCapture(n.ref);
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'fr-pdel';
        del.textContent = '\u00d7';
        del.title = 'Delete this note (you can undo it for a few seconds)';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteNote(n.ref.id);
        });
        acts.appendChild(edit);
        acts.appendChild(del);
        row.appendChild(acts);
      }
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => seekTo(n.start));
      panelListEl.appendChild(row);
      return row;
    });
    if (!viewNotes.length) { // nothing yet: say how to start (the panel is here so + Note and + Bookmark are too)
      const hint = document.createElement('div');
      hint.className = 'fr-pempty';
      hint.textContent = 'No notes yet. Press Alt+N, or click + Note, to start.';
      panelListEl.appendChild(hint);
    }
    if (panelPrevBtn) panelPrevBtn.disabled = !viewNotes.length;
    if (panelNextBtn) panelNextBtn.disabled = !viewNotes.length;
    const shared = viewNotes.filter((n) => n.shared).length;
    panelCountEl.textContent = viewNotes.length + (viewNotes.length === 1 ? ' note' : ' notes') +
      (shared ? ' \u00b7 ' + shared + ' shared' : '');
    if (panelRmBtn) panelRmBtn.style.display = shared ? '' : 'none';
    lastActiveKey = ''; // force the highlight to refresh on the next frame
    syncPanel();
    panelListEl.scrollTop = keepScroll;
    applyPanelFollow();
  }

  // Show the panel whenever it is on (even with no notes yet, so + Note and + Bookmark are always there); dock it in the right column.
  // If YouTube's layout has no right column (fullscreen, a layout change), the panel simply stays out.
  function syncPanel() {
    if (!panelEl) return;
    const want = settingsLoaded && panelEnabled;
    if (!want) {
      if (panelEl.parentElement) panelEl.remove();
      return;
    }
    if (panelEl.isConnected) return;
    const host = document.querySelector('#secondary-inner') || document.querySelector('#secondary');
    if (host) {
      host.insertBefore(panelEl, host.firstChild);
      applyPanelFollow(); // a mark added while the panel was out of the page
    }
  }

  function highlightPanel(activeKey) {
    const on = new Set(activeKey.split(',').filter(Boolean).map(Number));
    let first = null;
    panelRows.forEach((row, i) => {
      const isOn = on.has(i);
      row.classList.toggle('fr-on', isOn);
      if (isOn && !first) first = row;
    });
    // Keep the current note visible inside the panel, without scrolling the page. If a live row is already
    // in view (say the note you just added), leave the scroll alone.
    if (first && panelListEl && panelListEl.clientHeight) {
      const anyVisible = panelRows.some((row, i) => on.has(i) && rowVisible(panelListEl, row));
      if (!anyVisible) revealRow(panelListEl, first);
    }
  }

  // Previous / next note across your notes and shared notes together.
  function stepNote(dir) {
    const v = getVideo();
    if (!v || !viewNotes.length) return;
    const t = v.currentTime;
    if (dir > 0) {
      const next = viewNotes.find((n) => n.start > t + 0.25);
      if (next) seekTo(next.start);
      else toast('That was the last note.');
    } else {
      let target = null;
      viewNotes.forEach((n) => { if (n.start < t - 1.5) target = n.start; });
      seekTo(target == null ? viewNotes[0].start : target); // well into a note: restart it; just after its start: the one before
    }
  }

  // ---------------------------------------------------------------
  // LAYOUT + MAIN LOOP
  // ---------------------------------------------------------------
  // Size and position the overlay to match the visible picture, not the whole player.
  function layout(player, video) {
    const p = player.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    const left = Math.round(v.left - p.left);
    const top = Math.round(v.top - p.top);
    const width = Math.round(v.width);
    const height = Math.round(v.height);
    const key = [left, top, width, height].join(',');
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;

    const s = overlay.style;
    s.left = left + 'px';
    s.top = top + 'px';
    s.width = width + 'px';
    s.height = height + 'px';
    // Notes on the video scale with the picture, but never get huge on a wide window.
    s.fontSize = Math.min(NOTE_FONT_MAX, Math.max(12, width * 0.0145)) + 'px';
    // The tools (note box, list, toast) are for reading up close, so they stay small and steady.
    s.setProperty('--fr-ui', Math.min(UI_FONT_MAX, Math.max(12, width * 0.014)) + 'px');
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
    if (panelEl && panelEl.parentElement) panelEl.remove(); // not on a watch page, or an ad is playing
  }

  function switchVideo(videoId) {
    currentVideoId = videoId;
    closeCapture(false);
    closeShareBox();
    bmOpen = false;
    hideUndo();
    notes = [];
    sharedNotes = [];
    rebuildView();
    renderNotes();
    loadNotes(videoId);
  }

  // The video id for the page we are on. Regular videos are /watch?v=ID; live streams and their replays
  // can be /live/ID. Both use the same player, so notes made on one show on the other.
  function pageVideoId() {
    if (location.pathname === '/watch') {
      const v = new URLSearchParams(location.search).get('v');
      return v || null;
    }
    const m = location.pathname.match(/^\/live\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    return m ? m[1] : null;
  }

  // The watcher. It used to run every frame forever; now it runs 4 times a second, and only goes to
  // per-frame updates while the video is playing AND a note is showing or about to show (so the
  // countdown bar is smooth). This still covers YouTube's in-page navigation (no full reload).
  let frameReq = 0;
  function schedule(fast) {
    if (frameReq) { cancelAnimationFrame(frameReq); frameReq = 0; }
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = 0; }
    if (fast && !document.hidden) frameReq = requestAnimationFrame(() => { frameReq = 0; tick(); });
    else tickTimer = setTimeout(() => { tickTimer = 0; tick(); }, SLOW_MS);
  }

  function tick() {
    const videoId = pageVideoId(); // from /watch?v=ID or /live/ID; null on any other page
    const player = videoId ? getPlayer() : null;
    const video = player ? getVideo(player) : null;

    if (!player || !video || !video.videoWidth || !videoId) {
      hideOverlay();
      schedule(false);
      return;
    }

    if (!overlay) buildOverlay();
    if (overlay.parentElement !== player) {
      player.appendChild(overlay);
      lastLayoutKey = '';
    }
    if (videoId !== currentVideoId) switchVideo(videoId);

    // Hide while an ad is playing: during ads, currentTime belongs to the ad, not the video.
    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) {
      hideOverlay();
      schedule(false);
      return;
    }

    overlay.style.display = 'block';
    layout(player, video);

    const t = video.currentTime;
    let active = 0;
    let activeKey = '';
    let soon = false;
    for (let i = 0; i < viewNotes.length; i++) {
      const on = isLive(viewNotes[i], t);
      if (on) {
        active++;
        activeKey += i + ',';
      } else if (viewNotes[i].start > t && viewNotes[i].start - t < FAST_LEAD_S) {
        soon = true;
      }
      if (noteEls[i]) {
        noteEls[i].classList.toggle('fr-on', on);
        if (on && noteEls[i]._timer) {
          const span = viewNotes[i].end - viewNotes[i].start;
          const left = span > 0 ? clampNum((viewNotes[i].end - t) / span, 0, 1) : 0;
          noteEls[i]._timer.style.width = (left * 100).toFixed(1) + '%';
        }
      }
    }
    if (activeKey !== lastActiveKey) {
      lastActiveKey = activeKey;
      highlightPanel(activeKey);
    }
    const nowMs = Date.now();
    if (nowMs - lastPanelSync >= SLOW_MS) { // re-docks the panel if YouTube re-rendered its page
      lastPanelSync = nowMs;
      syncPanel();
      maybeShowFirstRun();
    }
    schedule(!video.paused && (active > 0 || soon));
  }

  // ---------------------------------------------------------------
  // VIEWER PAGE: a person with the extension who opens a shared link goes straight to
  // YouTube with the notes on the video. (Add ?plain to the link to see the plain viewer page.)
  // ---------------------------------------------------------------
  // The viewer page (links that pointed at the retired GitHub Pages viewer no longer open anywhere).
  const VIEWER_URLS = [new URL(SHARE_BASE)];

  function isViewerPage() {
    return VIEWER_URLS.some((u) => location.origin === u.origin && location.pathname.indexOf(u.pathname) === 0);
  }

  async function viewerRedirect() {
    if (new URLSearchParams(location.search).has('plain')) return;
    let payload = location.hash.replace(/^#(fr=)?/, '');
    if (!payload) return;
    let result = null;
    try {
      if (SHORT_RE.test(payload)) payload = await fetchShortPayload(payload.slice(1)); // short link: look the notes up
      result = await decodeShare(payload); // validates the link; null if it is not a real share link
    } catch (err) {
      warn(err);
    }
    if (!result) return; // leave the viewer page to explain the problem
    const lead = Math.max(0, Math.floor(result.notes[0].start) - 3); // start a few seconds before the first note
    const url = 'https://www.youtube.com/watch?v=' + result.id + (lead > 0 ? '&t=' + lead + 's' : '') + '#fr=' + payload;
    location.replace(url);
  }

  if (isViewerPage()) {
    viewerRedirect();
    return; // nothing else to do on the viewer page
  }

  loadSettings();
  watchSettings();
  document.addEventListener('keydown', onKeyDown, true);
  ['pause', 'play', 'seeking', 'seeked'].forEach((t) => document.addEventListener(t, onVideoEvent, true)); // media events don't bubble, so listen on the way down
  tick();
})();
