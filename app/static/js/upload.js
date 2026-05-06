/* ============================================================
   TUNEFEED — Upload page interactions
   - Live cover image preview from URL
   - Audio preview when a plausible audio URL is pasted
   - Mood quick-fill chips
   - Visual highlight on tier cards when their price has a value
   ============================================================ */
(function () {
  'use strict';

  /* ── Cover preview ───────────────────────────────────────
     Switches the dashed placeholder to the loaded image when
     the URL resolves; falls back to the placeholder on error.
     ──────────────────────────────────────────────────────── */
  const coverInput = document.getElementById('cover_url');
  const coverFrame = document.getElementById('cover-frame');
  const coverImg   = document.getElementById('cover-preview-img');
  const coverEmpty = document.getElementById('cover-empty');

  function showCover(url) {
    if (!coverImg || !coverFrame || !coverEmpty) return;
    if (!url) {
      coverImg.hidden = true;
      coverImg.removeAttribute('src');
      coverEmpty.hidden = false;
      coverFrame.classList.remove('has-cover');
      return;
    }
    coverImg.onload = function () {
      coverImg.hidden = false;
      coverEmpty.hidden = true;
      coverFrame.classList.add('has-cover');
    };
    coverImg.onerror = function () {
      coverImg.hidden = true;
      coverEmpty.hidden = false;
      coverFrame.classList.remove('has-cover');
    };
    coverImg.src = url;
  }

  if (coverInput) {
    coverInput.addEventListener('input', function () {
      showCover(coverInput.value.trim());
    });
    /* Repopulate after a failed POST round-trip */
    if (coverInput.value) showCover(coverInput.value.trim());
  }

  /* ── Audio preview ───────────────────────────────────────
     Only swaps the player src when the URL changes settle —
     debounced so we don't refetch on every keystroke.
     ──────────────────────────────────────────────────────── */
  const audioInput = document.getElementById('audio_url');
  const audioBox   = document.getElementById('audio-preview');
  const audioPlayer = document.getElementById('audio-preview-player');

  let audioDebounce;

  function looksLikeAudioUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, window.location.origin);
      return /^https?:$/.test(u.protocol);
    } catch (_) {
      return false;
    }
  }

  function setAudioPreview(url) {
    if (!audioBox || !audioPlayer) return;
    if (!looksLikeAudioUrl(url)) {
      audioBox.hidden = true;
      audioPlayer.removeAttribute('src');
      audioPlayer.load();
      return;
    }
    audioPlayer.src = url;
    audioBox.hidden = false;
    audioPlayer.onerror = function () {
      audioBox.hidden = true;
    };
  }

  if (audioInput) {
    audioInput.addEventListener('input', function () {
      clearTimeout(audioDebounce);
      audioDebounce = setTimeout(function () {
        setAudioPreview(audioInput.value.trim());
      }, 350);
    });
    if (audioInput.value) setAudioPreview(audioInput.value.trim());
  }

  /* ── Multi-tag system ────────────────────────────────────
     Hidden input stores comma-separated tags. Visual box
     shows pill spans + a transparent text input. Chips
     toggle tags on/off instead of overwriting.
     ──────────────────────────────────────────────────────── */
  const hiddenInput = document.getElementById('mood_tag');
  const tagsBox     = document.getElementById('tags-box');
  const tagsType    = document.getElementById('tags-type');
  const chipRow     = document.querySelector('.upload-chip-row[data-target="mood_tag"]');
  const chips       = chipRow ? chipRow.querySelectorAll('.upload-chip') : [];
  const MAX_TAGS    = 5;

  function getTags() {
    const v = (hiddenInput ? hiddenInput.value : '').trim();
    return v ? v.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
  }

  function setTags(tags) {
    if (!hiddenInput) return;
    hiddenInput.value = tags.join(',');
    renderTags(tags);
    syncChips(tags);
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderTags(tags) {
    if (!tagsBox || !tagsType) return;
    tagsBox.querySelectorAll('.upload-tag-pill').forEach(function (p) { p.remove(); });
    tags.forEach(function (tag) {
      const pill = document.createElement('span');
      pill.className = 'upload-tag-pill';
      const label = document.createElement('span');
      label.textContent = tag;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'upload-tag-remove';
      rm.setAttribute('aria-label', 'Remove ' + tag);
      rm.innerHTML = '&times;';
      rm.addEventListener('click', function () {
        setTags(getTags().filter(function (t) { return t !== tag; }));
      });
      pill.appendChild(label);
      pill.appendChild(rm);
      tagsBox.insertBefore(pill, tagsType);
    });
  }

  function syncChips(tags) {
    const lower = tags.map(function (t) { return t.toLowerCase(); });
    chips.forEach(function (chip) {
      const v = (chip.dataset.value || '').toLowerCase();
      chip.classList.toggle('is-active', v && lower.indexOf(v) !== -1);
    });
  }

  function addTag(raw) {
    const val = raw.trim().replace(/,/g, '');
    if (!val) return;
    const tags = getTags();
    if (tags.length >= MAX_TAGS) return;
    const lower = tags.map(function (t) { return t.toLowerCase(); });
    if (lower.indexOf(val.toLowerCase()) !== -1) return;
    setTags(tags.concat(val));
  }

  if (tagsType) {
    tagsType.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ',') && tagsType.value.trim()) {
        e.preventDefault();
        addTag(tagsType.value);
        tagsType.value = '';
      } else if (e.key === 'Backspace' && !tagsType.value) {
        const tags = getTags();
        if (tags.length) setTags(tags.slice(0, -1));
      }
    });
    tagsType.addEventListener('blur', function () {
      if (tagsType.value.trim()) {
        addTag(tagsType.value);
        tagsType.value = '';
      }
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      const val = chip.dataset.value || '';
      const tags = getTags();
      const lower = tags.map(function (t) { return t.toLowerCase(); });
      if (lower.indexOf(val.toLowerCase()) !== -1) {
        setTags(tags.filter(function (t) { return t.toLowerCase() !== val.toLowerCase(); }));
      } else {
        addTag(val);
      }
    });
  });

  if (tagsBox) {
    tagsBox.addEventListener('click', function () { tagsType && tagsType.focus(); });
  }

  if (hiddenInput && hiddenInput.value) {
    renderTags(getTags());
    syncChips(getTags());
  }

  /* ── Tier card highlighting ──────────────────────────────
     Adds .is-active to a tier when its price input has a
     value, so the user can see at a glance which tiers will
     be active on their listing.
     ──────────────────────────────────────────────────────── */
  function bindTierHighlight(inputId, tierSelector) {
    const input = document.getElementById(inputId);
    const tier  = document.querySelector(tierSelector);
    if (!input || !tier) return;

    function update() {
      const v = parseFloat(input.value);
      tier.classList.toggle('is-active', !Number.isNaN(v) && v > 0);
    }
    input.addEventListener('input', update);
    update();
  }

  bindTierHighlight('price',           '.upload-tier-basic');
  bindTierHighlight('premium_price',   '.upload-tier-premium');
  bindTierHighlight('exclusive_price', '.upload-tier-exclusive');
})();

/* ============================================================
   Genre combobox — searchable + free-text genre field
   ============================================================ */
(function () {
  'use strict';

  var GENRE_GROUPS = [
    { label: 'Urban',              genres: ['Hip-Hop', 'Trap', 'Drill', 'R&B / Soul', 'Afrobeats', 'Dancehall'] },
    { label: 'Electronic',         genres: ['Electronic / EDM', 'House', 'Techno', 'Drum & Bass', 'Ambient', 'Lo-Fi'] },
    { label: 'Pop & Global',       genres: ['Pop', 'Latin', 'Reggaeton', 'World Music'] },
    { label: 'Live & Traditional', genres: ['Jazz', 'Blues', 'Funk', 'Gospel', 'Classical', 'Rock', 'Alternative', 'Country'] },
    { label: 'Specialty',          genres: ['Cinematic', 'Experimental', 'Soundtrack'] },
  ];

  var hiddenEl = document.getElementById('genre');
  var comboEl  = document.getElementById('genre-combo');
  var inputEl  = document.getElementById('genre-input');
  var clearEl  = document.getElementById('genre-clear');
  var dropEl   = document.getElementById('genre-dropdown');

  if (!hiddenEl || !inputEl || !dropEl) return;

  var isOpen    = false;
  var highlight = -1;
  var flatOpts  = [];
  var prevVal   = hiddenEl.value;

  function allGenres() {
    return GENRE_GROUPS.reduce(function (acc, g) { return acc.concat(g.genres); }, []);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    prevVal = hiddenEl.value;
    comboEl.classList.add('is-open');
    inputEl.setAttribute('aria-expanded', 'true');
    renderList(inputEl.value.trim());
    dropEl.hidden = false;
    var sel = dropEl.querySelector('.is-selected');
    if (sel) setTimeout(function () { sel.scrollIntoView({ block: 'nearest' }); }, 0);
  }

  function close(accept) {
    if (!isOpen) return;
    isOpen = false;
    highlight = -1;
    flatOpts  = [];
    comboEl.classList.remove('is-open');
    inputEl.setAttribute('aria-expanded', 'false');
    dropEl.hidden = true;
    if (!accept) inputEl.value = prevVal;
  }

  function commit(val) {
    hiddenEl.value = val;
    inputEl.value  = val;
    clearEl.hidden = !val;
    close(true);
  }

  function renderList(q) {
    dropEl.innerHTML = '';
    flatOpts = [];
    var ql = (q || '').toLowerCase();
    var hasAny = false;

    GENRE_GROUPS.forEach(function (group) {
      var matches = ql
        ? group.genres.filter(function (g) { return g.toLowerCase().indexOf(ql) !== -1; })
        : group.genres;
      if (!matches.length) return;

      var hdr = document.createElement('li');
      hdr.className = 'genre-group-header';
      hdr.textContent = group.label;
      hdr.setAttribute('aria-hidden', 'true');
      dropEl.appendChild(hdr);

      matches.forEach(function (g) {
        hasAny = true;
        var idx = flatOpts.length;
        flatOpts.push({ value: g, custom: false });
        dropEl.appendChild(makeItem(g, idx, false));
      });
    });

    /* Custom entry if typed value has no exact match */
    if (q) {
      var exact = allGenres().some(function (g) { return g.toLowerCase() === ql; });
      if (!exact) {
        var idx = flatOpts.length;
        flatOpts.push({ value: q, custom: true });
        dropEl.appendChild(makeItem(q, idx, true));
        hasAny = true;
      }
    }

    if (!hasAny) {
      var empty = document.createElement('li');
      empty.className = 'genre-empty';
      empty.textContent = 'No genres match — keep typing to use a custom one.';
      dropEl.appendChild(empty);
    }

    highlight = -1;
    refreshHighlight();
  }

  function makeItem(value, idx, custom) {
    var li = document.createElement('li');
    li.className = 'genre-item' + (custom ? ' is-custom' : '');
    li.setAttribute('role', 'option');
    li.dataset.idx = idx;

    var icon = document.createElement('i');
    icon.className = (custom ? 'bi bi-plus-circle-dotted' : 'bi bi-music-note') + ' genre-lead';

    var span = document.createElement('span');
    span.textContent = custom ? 'Use “' + value + '”' : value;

    li.appendChild(icon);
    li.appendChild(span);

    if (!custom && hiddenEl.value === value) {
      li.classList.add('is-selected');
      var check = document.createElement('i');
      check.className = 'bi bi-check2 genre-check';
      li.appendChild(check);
    }

    li.addEventListener('mousedown', function (e) {
      e.preventDefault();
      commit(value);
    });
    li.addEventListener('mousemove', function () { setHL(idx); });
    return li;
  }

  function setHL(idx) {
    highlight = idx;
    refreshHighlight();
  }

  function refreshHighlight() {
    dropEl.querySelectorAll('.genre-item').forEach(function (el) {
      el.classList.toggle('is-highlighted', parseInt(el.dataset.idx, 10) === highlight);
    });
  }

  function stepHL(dir) {
    var next = highlight + dir;
    if (next < 0 || next >= flatOpts.length) return;
    setHL(next);
    var el = dropEl.querySelector('[data-idx="' + highlight + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  inputEl.addEventListener('focus', function () { open(); });

  inputEl.addEventListener('input', function () {
    clearEl.hidden = !inputEl.value;
    renderList(inputEl.value.trim());
    if (!isOpen) open();
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      stepHL(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepHL(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!isOpen) { open(); return; }
      if (highlight >= 0 && flatOpts[highlight]) {
        commit(flatOpts[highlight].value);
      } else if (inputEl.value.trim()) {
        commit(inputEl.value.trim());
      }
    } else if (e.key === 'Escape') {
      if (isOpen) close(false);
    } else if (e.key === 'Tab') {
      if (isOpen) {
        if (highlight >= 0 && flatOpts[highlight]) {
          commit(flatOpts[highlight].value);
        } else if (inputEl.value.trim()) {
          hiddenEl.value = inputEl.value.trim();
          clearEl.hidden = false;
        }
        close(true);
      }
    }
  });

  inputEl.addEventListener('blur', function () {
    setTimeout(function () {
      if (!isOpen) return;
      var v = inputEl.value.trim();
      if (v) { hiddenEl.value = v; clearEl.hidden = false; }
      else   { hiddenEl.value = ''; clearEl.hidden = true; }
      close(true);
    }, 160);
  });

  clearEl.addEventListener('mousedown', function (e) {
    e.preventDefault();
    commit('');
    inputEl.focus();
  });

  /* Click on icon or chevron area toggles the panel */
  comboEl.addEventListener('mousedown', function (e) {
    if (inputEl.contains(e.target) || clearEl.contains(e.target)) return;
    e.preventDefault();
    if (isOpen) { close(true); inputEl.blur(); }
    else { inputEl.focus(); }
  });
}());
