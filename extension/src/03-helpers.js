'use strict';
// Film Room content script, part 3 of 13. Loaded in order (see manifest.json); all parts share one scope.

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
