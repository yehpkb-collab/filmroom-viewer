'use strict';
// Film Room content script, part 12 of 13. Loaded in order (see manifest.json); all parts share one scope.

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
  renderShapes(); // shapes are drawn in pixels, so they are redrawn when the picture changes size
}

function hideOverlay() {
  if (overlay) overlay.style.display = 'none';
  if (panelEl && panelEl.parentElement) panelEl.remove(); // not on a watch page, or an ad is playing
}

function switchVideo(videoId) {
  currentVideoId = videoId;
  closeCapture(false);
  closeShareBox();
  exitDraw(false);
  shapeHistory = [];
  bmOpen = false;
  hideUndo();
  notes = [];
  sharedNotes = [];
  shapes = [];
  sharedShapes = [];
  rebuildView();
  renderNotes();
  renderShapes();
  syncShapePanel();
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

  if (!overlay) {
    buildOverlay();
    buildShapeUI();
  }
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
  const sh = updateShapes(t);
  active += sh.active;
  soon = soon || sh.soon;
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
