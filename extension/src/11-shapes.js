'use strict';
// Film Room content script, part 11 of 13. Loaded in order (see manifest.json); all parts share one scope.

// ---------------------------------------------------------------
// SHAPES: arrow / circle / box drawn on the picture for a few seconds, like notes.
// A shape is { id, type, start, end, x1, y1, x2, y2 }; coordinates are percent of the picture (0-100).
// Arrow: tail (x1,y1) to head (x2,y2). Circle and box: two opposite corners of the box around them.
// Alt+A (or the panel's Draw button) pauses the video and lets you draw; Esc or Done goes back.
// ---------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
  return el;
};

function cleanShape(r) {
  if (!r || typeof r !== 'object' || SHAPE_TYPES.indexOf(r.type) < 0) return null;
  const v = ['start', 'end', 'x1', 'y1', 'x2', 'y2'].map((k) => Number(r[k]));
  if (v.some((x) => !isFinite(x))) return null;
  if (v[0] < 0 || v[0] > 1000000 || v[1] <= v[0] || v[1] - v[0] > 3600) return null;
  const c = (x) => round1(clampNum(x, 0, 100));
  const out = {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 24) : newId(),
    type: r.type, start: round1(v[0]), end: round1(v[1]), x1: c(v[2]), y1: c(v[3]), x2: c(v[4]), y2: c(v[5]),
  };
  if (typeof r.a === 'string' && AUTHOR_RE.test(r.a)) out.a = r.a;
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL) : '';
  if (label) out.label = label;
  return out;
}

function cleanShapes(list) {
  return Array.isArray(list)
    ? list.slice(0, MAX_SHAPES).map(cleanShape).filter(Boolean).sort((a, b) => a.start - b.start)
    : [];
}

const sameShape = (a, b) =>
  a.type === b.type && Math.abs(a.start - b.start) < 0.05 && Math.abs(a.end - b.end) < 0.05 &&
  ['x1', 'y1', 'x2', 'y2'].every((k) => Math.abs(a[k] - b[k]) < 0.5);

function persistShapes() {
  if (currentVideoId) save(SHAPES_PREFIX + currentVideoId, shapes);
}

function persistSharedShapes() {
  if (currentVideoId) save(SHARED_SHAPES_PREFIX + currentVideoId, sharedShapes);
}

// ---- drawing the shapes on the video ----
function shapeParts(sh, W, H, px) {
  const X1 = sh.x1 * W / 100, Y1 = sh.y1 * H / 100, X2 = sh.x2 * W / 100, Y2 = sh.y2 * H / 100;
  if (sh.type === 'box') {
    return svgEl('rect', { x: Math.min(X1, X2), y: Math.min(Y1, Y2), width: Math.abs(X2 - X1), height: Math.abs(Y2 - Y1), rx: px * 0.8 });
  }
  if (sh.type === 'circle') {
    return svgEl('ellipse', { cx: (X1 + X2) / 2, cy: (Y1 + Y2) / 2, rx: Math.abs(X2 - X1) / 2, ry: Math.abs(Y2 - Y1) / 2 });
  }
  const len = Math.hypot(X2 - X1, Y2 - Y1) || 1;
  const ang = Math.atan2(Y2 - Y1, X2 - X1);
  const hl = clampNum(len * 0.32, px * 3, px * 7);
  const hx = (a) => (X2 - hl * Math.cos(ang + a)).toFixed(1);
  const hy = (a) => (Y2 - hl * Math.sin(ang + a)).toFixed(1);
  const d = 'M' + X1.toFixed(1) + ' ' + Y1.toFixed(1) + 'L' + X2.toFixed(1) + ' ' + Y2.toFixed(1) +
    'M' + hx(0.5) + ' ' + hy(0.5) + 'L' + X2.toFixed(1) + ' ' + Y2.toFixed(1) + 'L' + hx(-0.5) + ' ' + hy(-0.5);
  return svgEl('path', { d: d });
}

function shapeGroup(sh, W, H, shared) {
  const px = Math.max(3, W * 0.0048);
  const g = svgEl('g', { class: 'fr-shape' + (shared ? ' fr-sh-shared' : '') });
  const back = shapeParts(sh, W, H, px);
  back.setAttribute('class', 'fr-sh-back');
  back.setAttribute('stroke-width', (px + 3).toFixed(1));
  const main = shapeParts(sh, W, H, px);
  main.setAttribute('class', 'fr-sh-main');
  main.setAttribute('stroke-width', px.toFixed(1));
  g.appendChild(back);
  g.appendChild(main);
  return g;
}

function buildShapeUI() {
  shapeLayer = svgEl('svg', { id: 'fr-shapes', width: '100%', height: '100%', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  overlay.insertBefore(shapeLayer, overlay.firstChild); // under the notes

  labelLayer = document.createElement('div');
  labelLayer.id = 'fr-shapelabels';
  overlay.appendChild(labelLayer);

  drawLayer = document.createElement('div');
  drawLayer.id = 'fr-draw';
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((t) => drawLayer.addEventListener(t, onDrawPointer));
  ['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu'].forEach((t) => drawLayer.addEventListener(t, (e) => { e.stopPropagation(); e.preventDefault(); }));
  overlay.appendChild(drawLayer);

  drawBar = document.createElement('div');
  drawBar.id = 'fr-drawbar';
  const tools = [['arrow', 'Arrow'], ['circle', 'Circle'], ['box', 'Box'], ['erase', 'Erase']];
  drawToolBtns = tools.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-tool';
    b.textContent = t[1];
    b.title = t[1] + ' (' + (i + 1) + ')';
    b.addEventListener('click', (e) => { e.stopPropagation(); setDrawTool(t[0]); });
    drawBar.appendChild(b);
    return b;
  });
  drawSecsBtn = document.createElement('button');
  drawSecsBtn.type = 'button';
  drawSecsBtn.className = 'fr-tool fr-tool-secs';
  drawSecsBtn.title = 'How long each new shape stays on screen (click to change)';
  drawSecsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    shapeSecs = SHAPE_SECS_CHOICES[(SHAPE_SECS_CHOICES.indexOf(shapeSecs) + 1) % SHAPE_SECS_CHOICES.length];
    syncDrawBar();
  });
  drawBar.appendChild(drawSecsBtn);
  drawLabelBtn = document.createElement('button');
  drawLabelBtn.type = 'button';
  drawLabelBtn.className = 'fr-tool';
  drawLabelBtn.textContent = 'Label';
  drawLabelBtn.title = 'On: a text box opens next to each new shape, so you can say what it points at. Click a label to change it.';
  drawLabelBtn.addEventListener('click', (e) => { e.stopPropagation(); labelOnDraw = !labelOnDraw; syncDrawBar(); });
  drawBar.appendChild(drawLabelBtn);
  drawUndoBtn = document.createElement('button');
  drawUndoBtn.type = 'button';
  drawUndoBtn.className = 'fr-tool';
  drawUndoBtn.textContent = 'Undo';
  drawUndoBtn.title = 'Undo the last shape you drew or erased (Ctrl+Z)';
  drawUndoBtn.addEventListener('click', (e) => { e.stopPropagation(); undoShape(); });
  drawBar.appendChild(drawUndoBtn);
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'fr-tool fr-tool-done';
  done.textContent = 'Done';
  done.title = 'Back to the video (Esc or Alt+A)';
  done.addEventListener('click', (e) => { e.stopPropagation(); exitDraw(true); });
  drawBar.appendChild(done);
  ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'].forEach((t) => drawBar.addEventListener(t, stopEvent));
  overlay.appendChild(drawBar);

  // A pencil on the video (while YouTube's own controls are showing) starts drawing without the panel or a key.
  pencilBtn = document.createElement('button');
  pencilBtn.type = 'button';
  pencilBtn.id = 'fr-pencil';
  pencilBtn.title = 'Draw on the video (Alt+A)';
  pencilBtn.setAttribute('aria-label', 'Draw on the video');
  const pic = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  pic.appendChild(svgEl('path', { d: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.33-2.33a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.82-1.84z', fill: 'currentColor' }));
  pencilBtn.appendChild(pic);
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'].forEach((t) => pencilBtn.addEventListener(t, stopEvent));
  pencilBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDraw(); });
  overlay.appendChild(pencilBtn);
  syncDrawBar();
  applyShowState();
}

// ---- show / hide on the video (display only: the list, Prev and Next keep working) ----
function applyShowState() {
  if (overlay) {
    overlay.classList.toggle('fr-hide-notes', !showNotes);
    overlay.classList.toggle('fr-hide-shapes', !showShapes);
  }
  if (panelShowBtns) {
    panelShowBtns.notes.setAttribute('aria-pressed', String(showNotes));
    panelShowBtns.shapes.setAttribute('aria-pressed', String(showShapes));
  }
}

function setShow(which, on) {
  if (which === 'notes') showNotes = on;
  else showShapes = on;
  saveSettings();
  applyShowState();
  toast((which === 'notes' ? 'Notes' : 'Shapes') + (on ? ' shown on the video.' : ' hidden on the video. Alt+H brings back everything.'), 2500);
}

// Alt+H: everything off (the plain video), or everything back on.
function toggleMarkup() {
  const on = !(showNotes || showShapes);
  showNotes = on;
  showShapes = on;
  saveSettings();
  applyShowState();
  toast(on ? 'Notes and shapes shown on the video.' : 'Video shown plain. Alt+H brings the notes and shapes back.', 2500);
}

function renderShapes() {
  if (!shapeLayer || !overlay) return;
  const W = overlay.clientWidth || parseFloat(overlay.style.width) || 0;
  const H = overlay.clientHeight || parseFloat(overlay.style.height) || 0;
  shapeLayer.textContent = '';
  if (labelLayer) labelLayer.textContent = '';
  shapeEls = [];
  labelEls = [];
  viewShapes = [];
  shapes.forEach((s) => viewShapes.push({ s: s, shared: false }));
  sharedShapes.forEach((s) => viewShapes.push({ s: s, shared: true }));
  viewShapes.sort((a, b) => a.s.start - b.s.start);
  if (!W || !H) return;
  shapeLayer.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  viewShapes.forEach((v) => {
    const g = shapeGroup(v.s, W, H, v.shared);
    g._on = false;
    shapeLayer.appendChild(g);
    shapeEls.push(g);
    labelEls.push(v.s.label && !(labelFor && labelFor.id === v.s.id) ? makeLabelPill(v) : null);
  });
  lastShapeKey = '';
  if (draftEl) { draftEl = null; }
}

// Called every tick: shows the shapes that are live now. Returns what the watcher needs to know.
function updateShapes(t) {
  let active = 0;
  let soon = false;
  for (let i = 0; i < viewShapes.length; i++) {
    const s = viewShapes[i].s;
    const on = isLive(s, t);
    if (on) active++;
    else if (s.start > t && s.start - t < FAST_LEAD_S) soon = true;
    const g = shapeEls[i];
    if (g && g._on !== on) {
      g._on = on;
      g.classList.toggle('fr-on', on);
      if (labelEls[i]) labelEls[i].classList.toggle('fr-on', on);
      if (panelShapeRows[i]) panelShapeRows[i].classList.toggle('fr-on', on);
    }
  }
  return { active: active, soon: soon };
}

// ---- labels ----
// Where a shape's label sits (percent of the picture): under a circle or box (above it near the bottom edge),
// and beyond the tail of an arrow, away from the head.
function labelAnchor(sh) {
  const cx = (sh.x1 + sh.x2) / 2;
  const lo = Math.min(sh.y1, sh.y2);
  const hi = Math.max(sh.y1, sh.y2);
  if (sh.type === 'arrow') {
    const dx = sh.x2 - sh.x1;
    const dy = sh.y2 - sh.y1;
    if (Math.abs(dx) * 0.5625 > Math.abs(dy)) { // mostly sideways
      return dx > 0 ? { x: sh.x1, y: sh.y1, tx: '-100%', ty: '-50%' } : { x: sh.x1, y: sh.y1, tx: '0', ty: '-50%' };
    }
    return dy > 0 ? { x: clampNum(sh.x1, 14, 86), y: sh.y1, tx: '-50%', ty: '-100%' } : { x: clampNum(sh.x1, 14, 86), y: sh.y1, tx: '-50%', ty: '0' };
  }
  return hi > 86 ? { x: clampNum(cx, 14, 86), y: lo, tx: '-50%', ty: '-100%' } : { x: clampNum(cx, 14, 86), y: hi, tx: '-50%', ty: '0' };
}

function placeAt(el, sh) {
  const a = labelAnchor(sh);
  el.style.left = a.x + '%';
  el.style.top = a.y + '%';
  el.style.transform = 'translate(' + a.tx + ',' + a.ty + ')';
}

function makeLabelPill(v) {
  const el = document.createElement('div');
  el.className = 'fr-shlabel' + (v.shared ? ' fr-sh-shared' : '');
  el.textContent = v.s.label; // textContent, never innerHTML
  placeAt(el, v.s);
  if (!v.shared) {
    el.title = 'Click to change this label';
    el.addEventListener('click', (e) => { e.stopPropagation(); if (drawMode) openLabelEditor(v.s); });
  }
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'].forEach((t) => el.addEventListener(t, stopEvent));
  labelLayer.appendChild(el);
  return el;
}

function closeLabelEditor() {
  const inp = labelInput;
  labelInput = null;
  labelFor = null;
  if (inp && inp.parentNode) inp.remove();
}

// A small text box beside the shape. Enter or clicking away saves it, Esc leaves the label as it was.
function openLabelEditor(sh) {
  if (!overlay || !sh) return;
  if (labelInput) closeLabelEditor();
  labelFor = sh;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.id = 'fr-labelinput';
  inp.maxLength = MAX_LABEL;
  inp.value = sh.label || '';
  inp.placeholder = 'Label (Enter to save)';
  placeAt(inp, sh);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const text = inp.value.trim().slice(0, MAX_LABEL);
    closeLabelEditor();
    if (save && text !== (sh.label || '')) {
      if (text) sh.label = text;
      else delete sh.label;
      persistShapes();
    }
    renderShapes();
    const v = getVideo();
    if (v) updateShapes(v.currentTime);
    syncShapePanel();
  };
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation(); // YouTube must not see these keys (space pauses, k plays, numbers seek)
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  ['keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'contextmenu'].forEach((t) => inp.addEventListener(t, stopEvent));
  inp.addEventListener('blur', () => finish(true));
  overlay.appendChild(inp);
  labelInput = inp;
  renderShapes(); // the pill for this shape steps aside while its box is open
  const v = getVideo();
  if (v) updateShapes(v.currentTime);
  inp.focus();
  inp.select();
}

// The panel row for a shape: time, what it is, its label; click to jump, pencil to edit the label, x to delete.
function shapeRow(v, i) {
  const s = v.s;
  const row = document.createElement('div');
  row.className = 'fr-prow fr-pshape' + (v.shared ? ' fr-pshared' : '');
  row.title = 'Jump to this shape';
  const time = document.createElement('span');
  time.className = 'fr-ptime';
  time.textContent = fmt(s.start);
  const icon = document.createElement('span');
  icon.className = 'fr-pshicon';
  icon.textContent = s.type === 'arrow' ? '\u2197' : s.type === 'circle' ? '\u25EF' : '\u25AD';
  const txt = document.createElement('span');
  txt.className = 'fr-ptext' + (s.label ? '' : ' fr-pnolabel');
  txt.textContent = s.label || s.type.charAt(0).toUpperCase() + s.type.slice(1);
  row.appendChild(time);
  row.appendChild(icon);
  row.appendChild(txt);
  if (v.shared) {
    const who = document.createElement('span');
    who.className = 'fr-pwho';
    who.appendChild(avatarEl());
    who.appendChild(document.createTextNode('Shared'));
    row.appendChild(who);
  } else {
    const acts = document.createElement('span');
    acts.className = 'fr-pacts';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'fr-pedit';
    edit.textContent = '\u270E';
    edit.title = 'Add or change the label';
    edit.addEventListener('click', (e) => {
      e.stopPropagation();
      seekTo(s.start);
      enterDraw();
      setTimeout(() => openLabelEditor(s), 200);
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'fr-pdel';
    del.textContent = '\u00d7';
    del.title = 'Delete this shape (you can undo it for a few seconds)';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeShapes([s.id], 'Shape deleted.');
    });
    acts.appendChild(edit);
    acts.appendChild(del);
    row.appendChild(acts);
  }
  row.addEventListener('mousedown', (e) => e.preventDefault());
  row.addEventListener('click', () => seekTo(s.start));
  return row;
}

// ---- draw mode ----
function toggleDraw() {
  if (drawMode) exitDraw(true);
  else enterDraw();
}

function enterDraw() {
  const v = getVideo();
  if (!v || !overlay || !shapeLayer || drawMode) return;
  if (captureOpen) closeCapture(false);
  dismissFirstRun();
  if (!showShapes) { // you can't draw on what you can't see
    showShapes = true;
    saveSettings();
    applyShowState();
  }
  drawMode = true;
  drawPausedByUs = !v.paused;
  if (!v.paused) v.pause();
  overlay.classList.add('fr-drawing');
  syncDrawBar();
  syncShapePanel();
  toast('Drag on the video to draw. Esc when done.', 3500);
}

function exitDraw(resume) {
  if (!drawMode) return;
  drawMode = false;
  drawStart = null;
  clearDraft();
  closeLabelEditor();
  if (overlay) overlay.classList.remove('fr-drawing');
  const v = getVideo();
  if (resume && drawPausedByUs && v && v.paused) {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }
  drawPausedByUs = false;
  syncShapePanel();
}

function setDrawTool(tool) {
  drawTool = tool;
  syncDrawBar();
}

function syncDrawBar() {
  if (!drawToolBtns) return;
  const names = ['arrow', 'circle', 'box', 'erase'];
  drawToolBtns.forEach((b, i) => b.classList.toggle('fr-sel', names[i] === drawTool));
  if (drawSecsBtn) drawSecsBtn.textContent = shapeSecs + ' s';
  if (drawUndoBtn) drawUndoBtn.disabled = !shapeHistory.length;
  if (drawLabelBtn) drawLabelBtn.classList.toggle('fr-sel', labelOnDraw);
  if (drawLayer) drawLayer.classList.toggle('fr-erase', drawTool === 'erase');
}

function clearDraft() {
  if (draftEl && draftEl.parentNode) draftEl.remove();
  draftEl = null;
}

function drawPoint(e) {
  const r = drawLayer.getBoundingClientRect();
  return {
    x: clampNum((e.clientX - r.left) / (r.width || 1) * 100, 0, 100),
    y: clampNum((e.clientY - r.top) / (r.height || 1) * 100, 0, 100),
    w: r.width || 1, h: r.height || 1,
  };
}

function onDrawPointer(e) {
  if (!drawMode) return;
  e.stopPropagation();
  e.preventDefault();
  const p = drawPoint(e);
  if (e.type === 'pointerdown') {
    if (e.button > 0) return;
    if (drawTool === 'erase') { eraseAt(p); return; }
    try { drawLayer.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: fine */ }
    drawStart = p;
    return;
  }
  if (!drawStart) return;
  if (e.type === 'pointermove') {
    const sh = { type: drawTool, x1: drawStart.x, y1: drawStart.y, x2: p.x, y2: p.y, start: 0, end: 1 };
    clearDraft();
    draftEl = shapeGroup(sh, p.w, p.h, false);
    draftEl.setAttribute('class', 'fr-shape fr-on fr-draft');
    shapeLayer.appendChild(draftEl);
  } else if (e.type === 'pointerup') {
    const a = drawStart;
    drawStart = null;
    clearDraft();
    const big = Math.hypot((p.x - a.x) * p.w / 100, (p.y - a.y) * p.h / 100);
    if (big < SHAPE_MIN_PX) return; // a plain click: nothing to draw
    addShape(drawTool, a, p);
  } else {
    drawStart = null;
    clearDraft();
  }
}

function addShape(type, a, b) {
  const v = getVideo();
  if (!v) return;
  if (shapes.length >= MAX_SHAPES) {
    toast('That is the most shapes one video can hold (' + MAX_SHAPES + ').');
    return;
  }
  const t = Math.max(0, Math.floor(v.currentTime * 10 + 1e-6) / 10);
  const sh = cleanShape({ type: type, start: t, end: t + shapeSecs, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  if (!sh) return;
  shapes.push(sh);
  shapes.sort((x, y) => x.start - y.start);
  shapeHistory.push({ add: sh.id });
  syncDrawBar();
  persistShapes();
  renderShapes();
  updateShapes(v.currentTime);
  syncShapePanel();
  if (labelOnDraw) openLabelEditor(sh);
}

// Erase: the shape you click on (only your own; shapes shared with you are read-only).
function eraseAt(p) {
  const v = getVideo();
  if (!v) return;
  const t = v.currentTime;
  let hit = null;
  shapes.forEach((s) => {
    if (!isLive(s, t)) return;
    const x = p.x * p.w / 100, y = p.y * p.h / 100;
    const X1 = s.x1 * p.w / 100, Y1 = s.y1 * p.h / 100, X2 = s.x2 * p.w / 100, Y2 = s.y2 * p.h / 100;
    let ok;
    if (s.type === 'arrow') {
      const dx = X2 - X1, dy = Y2 - Y1;
      const l2 = dx * dx + dy * dy || 1;
      const u = clampNum(((x - X1) * dx + (y - Y1) * dy) / l2, 0, 1);
      ok = Math.hypot(x - (X1 + u * dx), y - (Y1 + u * dy)) <= 16;
    } else if (s.type === 'circle') {
      const rx = Math.abs(X2 - X1) / 2 + 8, ry = Math.abs(Y2 - Y1) / 2 + 8;
      ok = Math.pow((x - (X1 + X2) / 2) / rx, 2) + Math.pow((y - (Y1 + Y2) / 2) / ry, 2) <= 1;
    } else {
      ok = x >= Math.min(X1, X2) - 8 && x <= Math.max(X1, X2) + 8 && y >= Math.min(Y1, Y2) - 8 && y <= Math.max(Y1, Y2) + 8;
    }
    if (ok) hit = s; // the later one is on top
  });
  if (!hit) {
    toast('Click on one of your shapes to erase it.', 2000);
    return;
  }
  removeShapes([hit.id], 'Shape erased.', true);
}

// Draw bar Undo / Ctrl+Z: takes back the last shape you drew, or brings back the last one you erased.
function undoShape() {
  const h = shapeHistory.pop();
  syncDrawBar();
  if (!h) { toast('Nothing to undo.', 1500); return; }
  if (h.add) {
    shapes = shapes.filter((s) => s.id !== h.add);
  } else {
    h.erased.forEach((g) => { if (!shapes.some((s) => s.id === g.id)) shapes.push(g); });
    shapes.sort((a, b) => a.start - b.start);
  }
  persistShapes();
  renderShapes();
  const v = getVideo();
  if (v) updateShapes(v.currentTime);
  syncShapePanel();
}

function removeShapes(ids, label, inDraw) {
  const gone = shapes.filter((s) => ids.indexOf(s.id) >= 0);
  if (!gone.length) return;
  if (inDraw) { shapeHistory.push({ erased: gone }); syncDrawBar(); }
  shapes = shapes.filter((s) => ids.indexOf(s.id) < 0);
  persistShapes();
  renderShapes();
  const v = getVideo();
  if (v) updateShapes(v.currentTime);
  syncShapePanel();
  showUndo(label, () => {
    shapeHistory = shapeHistory.filter((h) => !(h.erased && h.erased === gone));
    syncDrawBar();
    gone.forEach((g) => { if (!shapes.some((s) => s.id === g.id)) shapes.push(g); });
    shapes.sort((a, b) => a.start - b.start);
    persistShapes();
    renderShapes();
    const vv = getVideo();
    if (vv) updateShapes(vv.currentTime);
    syncShapePanel();
    toast('Shapes restored.');
  });
}

function clearShapes() {
  if (!shapes.length) return;
  const n = shapes.length;
  removeShapes(shapes.map((s) => s.id), n + (n === 1 ? ' shape removed.' : ' shapes removed.'));
}

// Panel: the Draw button, Clear shapes, and the count in the header.
function syncShapePanel() {
  if (panelDrawBtn) panelDrawBtn.classList.toggle('fr-sel', drawMode);
  if (panelClearShapesBtn) {
    panelClearShapesBtn.style.display = shapes.length ? '' : 'none';
    panelClearShapesBtn.textContent = 'Clear shapes (' + shapes.length + ')';
  }
  if (panelEl) refreshPanel();
}
