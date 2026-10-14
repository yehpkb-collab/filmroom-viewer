'use strict';
// Film Room content script, part 2 of 13. Loaded in order (see manifest.json); all parts share one scope.

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

let shapes = [];           // your shapes for the current video (saved)
let sharedShapes = [];     // shapes that came with a share link (read-only, saved separately)
let viewShapes = [];       // both: { s: shape, shared } in drawing order
let shapeEls = [];         // SVG groups, same order as viewShapes
let shapeLayer = null;     // the SVG over the picture
let lastShapeKey = '';
let drawMode = false;
let drawTool = 'arrow';
let shapeSecs = SHAPE_SECS_DEFAULT;
let drawLayer = null;      // catches the mouse while drawing
let drawBar = null;
let drawToolBtns = null;
let drawSecsBtn = null;
let drawUndoBtn = null;
let shapeHistory = [];     // what Undo in the draw bar takes back: { add: id } or { erased: [shapes] }
let drawStart = null;
let draftEl = null;
let drawPausedByUs = false;
let panelDrawBtn = null;
let panelClearShapesBtn = null;
