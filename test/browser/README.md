# Browser tests (optional, developer only)

These drive a real Chromium with the extension loaded, against a stubbed YouTube page. They are not part of `npm test`.

Needs: Playwright (`PW_MODULES` = the node_modules folder that holds it), a Chromium (`CHROME` = its path), and a short test clip:

    mkdir -p /tmp/smoke && ffmpeg -f lavfi -i testsrc=duration=6:size=640x360:rate=25 -c:v libvpx /tmp/smoke/clip.webm

Run (one at a time; `SMOKE_DIR` is where the clip and scratch files live):

    node test/browser/smoke.mjs  <extension dir> <label>   # panel, first-run card, notes, export/import, hostile import
    node test/browser/shapes.mjs <extension dir>           # draw, erase, undo, export/import of shapes, hostile shapes
    node test/browser/roundtrip.mjs                        # extension share link -> server parsePayload -> viewer overlay
    node test/browser/vshapes.mjs                          # viewer with drawings-only / hostile links

Chromium headless can leave processes behind: `pkill -9 -x chrome` between runs.
