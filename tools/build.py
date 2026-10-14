#!/usr/bin/env python3
"""Build the extension zip from extension/ and write public/download/version.json.

  python tools/build.py

Writes:
  public/download/film-room-overlay.zip        (the file the start/update pages offer)
  public/download/version.json                 (version, size, SHA-256: the start pages show them)
  dist/film-room-overlay-v<version>.zip        (the versioned copy you send people directly)
The zip holds one folder, film-room-overlay/, same as before.
"""
import hashlib, json, os, shutil, sys, zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ext = os.path.join(root, 'extension')
m = json.load(open(os.path.join(ext, 'manifest.json'), encoding='utf-8'))
ver = m.get('version_name') or m['version']
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
os.makedirs(os.path.join(root, 'public', 'download'), exist_ok=True)
hosted = os.path.join(root, 'public', 'download', 'film-room-overlay.zip')
versioned = os.path.join(root, 'dist', 'film-room-overlay-v%s.zip' % ver)

with zipfile.ZipFile(hosted, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, dirs, files in os.walk(ext):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(base, f)
            rel = os.path.relpath(full, ext).replace(os.sep, '/')
            info = zipfile.ZipInfo('film-room-overlay/' + rel, date_time=(2026, 1, 1, 0, 0, 0))  # fixed date: same files, same hash
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, open(full, 'rb').read())
shutil.copyfile(hosted, versioned)
data = open(hosted, 'rb').read()
meta = {'version': ver, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
json.dump(meta, open(os.path.join(root, 'public', 'download', 'version.json'), 'w'), indent=2)
print('built', versioned)
print(json.dumps(meta))
