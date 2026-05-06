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

  /* ── Mood chips ──────────────────────────────────────────
     Click a chip to fill the mood input. Active chip mirrors
     the current input value so it reflects manual edits too.
     ──────────────────────────────────────────────────────── */
  const moodInput = document.getElementById('mood_tag');
  const chipRow   = document.querySelector('.upload-chip-row[data-target="mood_tag"]');
  const chips     = chipRow ? chipRow.querySelectorAll('.upload-chip') : [];

  function syncChipActive() {
    if (!moodInput) return;
    const current = (moodInput.value || '').trim().toLowerCase();
    chips.forEach(function (chip) {
      const v = (chip.dataset.value || '').toLowerCase();
      chip.classList.toggle('is-active', v && v === current);
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (!moodInput) return;
      moodInput.value = chip.dataset.value || '';
      moodInput.dispatchEvent(new Event('input', { bubbles: true }));
      moodInput.focus();
    });
  });

  if (moodInput) {
    moodInput.addEventListener('input', syncChipActive);
    syncChipActive();
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
