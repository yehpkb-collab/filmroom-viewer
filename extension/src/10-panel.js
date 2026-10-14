'use strict';
// Film Room content script, part 10 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// DOCKED PANEL: the timestamped list with Previous / Next, docked in YouTube's right column.
// On/off is remembered (Alt+P, or the buttons). It only appears when the video has notes.
// ---------------------------------------------------------------
function saveSettings() {
  save(SETTINGS_KEY, { panel: panelEnabled, bookmark: bookmarkEmoji, lead: leadIn, notes: showNotes, shapes: showShapes });
}

function loadSettings() {
  try {
    chrome.storage.local.get([SETTINGS_KEY, FIRSTRUN_KEY]).then((res) => {
      const st = res && res[SETTINGS_KEY];
      firstRunSeen = !!(res && res[FIRSTRUN_KEY]);
      if (st && typeof st.panel === 'boolean') panelEnabled = st.panel;
      bookmarkEmoji = cleanEmoji(st && st.bookmark) || BOOKMARK_EMOJI;
      leadIn = cleanLead(st && st.lead);
      showNotes = !(st && st.notes === false);
      showShapes = !(st && st.shapes === false);
      applyShowState();
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
      const sn = !(v && v.notes === false);
      const ss = !(v && v.shapes === false);
      if (sn !== showNotes || ss !== showShapes) { // changed in another tab
        showNotes = sn;
        showShapes = ss;
        applyShowState();
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

  const shapeRow = document.createElement('div');
  shapeRow.className = 'fr-panel-shapes';
  panelDrawBtn = panelButton('Draw on video', 'fr-panel-sbtn fr-panel-draw', () => toggleDraw());
  panelDrawBtn.title = 'Draw an arrow, circle or box on the picture (Alt+A). Esc when done.';
  panelClearShapesBtn = panelButton('Clear shapes', 'fr-panel-sbtn fr-panel-clearshapes', () => clearShapes());
  panelClearShapesBtn.title = 'Remove all your shapes on this video (you can undo it for a few seconds)';
  panelClearShapesBtn.style.display = 'none';
  shapeRow.appendChild(panelDrawBtn);
  shapeRow.appendChild(panelClearShapesBtn);
  panelEl.appendChild(shapeRow);

  const showRow = document.createElement('div');
  showRow.className = 'fr-panel-showrow';
  const showLbl = document.createElement('span');
  showLbl.className = 'fr-panel-showlbl';
  showLbl.textContent = 'On video';
  showRow.appendChild(showLbl);
  panelShowBtns = {
    notes: panelButton('Notes', 'fr-panel-sbtn fr-panel-toggle', () => setShow('notes', !showNotes)),
    shapes: panelButton('Shapes', 'fr-panel-sbtn fr-panel-toggle', () => setShow('shapes', !showShapes)),
  };
  panelShowBtns.notes.title = 'Show or hide your notes on the video (Alt+H hides or shows both). The list below keeps working.';
  panelShowBtns.shapes.title = 'Show or hide the arrows, circles and boxes on the video (Alt+H hides or shows both).';
  showRow.appendChild(panelShowBtns.notes);
  showRow.appendChild(panelShowBtns.shapes);
  panelEl.appendChild(showRow);
  applyShowState();

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
  syncShapePanel();
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
  const items = []; // note rows and shape rows, mixed in time order
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
    items.push({ t: n.start, el: row });
    return row;
  });
  panelShapeRows = viewShapes.map((v, i) => {
    const row = shapeRow(v, i);
    items.push({ t: v.s.start, el: row });
    return row;
  });
  items.sort((a, b) => a.t - b.t); // stable: notes stay ahead of a shape at the same moment
  items.forEach((it) => panelListEl.appendChild(it.el));
  panelShapeRows.forEach((row, i) => row.classList.toggle('fr-on', !!(shapeEls[i] && shapeEls[i]._on)));
  if (!viewNotes.length && !viewShapes.length) { // nothing yet: say how to start (the panel is here so + Note and + Bookmark are too)
    const hint = document.createElement('div');
    hint.className = 'fr-pempty';
    hint.textContent = 'No notes yet. Press Alt+N, or click + Note, to start.';
    panelListEl.appendChild(hint);
  }
  if (panelPrevBtn) panelPrevBtn.disabled = !viewNotes.length;
  if (panelNextBtn) panelNextBtn.disabled = !viewNotes.length;
  updatePanelCount();
  lastActiveKey = ''; // force the highlight to refresh on the next frame
  syncPanel();
  panelListEl.scrollTop = keepScroll;
  applyPanelFollow();
}

function updatePanelCount() {
  if (!panelCountEl) return;
  const shared = viewNotes.filter((n) => n.shared).length;
  const drawn = shapes.length + sharedShapes.length;
  panelCountEl.textContent = viewNotes.length + (viewNotes.length === 1 ? ' note' : ' notes') +
    (drawn ? ' \u00b7 ' + drawn + (drawn === 1 ? ' shape' : ' shapes') : '') +
    (shared ? ' \u00b7 ' + shared + ' shared' : '');
  if (panelRmBtn) panelRmBtn.style.display = shared || sharedShapes.length ? '' : 'none';
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
