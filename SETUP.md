# Film Room viewer + short links: setup

## What's in this folder
- `public/index.html` : the viewer page (now also opens short links)
- `netlify/functions/share.mjs` : the short-link service (`/api/share`)
- `netlify/functions/cleanup.mjs` : daily cleanup of links nobody opened for 90 days
- `netlify/lib/share-core.mjs` : the service logic
- `netlify.toml`, `package.json` : Netlify settings

## One-time setup (about 10 minutes)
1. **GitHub:** create a new repository named `filmroom-viewer`. Click **Add file > Upload files** and drag in
   everything from this folder (`public`, `netlify`, `netlify.toml`, `package.json`). Commit.
2. **Free up the web address:** in Netlify, open your current `filmroom-viewer` site, go to
   **Site configuration > Change site name**, and rename it to `filmroom-viewer-old`.
3. **Create the new site:** in Netlify choose **Add new project > Import an existing project > GitHub**, pick the
   `filmroom-viewer` repository, and click **Deploy**. The settings come from `netlify.toml`.
4. When it's live, open **Site configuration > Change site name** and name the new site `filmroom-viewer`, so the
   address is the same one your existing links use.
5. **Check the service:** open `https://filmroom-viewer.netlify.app/api/share/AAAAAAAAAA` in a browser.
   It should say `Not found`. That means the service is running.

## From now on
To update the viewer or the service, upload the changed files to the GitHub repository. Netlify redeploys on its own.
