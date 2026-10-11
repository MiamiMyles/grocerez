# GrocerEZ

A lightweight grocery list PWA for iPhone. No build step and no dependencies,
just static files. Your list is saved on the device (localStorage) and never
leaves it. The one exception is the optional **Add Ingredients from Recipe✨**
button, which sends the recipe text or link you paste to an AI model through OpenRouter (see below).

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `sw.js`: offline cache (bump `VERSION` in it after changing any file)
- `manifest.webmanifest`, `icons/`: home-screen install
- `fonts/`: Figtree, Comic Neue, and Fraunces, bundled for offline use
- `netlify/functions/recipe-ingredients.mjs`, `netlify.toml`: the small serverless
  function behind the AI recipe import (holds the OpenRouter API key)

## Try it on your phone (same Wi-Fi)
    python3 -m http.server 8765
Open `http://<your-Mac's-IP>:8765` in Safari on the iPhone. Find the Mac's IP
with `ipconfig getifaddr en0`. This is fine for a quick look, but offline mode
needs HTTPS, so the app won't open when the Mac is off.

## Install for real (works offline)
Put the repo's files on any free static HTTPS host, such as GitHub Pages,
Netlify Drop, or Cloudflare Pages. Then, on the iPhone:
1. Open the URL in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Launch GrocerEZ from its icon. After the first launch it works with no connection.

Note: the home-screen app keeps its own storage, separate from the Safari tab.

## AI recipe import (OpenRouter)
**Add Ingredients from Recipe✨** takes a pasted ingredient list or a link to a
recipe page, asks an AI model to pick out the ingredients (as
"Name (amount)"), and lets you untick the ones you already have before
adding them, optionally tagged with the recipe name.

The browser never sees the API key. The app calls `/api/recipe-ingredients`, a
Netlify Function that holds the key, fetches the recipe page if you gave a link,
and calls OpenRouter, which auto-picks the model
(`openrouter/auto`). It only answers requests from the app's own site. To set it up:

1. Create an API key at [OpenRouter](https://openrouter.ai/settings/keys).
2. Deploy to Netlify **from this Git repo** (Add new site → Import an existing
   project). Netlify Drop only hosts static files and won't run the function.
   `netlify.toml` already tells Netlify where everything is, and there is no build step.
3. In Netlify, go to Site configuration → Environment variables and add
   `OPENROUTER_API_KEY`. Optionally add `OPENROUTER_MODEL` to pin a specific
   model instead of auto-picking (default: `openrouter/auto`). Redeploy after
   adding them. You can remove the old `GEMINI_API_KEY`.

To try it locally with the function: `npx netlify-cli dev` with `OPENROUTER_API_KEY`
set in your shell. The plain `python3 -m http.server` preview has no function,
so the button there will show an error.

The recipe import needs a connection; the rest of the app still works offline.
Some sites block automated page reads. If a link fails, paste the ingredients instead.
