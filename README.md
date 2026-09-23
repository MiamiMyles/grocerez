# GrocerEZ

A lightweight grocery list PWA for iPhone. No build step and no dependencies,
just static files. Your list is saved on the device (localStorage) and never
leaves it.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `sw.js`: offline cache (bump `VERSION` in it after changing any file)
- `manifest.webmanifest`, `icons/`: home-screen install
- `fonts/`: Figtree, Comic Neue, and Fraunces, bundled for offline use

## Try it on your phone (same Wi-Fi)
    cd app && python3 -m http.server 8765
Open `http://<your-Mac's-IP>:8765` in Safari on the iPhone. Find the Mac's IP
with `ipconfig getifaddr en0`. This is fine for a quick look, but offline mode
needs HTTPS, so the app won't open when the Mac is off.

## Install for real (works offline)
Put the contents of `app/` on any free static HTTPS host, such as GitHub Pages,
Netlify Drop, or Cloudflare Pages. Then, on the iPhone:
1. Open the URL in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Launch GrocerEZ from its icon. After the first launch it works with no connection.

Note: the home-screen app keeps its own storage, separate from the Safari tab.
