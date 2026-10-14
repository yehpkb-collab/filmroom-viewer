'use strict';
// Film Room content script, part 1 of 13. Loaded in order (see manifest.json); all parts share one scope.

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
const SHAPES_PREFIX = 'fr_shapes:';             // your arrows / circles / boxes for a video
const SHARED_SHAPES_PREFIX = 'fr_sshapes:';     // the ones that came with a share link
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

// Shapes (arrow / circle / box drawn on the picture)
const SHAPE_TYPES = ['arrow', 'circle', 'box']; // the order is the code used in share links
const SHAPE_SECS_CHOICES = [2, 4, 6, 10];       // how long a new shape stays (click the button in the draw bar)
const SHAPE_SECS_DEFAULT = 4;
const SHAPE_MIN_PX = 10;                        // a drag shorter than this is a click, not a shape
const MAX_SHAPES = 100;                         // per video (and per share link)
const IMPORT_MAX_SHAPES = 100;
const MAX_LABEL = 100;                          // characters in a shape's label
