'use strict';
// Film Room content script, part 9 of 13. Loaded in order (see manifest.json); all parts share one scope.

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
