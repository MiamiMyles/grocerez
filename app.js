(function () {
  'use strict';

  var STORAGE_KEY = 'grocerez:v1';

  var PALETTE = [
    { bg: '#DDEEDB', fg: '#24552A' }, // green
    { bg: '#DCE7F6', fg: '#1E4677' }, // blue
    { bg: '#F7E6C6', fg: '#6B4507' }, // amber
    { bg: '#E9DFF4', fg: '#4F2F75' }, // purple
    { bg: '#D5EEEA', fg: '#1A5650' }, // teal
    { bg: '#F4DCE8', fg: '#7A2350' }  // pink
  ];

  /* ---------- state ---------- */
  // items: [{ id, name, done, tags: [tagId] }] — array order is list order
  // tags:  [{ id, name, color }] — color is fixed at creation (creation order mod 6)
  var state = load();
  var sheetFor = null; // id of the item whose tag sheet is open
  var drag = null;
  var suppressClick = false; // swallow the click that follows a drag's pointerup

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.items) && Array.isArray(s.tags)) {
          return { items: s.items, tags: s.tags, nextId: s.nextId || 1 };
        }
      }
    } catch (e) { /* fall through to a fresh list */ }
    return { items: [], tags: [], nextId: 1 };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }

  function newId(prefix) {
    return prefix + (state.nextId++);
  }

  function commit() {
    save();
    render();
  }

  /* unchecked items first, checked items at the bottom; order kept within each group */
  function settle(items) {
    return items.filter(function (it) { return !it.done; })
      .concat(items.filter(function (it) { return it.done; }));
  }

  function tagById() {
    var byId = {};
    state.tags.forEach(function (t) { byId[t.id] = t; });
    return byId;
  }

  function findItem(id) {
    return state.items.find(function (it) { return it.id === id; });
  }

  /* ---------- actions ---------- */
  /* add several items at once (recipe import), optionally tagged */
  function addItems(names, tagId) {
    var added = names.map(function (n) { return n.trim(); }).filter(Boolean).map(function (n) {
      return { id: newId('i'), name: n, done: false, tags: tagId ? [tagId] : [] };
    });
    if (!added.length) return false;
    state.items = settle(state.items.concat(added));
    commit();
    return true;
  }

  function addItem(name) {
    name = name.trim();
    if (!name) return false;
    state.items = settle(state.items.concat([{ id: newId('i'), name: name, done: false, tags: [] }]));
    commit();
    return true;
  }

  function toggleDone(id) {
    var target = findItem(id);
    if (!target) return;
    var flipped = Object.assign({}, target, { done: !target.done });
    var rest = state.items.filter(function (it) { return it.id !== id; });
    var open = rest.filter(function (it) { return !it.done; });
    var checked = rest.filter(function (it) { return it.done; });
    // checking: to the very bottom; unchecking: to the end of the unchecked group
    state.items = flipped.done ? open.concat(checked, [flipped]) : open.concat([flipped], checked);
    commit();
  }

  function removeItem(id) {
    state.items = state.items.filter(function (it) { return it.id !== id; });
    if (sheetFor === id) closeSheet();
    commit();
  }

  function clearChecked() {
    state.items = state.items.filter(function (it) { return !it.done; });
    commit();
  }

  /* group by each item's first tag (A–Z), untagged after; checked items stay at the bottom, grouped the same way */
  function sortByTag() {
    if (!state.tags.length) return;
    var byId = tagById();
    function key(it) {
      var first = it.tags.find(function (id) { return byId[id]; });
      return first ? byId[first].name.toLowerCase() : null;
    }
    function group(list) {
      var tagged = list.filter(function (it) { return key(it) !== null; });
      var untagged = list.filter(function (it) { return key(it) === null; });
      tagged = tagged.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
        var ka = key(a.it), kb = key(b.it);
        return ka < kb ? -1 : ka > kb ? 1 : a.i - b.i;
      }).map(function (x) { return x.it; });
      return tagged.concat(untagged);
    }
    state.items = group(state.items.filter(function (it) { return !it.done; }))
      .concat(group(state.items.filter(function (it) { return it.done; })));
    commit();
  }

  /* reuse a tag with the same name (any case), or create it */
  function findOrCreateTag(name) {
    var existing = state.tags.find(function (t) { return t.name.toLowerCase() === name.toLowerCase(); });
    if (existing) return existing.id;
    var tagId = newId('t');
    state.tags = state.tags.concat([{ id: tagId, name: name, color: state.tags.length % PALETTE.length }]);
    return tagId;
  }

  function addTagToSheetItem(name) {
    name = name.trim();
    var item = findItem(sheetFor);
    if (!name || !item) return false;
    var tagId = findOrCreateTag(name);
    if (item.tags.indexOf(tagId) === -1) item.tags = item.tags.concat([tagId]);
    commit();
    return true;
  }

  function toggleTag(tagId) {
    var item = findItem(sheetFor);
    if (!item) return;
    item.tags = item.tags.indexOf(tagId) === -1
      ? item.tags.concat([tagId])
      : item.tags.filter(function (x) { return x !== tagId; });
    commit();
  }

  /* ---------- rendering ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list');
  var leftLabel = $('left-label');
  var clearBtn = $('clear-checked');
  var sortBtn = $('sort-by-tag');
  var newItemInput = $('new-item');
  var sheetEl = $('sheet');
  var sheetName = $('sheet-name');
  var firstHint = $('first-hint');
  var chooseSection = $('choose-section');
  var tagPills = $('tag-pills');
  var tagInput = $('tag-name');
  var recipeSheet = $('recipe-sheet');
  var recipeForm = $('recipe-form');
  var recipeInput = $('recipe-input');
  var recipeError = $('recipe-error');
  var recipeFind = $('recipe-find');
  var recipeReview = $('recipe-review');
  var recipeTitle = $('recipe-title');
  var recipeTag = $('recipe-tag');
  var recipeItems = $('recipe-items');
  var recipeAdd = $('recipe-add');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ICON_GRIP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  var ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7"/></svg>';
  var ICON_TAG = '<svg width="21" height="21" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4" fill="#FFFDFC"/></svg>';
  var ICON_TRASH = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>';
  var ICON_PILL_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7"/></svg>';

  function rowHtml(it, byId) {
    var chips = it.tags.filter(function (id) { return byId[id]; }).map(function (id) {
      var t = byId[id], c = PALETTE[t.color % PALETTE.length];
      return '<span class="chip" style="background:' + c.bg + ';color:' + c.fg + '">' + esc(t.name) + '</span>';
    });
    var name = esc(it.name);
    return '<div class="row' + (it.done ? ' done' : '') + '" data-row data-id="' + esc(it.id) + '">' +
      '<button type="button" class="icon-btn grip" data-grip aria-label="Drag to reorder ' + name + '">' + ICON_GRIP + '</button>' +
      '<button type="button" class="icon-btn check" data-action="toggle" aria-pressed="' + it.done + '" aria-label="' + (it.done ? 'Uncheck ' : 'Check off ') + name + '">' +
        '<span class="box">' + ICON_CHECK + '</span></button>' +
      '<div class="body"><span class="name">' + name + '</span>' +
        (chips.length ? '<div class="chips">' + chips.join('') + '</div>' : '') +
      '</div>' +
      '<button type="button" class="icon-btn tag-btn' + (chips.length ? ' has-tags' : '') + '" data-action="tags" aria-label="Tags for ' + name + '">' + ICON_TAG + '</button>' +
      '<button type="button" class="icon-btn del-btn" data-action="delete" aria-label="Delete ' + name + '">' + ICON_TRASH + '</button>' +
    '</div>';
  }

  function render() {
    var items = state.items;
    var byId = tagById();
    var left = items.filter(function (it) { return !it.done; }).length;
    var doneCount = items.length - left;
    var hasTags = state.tags.length > 0;

    leftLabel.textContent = items.length === 0 ? 'Your list is empty'
      : left === 0 ? 'All done — nice.'
      : left + ' of ' + items.length + ' left to get';

    clearBtn.hidden = doneCount === 0;
    sortBtn.setAttribute('aria-disabled', hasTags ? 'false' : 'true');
    sortBtn.title = hasTags ? 'Group items by their first tag' : 'Add a tag to an item to sort by tag';

    listEl.innerHTML = items.length === 0
      ? '<div class="empty">Nothing on the list yet.<br>Add your first item above.</div>'
      : items.map(function (it) { return rowHtml(it, byId); }).join('');

    renderSheet();
  }

  function renderSheet() {
    var item = findItem(sheetFor);
    if (!item) {
      sheetEl.hidden = true;
      return;
    }
    var hasTags = state.tags.length > 0;
    sheetName.textContent = item.name;
    firstHint.hidden = hasTags;
    chooseSection.hidden = !hasTags;
    tagInput.placeholder = hasTags ? 'New tag name' : 'e.g. Produce, Costco, Taco night';
    tagPills.innerHTML = state.tags.map(function (t) {
      var on = item.tags.indexOf(t.id) !== -1;
      var c = PALETTE[t.color % PALETTE.length];
      var style = on ? 'background:' + c.bg + ';color:' + c.fg + ';border-color:' + c.fg : '';
      return '<button type="button" class="tag-pill" data-tag="' + esc(t.id) + '" aria-pressed="' + on + '" style="' + style + '">' +
        (on ? ICON_PILL_CHECK : '<span class="dot" style="background:' + c.fg + '"></span>') +
        esc(t.name) + '</button>';
    }).join('');
    sheetEl.hidden = false;
  }

  function openSheet(id) {
    sheetFor = id;
    tagInput.value = '';
    renderSheet();
  }

  function closeSheet() {
    sheetFor = null;
    tagInput.value = '';
    tagInput.blur();
    sheetEl.hidden = true;
    sheetEl.classList.remove('kb-open');
    document.documentElement.style.removeProperty('--kb');
  }

  /* ---------- recipe import (AI) ---------- */
  // found: [{ name, on }] from the last successful lookup; null while on the paste step
  var recipe = { open: false, busy: false, found: null, request: 0 };

  function openRecipe() {
    if (sheetFor) closeSheet();
    recipe.open = true;
    showRecipeInput();
    recipeSheet.hidden = false;
    recipeInput.focus();
  }

  function closeRecipe() {
    recipe.open = false;
    recipe.busy = false;
    recipe.request++; // ignore any lookup still in flight
    recipe.found = null;
    recipeInput.value = '';
    document.activeElement && document.activeElement.blur();
    recipeSheet.hidden = true;
    recipeSheet.classList.remove('kb-open');
    document.documentElement.style.removeProperty('--kb');
  }

  function showRecipeInput() {
    recipe.found = null;
    recipeTitle.textContent = 'Paste a recipe';
    recipeForm.hidden = false;
    recipeReview.hidden = true;
    setRecipeBusy(false);
    showRecipeError('');
  }

  function showRecipeError(msg) {
    recipeError.textContent = msg;
    recipeError.hidden = !msg;
  }

  function setRecipeBusy(busy) {
    recipe.busy = busy;
    recipeFind.disabled = busy;
    recipeFind.setAttribute('aria-busy', busy ? 'true' : 'false');
    recipeFind.textContent = busy ? 'Reading recipe…' : 'Find ingredients';
  }

  function findIngredients() {
    var input = recipeInput.value.trim();
    if (!input || recipe.busy) {
      if (!input) showRecipeError('Paste some ingredients or a recipe link first.');
      return;
    }
    if (!navigator.onLine) {
      showRecipeError('You\u2019re offline. Adding from a recipe needs an internet connection.');
      return;
    }
    showRecipeError('');
    setRecipeBusy(true);
    var req = ++recipe.request;
    fetch('api/recipe-ingredients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: input })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || !Array.isArray(data.items)) {
          throw new Error((data && data.error) || 'Something went wrong. Please try again.');
        }
        return data;
      });
    }).then(function (data) {
      if (req !== recipe.request) return;
      setRecipeBusy(false);
      showRecipeReview(data);
    }).catch(function (err) {
      if (req !== recipe.request) return;
      setRecipeBusy(false);
      showRecipeError(err instanceof TypeError
        ? 'Couldn\u2019t reach the AI helper. Check your connection and try again.'
        : err.message);
    });
  }

  function showRecipeReview(data) {
    recipe.found = data.items.map(function (n) { return { name: String(n), on: true }; });
    recipeTitle.textContent = data.title || 'Ingredients found';
    recipeTag.value = data.title || '';
    recipeForm.hidden = true;
    recipeReview.hidden = false;
    renderFound();
    recipeInput.blur();
  }

  function renderFound() {
    recipeItems.innerHTML = recipe.found.map(function (f, i) {
      return '<button type="button" class="found-row" data-found="' + i + '" aria-pressed="' + f.on + '">' +
        '<span class="box">' + ICON_CHECK + '</span><span class="found-name">' + esc(f.name) + '</span></button>';
    }).join('');
    var n = recipe.found.filter(function (f) { return f.on; }).length;
    recipeAdd.textContent = n ? 'Add ' + n + (n === 1 ? ' item' : ' items') : 'Nothing selected';
    recipeAdd.disabled = n === 0;
  }

  function addFound() {
    var names = recipe.found.filter(function (f) { return f.on; }).map(function (f) { return f.name; });
    var tagName = recipeTag.value.trim();
    var tagId = tagName ? findOrCreateTag(tagName) : null;
    closeRecipe();
    if (addItems(names, tagId)) {
      var rows = listEl.querySelectorAll('[data-row]:not(.done)');
      var last = rows[rows.length - 1];
      if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  $('recipe-open').addEventListener('click', openRecipe);

  recipeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    findIngredients();
  });

  recipeSheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closeRecipe(); return; }
    var row = e.target.closest('[data-found]');
    if (row) {
      var f = recipe.found[+row.getAttribute('data-found')];
      f.on = !f.on;
      renderFound();
    }
  });

  $('recipe-back').addEventListener('click', showRecipeInput);
  recipeAdd.addEventListener('click', addFound);
  recipeTag.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); recipeTag.blur(); }
  });

  /* ---------- events ---------- */
  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (addItem(newItemInput.value)) {
      newItemInput.value = '';
      // keep the new item in view: it lands at the end of the unchecked group
      var rows = listEl.querySelectorAll('[data-row]:not(.done)');
      var last = rows[rows.length - 1];
      if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  clearBtn.addEventListener('click', clearChecked);
  sortBtn.addEventListener('click', sortByTag);

  listEl.addEventListener('click', function (e) {
    if (drag || suppressClick) return;
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.closest('[data-row]').getAttribute('data-id');
    var action = btn.getAttribute('data-action');
    if (action === 'toggle') toggleDone(id);
    else if (action === 'delete') removeItem(id);
    else if (action === 'tags') openSheet(id);
  });

  sheetEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    var pill = e.target.closest('[data-tag]');
    if (pill) toggleTag(pill.getAttribute('data-tag'));
  });

  $('tag-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (addTagToSheetItem(tagInput.value)) tagInput.value = '';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheetFor) closeSheet();
    else if (e.key === 'Escape' && recipe.open) closeRecipe();
  });

  /* keep the open sheet above the on-screen keyboard (iOS overlays it instead of resizing) */
  if (window.visualViewport) {
    var vv = window.visualViewport;
    var syncKeyboard = function () {
      if (!sheetFor && !recipe.open) return;
      var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb + 'px');
      (sheetFor ? sheetEl : recipeSheet).classList.toggle('kb-open', kb > 80);
      if (kb > 0) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', syncKeyboard);
    vv.addEventListener('scroll', syncKeyboard);
  }

  /* ---------- drag to reorder ---------- */
  // Press the grip, drag vertically; other rows shift live to preview the drop.
  // A row stays within its own group (unchecked vs checked).
  var GAP = 8;
  var EDGE = 56;

  listEl.addEventListener('pointerdown', function (e) {
    var grip = e.target.closest('[data-grip]');
    if (!grip || drag) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();

    var rows = Array.prototype.slice.call(listEl.querySelectorAll('[data-row]'));
    var rowEl = grip.closest('[data-row]');
    var from = rows.indexOf(rowEl);
    var done = state.items[from].done;
    var lo = 0, hi = rows.length - 1;
    while (state.items[lo].done !== done) lo++;
    while (state.items[hi].done !== done) hi--;

    drag = {
      pointerId: e.pointerId,
      rows: rows,
      from: from, to: from, lo: lo, hi: hi,
      startY: e.clientY, lastY: e.clientY,
      startScroll: listEl.scrollTop,
      tops: rows.map(function (r) { return r.offsetTop; }),
      heights: rows.map(function (r) { return r.offsetHeight; }),
      raf: 0
    };
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    rowEl.classList.add('dragging');
    listEl.classList.add('drag-active');
    if (navigator.vibrate) navigator.vibrate(10);
    drag.raf = requestAnimationFrame(autoScroll);
  });

  function updateDrag() {
    var d = drag;
    var dy = d.lastY - d.startY + (listEl.scrollTop - d.startScroll);
    var center = d.tops[d.from] + d.heights[d.from] / 2 + dy;
    var to = d.from;
    for (var i = d.from + 1; i < d.tops.length; i++) if (center > d.tops[i] + d.heights[i] / 2) to = i;
    for (var j = d.from - 1; j >= 0; j--) if (center < d.tops[j] + d.heights[j] / 2) to = j;
    to = Math.min(d.hi, Math.max(d.lo, to));
    d.to = to;

    var shift = d.heights[d.from] + GAP;
    d.rows.forEach(function (r, k) {
      var y = 0;
      if (k === d.from) y = dy;
      else if (to > d.from && k > d.from && k <= to) y = -shift;
      else if (to < d.from && k < d.from && k >= to) y = shift;
      r.style.transform = y ? 'translateY(' + y + 'px)' : '';
    });
  }

  function autoScroll() {
    if (!drag) return;
    var rect = listEl.getBoundingClientRect();
    var speed = 0;
    if (drag.lastY < rect.top + EDGE) speed = -Math.ceil((rect.top + EDGE - drag.lastY) / 6);
    else if (drag.lastY > rect.bottom - EDGE) speed = Math.ceil((drag.lastY - (rect.bottom - EDGE)) / 6);
    if (speed) {
      var before = listEl.scrollTop;
      listEl.scrollTop += speed;
      if (listEl.scrollTop !== before) updateDrag();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.lastY = e.clientY;
    updateDrag();
  }, { passive: false });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    var d = drag;
    cancelAnimationFrame(d.raf);
    var items = state.items.slice();
    var moved = items.splice(d.from, 1)[0];
    items.splice(d.to, 0, moved);
    state.items = settle(items);
    listEl.classList.remove('drag-active');
    drag = null;
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 0);
    var scroll = listEl.scrollTop;
    commit();
    listEl.scrollTop = scroll;
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // iOS: stop the list from scrolling when a drag starts on a grip
  listEl.addEventListener('touchmove', function (e) {
    if (drag) e.preventDefault();
  }, { passive: false });

  /* ---------- boot ---------- */
  render();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable */ });
    });
  }
})();
