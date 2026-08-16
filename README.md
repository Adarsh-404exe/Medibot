# MediBot — Glitch-Ready Version

This is the same MediBot project, restructured so it deploys directly on
**Glitch** (which requires `package.json` and `server.js` at the project root).

## Structure
```
medibot-glitch/
├── package.json     ← root package.json (Glitch reads this to run "npm start")
├── server.js        ← same zero-dependency Node server as before
├── data/            ← diseases.json, translations.json, quickOptions.json
└── frontend/         ← index.html, css/, js/
```

## Deploy on Glitch (via GitHub import)

### Step 1 — Push this folder to GitHub
1. Go to **https://github.com** → sign in (or create a free account).
2. Click **"New repository"** → name it `medibot` → keep it **Public** → click **Create repository**.
3. On the new repo page, click **"uploading an existing file"**.
4. Drag and drop **all the contents of this `medibot-glitch` folder** (package.json, server.js, data/, frontend/) into the upload box.
5. Scroll down, click **"Commit changes"**.

### Step 2 — Import into Glitch
1. Go to **https://glitch.com** → sign in (Google/GitHub login works).
2. Click **"New Project"** → **"Import from GitHub"**.
3. Paste your repo URL, e.g. `https://github.com/your-username/medibot`
4. Glitch will import it and automatically run `npm install` + `npm start`.
5. Once it's running, click **"Share"** (top right) → you'll see a live link like:
   ```
   https://medibot-xxxxx.glitch.me
   ```
6. Send this link to anyone — they can open it on any laptop/PC/phone browser, no install needed.

## Notes
- Free Glitch projects "sleep" after a few minutes of no visitors — the first visit after sleep takes ~10-15 seconds to wake up, then it's instant.
- No environment variables or setup needed — it just works out of the box (`process.env.PORT` is already handled).
- To update the live site later: edit files directly in the Glitch code editor (top left) — changes go live within seconds.
