# Film Room 0.9e: Architect Review (2026-10-14)

**Input used:** project folder (`extension/`, `netlify/`, `public/`, `test/`) plus web search · **Confidence:** medium-high on code; no real-YouTube runtime check (headless stub only)

## Since last review
First review. Nothing to compare.

## 1. Snapshot
- **What it is:** MV3 extension that overlays timed notes, bookmarks and labeled shapes on YouTube, plus a Netlify site with short-link service and a no-extension viewer.
- **Stack and size:** 13 content scripts (3,153 lines JS, 1,316 lines CSS), 61 KB zip, one service worker, 2 Netlify functions, 10 unit tests, 6 Playwright scripts.
- **Honest one-sentence summary:** Technically clean and unusually well tested for a solo build, but the product has zero real users and has gained five feature releases (0.9–0.9e) without a demand test; stop adding features and put it in front of strangers.

## 2. Feature scorecard
| Feature | Role | Quality | Evidence | Note |
|---|---|---|---|---|
| Timed notes on video | core | 4 | `06-ui.js`, `07-actions.js` | Alt+N, lead-in setting, panel list |
| Share link + viewer | core | 4 | `04-codec.js`, `netlify/lib/share-core.mjs`, `public/index.html` | The only thing a non-user ever touches; this is the differentiator |
| Labeled shapes | supporting | 3 | `11-shapes.js` (593 lines, largest JS file) | Works; viewer assumes 16:9 picture, unverified on letterboxed/vertical video |
| Quick bookmark (Alt+B) | supporting | 4 | `07-actions.js` | Cheap, fast |
| Hide notes/shapes (Alt+H) | supporting | 3 | `11-shapes.js` applyShowState | Possible Brave shortcut clash, unverified |
| Backup/restore | supporting | 3 | `08-backup.js`, folded in 0.9e | Right call to fold it away; 5 MB / 2000-video import caps are sane |
| Toolbar on/off | dead weight | 2 | `background.js` | Panel toggle duplicates Alt+P and the in-panel Hide button |
| Emoji on bookmark setting | dead weight | 2 | `fr_settings` | Setting nobody asked for yet |

## 3. Top 5 problems (ranked by user impact)
1. **No demand evidence after 14 releases**: building has outrun validation. Evidence: version history 0.8 to 0.9e this period; the 7-day link test has not started. Fix: send 3-5 real links this week, freeze features.
2. **Install friction kills the viewer funnel**: the extension is sideloaded from a zip (PowerShell update one-liner required), so only Chi can run it. Evidence: update flow in `SETUP.md`. Fix: Chrome Web Store listing (the `storage`-only permission set makes review easy) before any outreach beyond Ella and friends.
3. **YouTube DOM fragility**: depends on `#movie_player` and `#secondary-inner` (`03-helpers.js:16`, `10-panel.js:427`) and the `ytp-autohide` class for the pencil. One YouTube layout change breaks the panel or pencil silently. Fix: a single Playwright check against live YouTube run weekly, plus a fallback host for the panel.
4. **Unverified on real YouTube**: pencil visibility, Alt+H, labels and shapes on letterboxed video were only tested against a stub with no `html5-video-player` class. Fix: one 15-minute manual pass on the checklist before sharing.
5. **Product is pickleball-shaped in distribution but generic in code**: no audience or listing yet defines who it is for. Fix: pick one persona (coach sending a student clips) and write the landing page to it.

## 4. UI and design language
- **What the design communicates today:** a capable power tool with many keyboard shortcuts; trust is good (local-first, no account).
- **Consistency issues:** overlay.css has grown by appended per-version blocks (0.9, 0.9a ... 0.9e) with z-index patches (`#fr-shapes{z-index:1}`, undo/toast z-index 5), which is a regression magnet. Consolidate into tokens and a z-index scale.
- **Platform conventions broken:** none serious; docked panel in `#secondary` is the right place.
- **Missing states:** no empty-panel coaching after first-run card; error state when the short-link service returns 429 falls back to the long link, which is good but unannounced (unverified).
- **Direction recommended:** one look, quiet and tool-like; keep it.

## 5. Use cases
- **Served today:** When I am reviewing a match video, I want to mark moments and draw on them, so I can send a student a link that opens at the right spot with my notes.
- **Missing:**
  1. Coach-to-student lesson review (Chi's own lessons at Lifetime): reuse share links, add a "lesson" title and a one-tap reply from the student. Trigger: right after a lesson.
  2. Parent/player film review for Ella's matches: reuse notes plus bookmarks on tournament streams; trigger: the same evening after a match.
  3. DHD sales call or demo review (YouTube unlisted recordings): same overlay, internal use only. Check DHD policy first.
  4. Study notes with sharing for classmates or teams (generic, no Chi advantage).
- **Unfair advantage:** pickleball coaching clients and clubs who already trust Chi.

## 6. Technical architecture and risk
- **Secrets:** none found; no API keys; `storage` is the only permission. Strong.
- **Data:** notes stay in `storage.local`; only share payloads leave the device, to one allowed origin (`background.js` restricts to `/api/share` with a 10-char id check and `sender.id` check). Good.
- **Cost:** Netlify Blobs plus functions; rate limit 40 per hour per IP (`share-core.mjs:18`), payload caps (100 shapes, 300 notes). Cost is negligible at pilot scale; at 1,000 users the Blobs listing in `cleanup` and per-IP limiting behind shared NATs are the first things to watch.
- **Fragility:** YouTube selectors (problem 3); CSP is still Report-Only (`netlify.toml:21`), so it protects nothing yet.
- **Structure:** the split into 13 scripts sharing one global scope works but relies on load order in two manifest arrays (duplicated list for the viewer match, which also injects all 13 scripts into the viewer; only the codec and import path are likely needed there).
- **Tests:** real strength: 10 unit tests, round-trip extension-to-server-to-viewer test, hostile-input tests. No schema-version migration for `fr_*` keys beyond export `v:1`.
- **Security:** user text is set via `textContent` everywhere checked (`06-ui.js:237`, `10-panel.js:337`, `11-shapes.js:264`).

## 7. Distribution and monetization
- **Finding:** nobody can find it today. Needs a Web Store listing, a 30-second demo clip, and a landing page that names one persona.
- **Would pay for:** hosted share links with longer retention, team/club libraries, and a reply thread. Free: notes, shapes, local backup.
- **Platform risk:** YouTube ToS around overlays (extension only draws on top; low risk but unverified), Netlify as a single vendor, Web Store review.
- **Cheapest validation:** 3-5 real links to coaches, 7 days, count repeat opens (already planned).

## 8. Competitive scan
| Alternative | What it does better | Where this build is different |
|---|---|---|
| [OnForm](https://apps.apple.com/US/app/id1490334045) and [Coach's Eye alternatives](https://coachway.io/articles/coachs-eye-alternatives/) | Native iPad/iPhone apps, record your own video, frame-by-frame drawing, voice-over, paid plans | Works on any public YouTube video (tournament streams, pro matches) with no upload; free viewer link |
| [Hudl](https://toolradar.com/tools/hudl/pricing) | Team video library, tagging, full-game workflows, subscriptions | No account or subscription; individual-coach scale |
| [Video Notes for YouTube](https://addons.mozilla.org/addon/video-notes-for-youtube/) and [YouTube Time Labels](https://chrome.google.com/webstore/detail/youtube-time-labels/nfejcmbipcbnloiekolfklofpdabmmig/reviews?hl=en) | Simple personal timestamp notes, already in stores | Shapes on the picture and a viewer that works without the extension |

Genuine difference: drawing plus a link a non-user can open. The notes alone are a commodity. Pricing details for the native apps were not verified in search snippets.

## 9. Next release (ranked by impact / effort)
| # | Change | Impact | Effort | User and evidence |
|---|---|---|---|---|
| 1 | Run the real-YouTube checklist; fix what breaks | High | 1 hr | Chi; stub-only testing |
| 2 | Chrome Web Store submission (privacy page, screenshots, permission note) | High | 1 day | Any stranger; sideload is a hard stop |
| 3 | 30-second demo GIF/video on the start page | High | 1 hr | Strangers evaluating trust |
| 4 | Weekly live-YouTube smoke check | Med | 2 hrs | Selector fragility |
| 5 | Flip CSP to enforcing after clean console | Med | 30 min | `netlify.toml:21` |

**Cut or merge:** stop shapes polish and new toggles; drop the emoji setting; drop the toolbar on/off (keep Alt+P and panel button); do not load all 13 scripts on the viewer site.

## 10. Next builds
- **Lesson-review template** for Chi's own students: title, three bookmarks, one link; test with 3 students this week.
- **Viewer-side reply/reaction** (single emoji or short text) so the link comes back; test by asking Ella to reply manually first.
- **Match-day mode for Ella's streams:** bookmark by score; test at the next tournament.
Recommendation: finish and validate this one before starting anything else; the backlog already has several apps in flight.

## 11. Venture lens
Not requested; not scored.

## 12. Verdict
**Grade:** B+ engineering, C product readiness (no users, sideload only, unvalidated demand). Overall B-.
**Keep / Merge / Kill:** Keep, freeze features.
**Single most important next action:** run the real-YouTube checklist today, then send 3-5 share links to real coaches/players and measure repeat opens over 7 days.

## Could not verify
- Real-YouTube behavior of pencil, labels, Alt+H, shape alignment on non-16:9 video.
- Brave handling of Alt+H and other Alt shortcuts.
- Competitor current pricing and feature sets (search snippets only).
- Whether YouTube ToS affects overlay-style extensions in store review.
- Per-IP rate-limit behavior behind shared networks.
