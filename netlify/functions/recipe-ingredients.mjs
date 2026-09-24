// Turns pasted recipe text, or a link to a recipe page, into grocery list items
// using Gemini. Runs on Netlify so the API key (GEMINI_API_KEY) never reaches the browser.
//
// POST /api/recipe-ingredients  { input: "..." }  ->  { title, items: ["Flour (2 cups)", ...] }
// Errors come back as { error: "message safe to show the user" }.

export const config = { path: '/api/recipe-ingredients' };

var MAX_INPUT = 20000;       // characters of pasted text we accept
var MAX_PAGE_BYTES = 2000000; // stop reading a recipe page after this
var MAX_PAGE_TEXT = 30000;   // characters of page text sent to Gemini
var MAX_ITEMS = 60;
var MAX_ITEM_LEN = 80;
var DEFAULT_MODEL = 'gemini-flash-lite-latest';

var PROMPT = [
  'You turn recipes into grocery shopping list items.',
  'From the recipe content below, extract ONLY the ingredients. Ignore instructions, equipment, nutrition info, ads, comments, and anything else.',
  'Write each ingredient as "Name (amount)", for example "Flour (2 cups)", "Eggs (3)", "Yellow onion (1)".',
  'Use a short, plain name a shopper would look for. Drop preparation words like chopped, diced, sifted, softened, divided, or "to taste".',
  'If an ingredient has no amount, write just the name. If the same ingredient appears more than once, list it once and combine the amounts when that is simple.',
  'Also return the recipe title if one is clear, otherwise an empty string.',
  'If there are no ingredients, return an empty items list.'
].join('\n');

var RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    items: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['title', 'items']
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}

class UserError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- reading a recipe page ---------- */

function isPrivateHost(host) {
  host = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) return true; // raw IPv6 literal: no legitimate recipe site uses one
  var m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  var a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function readCapped(res) {
  var reader = res.body.getReader();
  var chunks = [];
  var size = 0;
  while (size < MAX_PAGE_BYTES) {
    var part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    size += part.value.length;
  }
  reader.cancel().catch(function () {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchPage(url) {
  if (isPrivateHost(url.hostname)) throw new UserError(400, "That link can't be read.");
  var res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: {
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'accept': 'text/html,application/xhtml+xml'
      }
    });
  } catch (e) {
    res = null;
  }
  if (!res || !res.ok || isPrivateHost(new URL(res.url || url).hostname)) {
    throw new UserError(502, "Couldn't read that page. Try copying the ingredients and pasting them instead.");
  }
  return readCapped(res);
}

// Most recipe sites describe the recipe as schema.org JSON-LD, which is much
// more reliable than the page text. Returns { title, ingredients } or null.
function findJsonLdRecipe(html) {
  var re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html))) {
    var data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    var recipe = findRecipeNode(data);
    if (recipe) {
      var ingredients = [].concat(recipe.recipeIngredient || recipe.ingredients || [])
        .filter(function (s) { return typeof s === 'string' && s.trim(); });
      if (ingredients.length) return { title: typeof recipe.name === 'string' ? recipe.name : '', ingredients: ingredients };
    }
  }
  return null;
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) {
      var hit = findRecipeNode(node[i]);
      if (hit) return hit;
    }
    return null;
  }
  var type = [].concat(node['@type'] || []);
  if (type.indexOf('Recipe') !== -1) return node;
  return findRecipeNode(node['@graph']) || findRecipeNode(node.mainEntity);
}

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|frac12|frac14|frac34);/gi, function (all, code) {
    var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾' };
    var lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    var n = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return isFinite(n) ? String.fromCodePoint(n) : all;
  });
}

function pageText(html) {
  var title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  var text = html
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return 'Page title: ' + decodeEntities(title).trim() + '\n\n' + text.slice(0, MAX_PAGE_TEXT);
}

/* ---------- Gemini ---------- */

async function askGemini(content) {
  var key = process.env.GEMINI_API_KEY;
  if (!key) throw new UserError(500, 'The AI helper isn’t set up yet (missing GEMINI_API_KEY).');
  var model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  var res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: content }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
      })
    });
  } catch (e) {
    throw new UserError(504, 'The AI took too long to answer. Please try again.');
  }
  if (res.status === 429) throw new UserError(429, 'The AI is busy right now. Wait a minute and try again.');
  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text().catch(function () { return ''; }));
    throw new UserError(502, 'The AI couldn’t read that recipe. Please try again.');
  }
  var data = await res.json();
  var parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  var text = parts.map(function (p) { return p.text || ''; }).join('');
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('Gemini returned non-JSON', text.slice(0, 500));
    throw new UserError(502, 'The AI couldn’t read that recipe. Please try again.');
  }
}

function clean(result) {
  var seen = {};
  var items = (Array.isArray(result && result.items) ? result.items : [])
    .filter(function (s) { return typeof s === 'string'; })
    .map(function (s) { return s.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LEN); })
    .filter(function (s) {
      var k = s.toLowerCase();
      if (!s || seen[k]) return false;
      seen[k] = true;
      return true;
    })
    .slice(0, MAX_ITEMS);
  var title = typeof (result && result.title) === 'string' ? result.title.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return { title: title, items: items };
}

/* ---------- handler ---------- */

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  // Only our own pages may call this, so strangers can't spend the API quota.
  var origin = req.headers.get('origin');
  var host = new URL(req.url).host;
  try {
    if (!origin || new URL(origin).host !== host) return json(403, { error: 'Not allowed.' });
  } catch (e) {
    return json(403, { error: 'Not allowed.' });
  }

  var body;
  try { body = await req.json(); } catch (e) { body = null; }
  var input = body && typeof body.input === 'string' ? body.input.trim() : '';
  if (!input) return json(400, { error: 'Paste some ingredients or a recipe link first.' });
  if (input.length > MAX_INPUT) return json(413, { error: 'That’s a lot of text. Paste just the ingredients section.' });

  try {
    var content;
    if (/^https?:\/\/\S+$/i.test(input)) {
      var html = await fetchPage(new URL(input));
      var recipe = findJsonLdRecipe(html);
      content = recipe
        ? 'Recipe title: ' + recipe.title + '\nIngredients:\n' + recipe.ingredients.join('\n')
        : pageText(html);
    } else {
      content = input;
    }
    var result = clean(await askGemini(content));
    if (!result.items.length) return json(422, { error: 'No ingredients found. Try pasting the ingredient list instead.' });
    return json(200, result);
  } catch (e) {
    if (e instanceof UserError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
