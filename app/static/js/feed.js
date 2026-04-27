"use strict";

/* ============================================================
   TUNEFEED — Feed JavaScript
   Covers:
     - IntersectionObserver: auto-play/pause per card
     - Audio playback, seek, volume controls
     - Skip ±15s buttons
     - Play-count AJAX (with deduplication)
     - Like / Follow AJAX with animations
     - Comments drawer: load, post, reply, like/dislike, report
     - Infinite scroll: AJAX load next page
   ============================================================ */

// FEED_CONFIG is injected by the Jinja template at page load
const cfg = window.FEED_CONFIG || {};

// CSRF token required by Flask-WTF for all state-changing requests
const CSRF = cfg.csrfToken || document.querySelector('meta[name="csrf-token"]')?.content || '';

// ── Active card state ──────────────────────────────────────────────────────
const FeedState = {
  activeCardId: null,          // beat id of the card currently snapped into view
  audioBeatId: null,           // beat id whose audio is loaded in the shared player
  userPaused: false,           // true when the user explicitly paused (suppresses auto-play on scroll)
  audioActuallyPlaying: false, // true only after audio.play() Promise resolves
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function postJSON(url, data = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function deleteJSON(url) {
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-CSRFToken': CSRF },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function formatNum(n) {
  // Mirror of the Python format_num filter — keeps counts readable at scale
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function escHtml(s) {
  // Prevent XSS when inserting user-supplied strings into innerHTML
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)    return `${Math.floor(diff)}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function formatClock(totalSec) {
  const s = Math.max(0, Math.floor(Number(totalSec) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseDurationToSeconds(durationText) {
  const raw = String(durationText || '3:00');
  const parts = raw.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 180;
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return 180;
}

function getAudioEl() {
  return document.getElementById('feed-audio-player');
}

function getBeatMetaFromCard(beatId) {
  const card = document.getElementById(`feed-card-${beatId}`);
  if (!card) return null;
  const raw = card.dataset.beat || '{}';
  const meta = JSON.parse(raw);
  return {
    id: beatId,
    title: meta.title || `Beat ${beatId}`,
    producer: meta.producer || meta.producer_username || 'Unknown Producer',
    audio_url: meta.audio_url || '',
    bpm: Number(meta.bpm) || 120,
    key: meta.key || 'C',
    duration: meta.duration || '3:00',
  };
}

function setBeatPlayingState(beatId, playing) {
  updateTransportPlayIcon(beatId, playing);
  syncTransportControls(beatId);
}

function loadAudioForBeat(beatId) {
  const audio = getAudioEl();
  const meta = getBeatMetaFromCard(beatId);
  if (!audio || !meta || !meta.audio_url) return false;

  if (FeedState.audioBeatId !== beatId) {
    // crossOrigin must be set BEFORE src so the browser sends the CORS request header
    audio.crossOrigin = 'anonymous';
    audio.src = meta.audio_url;
    audio.loop = true;   // infinite playback — track restarts automatically on end
    audio.load();
    audio.playbackRate = 1.0;
    FeedState.audioBeatId = beatId;
  }
  return true;
}

function playBeatAudio(beatId) {
  if (!loadAudioForBeat(beatId)) return;
  const audio = getAudioEl();
  if (!audio) return;

  // If the shared player was muted, restore audible output for explicit play actions
  if (audio.volume === 0) audio.volume = 1;

  setBeatPlayingState(beatId, true);

  audio.play().then(() => {
    FeedState.userPaused = false;
    FeedState.audioActuallyPlaying = true;
  }).catch((err) => {
    FeedState.audioActuallyPlaying = false;
    // Audio blocked by autoplay policy — reset play icon so user knows to tap
    updateTransportPlayIcon(beatId, false);
    if (err && err.name === 'NotAllowedError') {
      showTapHint(beatId);
    }
  });
}

function pauseBeatAudio(beatId) {
  const audio = getAudioEl();
  if (!audio) return;
  audio.pause();
  FeedState.userPaused = true;
  setBeatPlayingState(beatId, false);
}

// ── Tap-to-play hint ──────────────────────────────────────────────────────
// Shown over the waveform shell when the browser blocks autoplay.
// Disappears the moment the user clicks anywhere.

function showTapHint(beatId) {
  const shell = document.querySelector(`#feed-card-${beatId} .feed-waveform-shell`);
  if (!shell || shell.querySelector('.feed-tap-hint')) return;
  const hint = document.createElement('div');
  hint.className = 'feed-tap-hint';
  hint.innerHTML = '<i class="bi bi-play-circle-fill"></i><span>Tap to play</span>';
  shell.appendChild(hint);
}

function removeTapHint(beatId) {
  const hint = document.querySelector(`#feed-card-${beatId} .feed-tap-hint`);
  if (hint) hint.remove();
}

function updateTransportPlayIcon(beatId, playing) {
  const btn = document.querySelector(`.feed-transport-btn[data-action="play-toggle"][data-beat-id="${beatId}"]`);
  if (!btn) return;
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = playing ? 'bi bi-pause-fill' : 'bi bi-play-fill';
  }
  btn.classList.toggle('is-playing', playing);
  const dock = document.getElementById(`transport-${beatId}`);
  if (dock) dock.classList.toggle('is-playing', playing);
}

function syncTransportControls(beatId) {
  const audio = getAudioEl();
  const meta = getBeatMetaFromCard(beatId);
  if (!meta) return;

  const timeEl = document.getElementById(`feed-player-time-${beatId}`);
  const durationEl = document.getElementById(`feed-player-duration-${beatId}`);
  const seekEl = document.getElementById(`feed-player-seek-${beatId}`);
  const volumeEl = document.getElementById(`feed-player-volume-${beatId}`);
  const volumeValueEl = document.getElementById(`feed-player-volume-value-${beatId}`);

  const duration = Number(audio?.duration || parseDurationToSeconds(meta.duration));
  const current = Number(audio?.currentTime || 0);
  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const volume = Math.round((Number(audio?.volume ?? 0.5)) * 100);

  if (timeEl) timeEl.textContent = formatClock(current);
  if (durationEl) durationEl.textContent = formatClock(duration);
  if (seekEl && document.activeElement !== seekEl) seekEl.value = String(progress);
  if (volumeEl && document.activeElement !== volumeEl) volumeEl.value = String(volume);
  if (volumeValueEl) volumeValueEl.textContent = `${volume}%`;

  // Use only paused state — when audio.loop is true, audio.ended is momentarily
  // true during the loop transition even though playback immediately resumes.
  updateTransportPlayIcon(beatId, !!(audio && !audio.paused));
}

function handleTransportAction(beatId, action) {
  const audio = getAudioEl();
  if (!audio) return;

  if (FeedState.activeCardId !== beatId) {
    activateCard(beatId);
    return;
  }

  switch (action) {
    case 'restart':
      audio.currentTime = 0;
      FeedState.userPaused = false;
      if (audio.paused) playBeatAudio(beatId);
      else syncTransportControls(beatId);
      break;
    case 'back15':
      audio.currentTime = Math.max(0, audio.currentTime - 15);
      syncTransportControls(beatId);
      break;
    case 'forward15':
      audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 15);
      syncTransportControls(beatId);
      break;
    case 'play-toggle':
    default:
      // Unknown actions fall back to play/pause so new transport buttons degrade safely
      FeedState.userPaused = false;
      if (!audio.paused) {
        pauseBeatAudio(beatId);
      } else {
        playBeatAudio(beatId);
      }
      break;
  }
}

// ── Card activation (via IntersectionObserver) ─────────────────────────────

function activateCard(beatId) {
  if (FeedState.activeCardId === beatId) return;  // already active, nothing to do

  if (FeedState.activeCardId != null) {
    deactivateCard(FeedState.activeCardId);  // stop the previous card before starting the new one
  }

  FeedState.activeCardId = beatId;
  const card = document.getElementById(`feed-card-${beatId}`);
  if (card) card.classList.add('is-active');

  setBeatPlayingState(beatId, true);

  // Auto-play audio when a card becomes active unless the user explicitly paused
  if (!FeedState.userPaused) {
    playBeatAudio(beatId);
  } else {
    loadAudioForBeat(beatId);
  }

  // Notify the server a play has started (deduplicated server-side)
  pingPlay(beatId);
}

function deactivateCard(beatId) {
  setBeatPlayingState(beatId, false);

  const audio = getAudioEl();
  if (audio && FeedState.audioBeatId === beatId) {
    audio.pause();
  }

  const card = document.getElementById(`feed-card-${beatId}`);
  if (card) card.classList.remove('is-active');
}

function initIntersectionObserver() {
  // 60% visibility threshold means the card must be mostly in view before it activates
  const opts = { threshold: 0.6 };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const beatId = Number(entry.target.dataset.beatId);
      if (entry.isIntersecting) {
        activateCard(beatId);
      }
    });
  }, opts);

  document.querySelectorAll('.feed-card[data-beat-id]').forEach(card => {
    observer.observe(card);
  });
}

// ── Play/Pause toggle ──────────────────────────────────────────────────────

function initPlayPauseButtons() {
  // Clicking any transport button
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.feed-transport-btn');
    if (!btn) return;
    const beatId = Number(btn.dataset.beatId);
    const action = btn.dataset.action;
    if (!beatId || !action) return;
    handleTransportAction(beatId, action);
  });

  // Clicking the waveform shell itself toggles play/pause —
  // gives the user a large, obvious tap target (especially on mobile)
  document.addEventListener('click', (event) => {
    const shell = event.target.closest('.feed-waveform-shell');
    if (!shell) return;
    const card = shell.closest('.feed-card[data-beat-id]');
    if (!card) return;
    const beatId = Number(card.dataset.beatId);
    if (!beatId) return;
    const audio = getAudioEl();
    removeTapHint(beatId);
    if (FeedState.activeCardId !== beatId) {
      FeedState.userPaused = false;
      activateCard(beatId);
    } else if (audio && !audio.paused) {
      pauseBeatAudio(beatId);
    } else {
      FeedState.userPaused = false;
      playBeatAudio(beatId);
    }
  });

  document.addEventListener('input', (event) => {
    const seek = event.target.closest('.feed-transport-seek');
    const volume = event.target.closest('.feed-transport-volume');
    const audio = getAudioEl();
    if (!audio) return;

    if (seek) {
      const beatId = Number(seek.dataset.beatId);
      if (!beatId) return;
      if ((audio.duration || 0) > 0) {
        audio.currentTime = (Number(seek.value) / 100) * audio.duration;
      }
      syncTransportControls(beatId);
      return;
    }

    if (volume) {
      const beatId = Number(volume.dataset.beatId);
      if (!beatId) return;
      audio.volume = Number(volume.value) / 100;
      syncTransportControls(beatId);
    }
  });

  const audio = getAudioEl();
  if (audio) {
    audio.addEventListener('play', () => {
      if (FeedState.audioBeatId != null) {
        setBeatPlayingState(FeedState.audioBeatId, true);
      }
    });
    audio.addEventListener('playing', () => {
      if (FeedState.audioBeatId != null) {
        setBeatPlayingState(FeedState.audioBeatId, true);
      }
    });
    audio.addEventListener('pause', () => {
      if (FeedState.audioBeatId != null) {
        setBeatPlayingState(FeedState.audioBeatId, false);
      }
    });
    audio.addEventListener('timeupdate', () => {
      if (FeedState.audioBeatId) syncTransportControls(FeedState.audioBeatId);
    });
    audio.addEventListener('loadedmetadata', () => {
      if (FeedState.audioBeatId) syncTransportControls(FeedState.audioBeatId);
    });
    audio.addEventListener('volumechange', () => {
      if (FeedState.audioBeatId) syncTransportControls(FeedState.audioBeatId);
    });
    audio.addEventListener('ended', () => {
      if (FeedState.audioBeatId) {
        if (audio.loop) {
          // Loop is on: browser automatically resets and replays.
          // Do NOT stop the playing state — just sync the seek bar so it
          // snaps back to 0 immediately instead of waiting for timeupdate.
          setTimeout(() => {
            if (FeedState.audioBeatId) syncTransportControls(FeedState.audioBeatId);
          }, 30);
        } else {
          setBeatPlayingState(FeedState.audioBeatId, false);
          syncTransportControls(FeedState.audioBeatId);
        }
      }
    });
  }
}

// ── Play count AJAX ────────────────────────────────────────────────────────

async function pingPlay(beatId) {
  try {
    const data = await postJSON(`/api/beats/${beatId}/play`);
    // Only update the UI counter if the server actually counted this play (not deduplicated)
    if (data.counted) {
      const el = document.getElementById(`plays-count-${beatId}`);
      if (el) el.textContent = formatNum(data.play_count);
    }
  } catch (_) {}  // silently ignore network errors — play counts are not critical UX
}

// ── Like AJAX ──────────────────────────────────────────────────────────────

function initLikeButtons() {
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.feed-like-btn');
    if (!btn) return;
    if (!cfg.isAuthenticated) {
      window.location.href = '/login';
      return;
    }
    const beatId = Number(btn.dataset.beatId);
    try {
      const data = await postJSON(`/api/beats/${beatId}/like`);
      const icon = btn.querySelector('i');
      if (data.liked) {
        btn.classList.add('is-liked');
        if (icon) icon.className = 'bi bi-heart-fill';
      } else {
        btn.classList.remove('is-liked');
        if (icon) icon.className = 'bi bi-heart';
      }
      const countEl = document.getElementById(`likes-count-${beatId}`);
      if (countEl) countEl.textContent = formatNum(data.likes_count);
    } catch (err) {
      if (err.message.includes('401')) window.location.href = '/login';
    }
  });
}

// ── Follow AJAX ────────────────────────────────────────────────────────────

function initFollowButtons() {
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.feed-follow-btn');
    if (!btn) return;
    if (!cfg.isAuthenticated) {
      window.location.href = '/login';
      return;
    }
    const producerId = Number(btn.dataset.producerId);
    try {
      const data = await postJSON(`/api/producers/${producerId}/follow`);
      const icon = btn.querySelector('i');
      if (data.following) {
        btn.classList.add('is-following');
        if (icon) icon.className = 'bi bi-check-lg';
      } else {
        btn.classList.remove('is-following');
        if (icon) icon.className = 'bi bi-plus-lg';
      }
    } catch (err) {
      if (err.message.includes('401')) window.location.href = '/login';
    }
  });
}

// ── Comments drawer ────────────────────────────────────────────────────────

let activeDrawerBeatId = null;  // only one drawer open at a time
let replyingToId       = null;  // comment id being replied to; null = top-level post

function openDrawer(beatId) {
  if (activeDrawerBeatId != null && activeDrawerBeatId !== beatId) {
    closeDrawer(activeDrawerBeatId);  // close existing drawer before opening another
  }
  const drawer = document.getElementById(`drawer-${beatId}`);
  if (!drawer) return;
  drawer.classList.add('is-open');
  activeDrawerBeatId = beatId;
  loadComments(beatId);
}

function closeDrawer(beatId) {
  const drawer = document.getElementById(`drawer-${beatId}`);
  if (drawer) drawer.classList.remove('is-open');
  if (activeDrawerBeatId === beatId) activeDrawerBeatId = null;
  replyingToId = null;  // clear reply context when drawer closes
}

async function loadComments(beatId) {
  const list = document.getElementById(`drawer-list-${beatId}`);
  if (!list) return;
  list.innerHTML = '<div class="feed-drawer-loading"><i class="bi bi-arrow-repeat"></i> Loading…</div>';
  try {
    const r = await fetch(`/api/beats/${beatId}/comments?limit=30`);
    const data = await r.json();
    renderComments(data.comments || [], list, beatId);
    // Sync the comment count badge with the actual loaded count
    const countEl = document.getElementById(`comments-count-${beatId}`);
    if (countEl) countEl.textContent = formatNum(data.comments?.length || 0);
  } catch (_) {
    list.innerHTML = '<div class="feed-drawer-loading">Failed to load comments.</div>';
  }
}

function renderComments(comments, container, beatId) {
  if (!comments.length) {
    container.innerHTML = '<div class="feed-drawer-loading" style="color:var(--ts-text-muted)">No comments yet. Be first!</div>';
    return;
  }
  container.innerHTML = comments.map(c => renderCommentHTML(c, false)).join('');
  attachCommentEvents(container, beatId);
}

function renderCommentHTML(c, isReply) {
  const initial = escHtml((c.author_username || '?')[0].toUpperCase());
  // Use avatar image if available, otherwise show the initial letter
  const avatar  = c.author_avatar
    ? `<img src="${escHtml(c.author_avatar)}" alt="${escHtml(c.author_username)}" />`
    : initial;

  const replyTo = c.reply_to ? `<div class="feed-comment-reply-to">↩ @${escHtml(c.reply_to)}</div>` : '';

  // Recursively render replies as indented children (only one level deep in practice)
  const replies = (c.replies || []).map(r => `
    <div class="feed-comment-replies">${renderCommentHTML(r, true)}</div>
  `).join('');

  return `
    <div class="feed-comment-item" data-comment-id="${c.id}" data-beat-id="${c.beat_id || ''}">
      <div class="feed-comment-avatar">${avatar}</div>
      <div class="feed-comment-body">
        <div class="feed-comment-author">${escHtml(c.author_username)} <span style="font-weight:400;font-size:10px;color:var(--ts-text-muted)">${timeAgo(c.created_at)}</span></div>
        ${replyTo}
        <div class="feed-comment-text">${escHtml(c.body)}</div>
        <div class="feed-comment-actions">
          <button class="feed-comment-action-btn feed-comment-like-btn ${c.is_liked ? 'is-liked' : ''}"
                  data-comment-id="${c.id}">
            <i class="bi ${c.is_liked ? 'bi-heart-fill' : 'bi-heart'}"></i>
            <span class="comment-like-count">${c.likes_count > 0 ? formatNum(c.likes_count) : ''}</span>
          </button>
          <button class="feed-comment-action-btn feed-comment-dislike-btn ${c.is_disliked ? 'is-disliked' : ''}"
                  data-comment-id="${c.id}">
            <i class="bi ${c.is_disliked ? 'bi-hand-thumbs-down-fill' : 'bi-hand-thumbs-down'}"></i>
            <span class="comment-dislike-count">${c.dislikes_count > 0 ? formatNum(c.dislikes_count) : ''}</span>
          </button>
          ${!isReply ? `<button class="feed-comment-action-btn feed-comment-reply-btn" data-comment-id="${c.id}" data-author="${escHtml(c.author_username)}">Reply</button>` : ''}
          <button class="feed-comment-action-btn feed-comment-report-btn" data-comment-id="${c.id}" title="Report comment">
            <i class="bi bi-flag"></i>
          </button>
          ${c.can_delete ? `<button class="feed-comment-action-btn feed-comment-delete" data-comment-id="${c.id}"><i class="bi bi-trash3"></i></button>` : ''}
        </div>
        ${replies}
      </div>
    </div>`;
}

function attachCommentEvents(container, beatId) {
  // Like comment
  container.querySelectorAll('.feed-comment-like-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!cfg.isAuthenticated) { window.location.href = '/login'; return; }
      const cid = Number(btn.dataset.commentId);
      try {
        const data = await postJSON(`/api/comments/${cid}/like`);
        btn.classList.toggle('is-liked', data.liked);
        const icon = btn.querySelector('i');
        if (icon) icon.className = data.liked ? 'bi bi-heart-fill' : 'bi bi-heart';
        const countEl = btn.querySelector('.comment-like-count');
        if (countEl) countEl.textContent = data.likes_count > 0 ? formatNum(data.likes_count) : '';
      } catch (_) {}
    });
  });

  // Dislike comment — mutually exclusive with like (server removes like if disliking)
  container.querySelectorAll('.feed-comment-dislike-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!cfg.isAuthenticated) { window.location.href = '/login'; return; }
      const cid = Number(btn.dataset.commentId);
      try {
        const data = await postJSON(`/api/comments/${cid}/dislike`);
        btn.classList.toggle('is-disliked', data.disliked);
        const icon = btn.querySelector('i');
        if (icon) icon.className = data.disliked ? 'bi bi-hand-thumbs-down-fill' : 'bi bi-hand-thumbs-down';
        const countEl = btn.querySelector('.comment-dislike-count');
        if (countEl) countEl.textContent = data.dislikes_count > 0 ? formatNum(data.dislikes_count) : '';
        // Update the like button too since the server may have removed the like
        const likeBtn = btn.closest('.feed-comment-actions')?.querySelector('.feed-comment-like-btn');
        if (likeBtn) {
          likeBtn.classList.toggle('is-liked', false);
          const likeIcon = likeBtn.querySelector('i');
          if (likeIcon) likeIcon.className = 'bi bi-heart';
          const likeCount = likeBtn.querySelector('.comment-like-count');
          if (likeCount) likeCount.textContent = data.likes_count > 0 ? formatNum(data.likes_count) : '';
        }
      } catch (_) {}
    });
  });

  // Report comment — sends reason 'inappropriate'; shows confirmation on success
  container.querySelectorAll('.feed-comment-report-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!cfg.isAuthenticated) { window.location.href = '/login'; return; }
      const cid = Number(btn.dataset.commentId);
      if (!confirm('Report this comment as inappropriate?')) return;
      try {
        await postJSON(`/api/comments/${cid}/report`, { reason: 'inappropriate' });
        btn.title = 'Reported';
        btn.querySelector('i').className = 'bi bi-flag-fill';
        btn.style.color = 'var(--ts-orange)';
        btn.disabled = true;
      } catch (err) {
        if (err.message.includes('409')) {
          btn.title = 'Already reported';
        }
      }
    });
  });

  // Reply: sets the global replyingToId and shows a banner in the drawer header
  container.querySelectorAll('.feed-comment-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      replyingToId = Number(btn.dataset.commentId);
      const author = btn.dataset.author || '';
      const replyBanner = document.querySelector(`#drawer-${beatId} .feed-drawer-replying-to`);
      if (replyBanner) {
        replyBanner.innerHTML = `Replying to <span>@${escHtml(author)}</span> <button class="feed-drawer-replying-cancel">✕</button>`;
        replyBanner.classList.add('is-active');
        replyBanner.querySelector('.feed-drawer-replying-cancel')?.addEventListener('click', () => {
          replyingToId = null;
          replyBanner.classList.remove('is-active');
        });
      }
      // Focus the input so the user can start typing immediately
      const input = document.querySelector(`#drawer-${beatId} .feed-drawer-input`);
      if (input) input.focus();
    });
  });

  // Delete — confirm before sending to avoid accidental deletions
  container.querySelectorAll('.feed-comment-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = Number(btn.dataset.commentId);
      if (!confirm('Delete this comment?')) return;
      try {
        await deleteJSON(`/api/comments/${cid}`);
        loadComments(beatId);  // reload to reflect deletion
      } catch (_) {}
    });
  });
}

function initCommentDrawers() {
  // Toggle drawer open/closed when the comment rail button is clicked
  document.addEventListener('click', e => {
    const btn = e.target.closest('.feed-comment-btn');
    if (!btn) return;
    const beatId = Number(btn.dataset.beatId);
    if (activeDrawerBeatId === beatId) {
      closeDrawer(beatId);
    } else {
      openDrawer(beatId);
    }
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('.feed-drawer-close');
    if (!btn) return;
    closeDrawer(Number(btn.dataset.beatId));
  });

  // Post comment via Send button click
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.feed-drawer-send');
    if (!btn) return;
    const beatId = Number(btn.dataset.beatId);
    const input  = document.querySelector(`#drawer-${beatId} .feed-drawer-input`);
    if (!input) return;
    const body = input.value.trim();
    if (!body) return;
    try {
      await postJSON(`/api/beats/${beatId}/comments`, {
        body,
        parent_id: replyingToId || null,  // null = top-level comment
      });
      input.value = '';
      replyingToId = null;
      const replyBanner = document.querySelector(`#drawer-${beatId} .feed-drawer-replying-to`);
      if (replyBanner) replyBanner.classList.remove('is-active');
      loadComments(beatId);
    } catch (err) {
      if (err.message.includes('401')) window.location.href = '/login';
    }
  });

  // Post comment via Enter key (Shift+Enter is ignored to allow multi-line pasting)
  document.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const input = e.target.closest('.feed-drawer-input');
    if (!input) return;
    const beatId = Number(input.dataset.beatId);
    const body = input.value.trim();
    if (!body) return;
    try {
      await postJSON(`/api/beats/${beatId}/comments`, {
        body,
        parent_id: replyingToId || null,
      });
      input.value = '';
      replyingToId = null;
      const replyBanner = document.querySelector(`#drawer-${beatId} .feed-drawer-replying-to`);
      if (replyBanner) replyBanner.classList.remove('is-active');
      loadComments(beatId);
    } catch (_) {}
  });
}

// ── Inject reply-to banner into each drawer ────────────────────────────────
function initReplyBanners() {
  // Insert a hidden banner element after each drawer header; activated when replying
  document.querySelectorAll('.feed-drawer').forEach(drawer => {
    const header = drawer.querySelector('.feed-drawer-header');
    if (!header) return;
    const banner = document.createElement('div');
    banner.className = 'feed-drawer-replying-to';
    header.after(banner);
  });
}

// ── Infinite scroll (load more beats via AJAX) ─────────────────────────────

function appendBeatCard(beat) {
  const scroll   = document.getElementById('feed-scroll');
  const sentinel = document.getElementById('feed-load-sentinel');
  if (!scroll || !sentinel) return;

  // Cycle through 8 background gradients based on current card count
  const bgIndex = scroll.querySelectorAll('.feed-card').length % 8;

  const card = document.createElement('div');
  card.className    = 'feed-card';
  card.id           = `feed-card-${beat.id}`;
  card.dataset.beatId = beat.id;
  card.dataset.beat   = JSON.stringify(beat);

  const isLiked     = beat.is_liked     ? 'is-liked'      : '';
  const likedIcon   = beat.is_liked     ? 'bi-heart-fill' : 'bi-heart';
  const followClass = beat.is_following ? 'is-following'  : '';
  const followIcon  = beat.is_following ? 'bi-check-lg'   : 'bi-plus-lg';
  const producerAvatar = beat.producer_avatar
    ? `<img src="${escHtml(beat.producer_avatar)}" alt="${escHtml(beat.producer_username || 'Producer')}" />`
    : escHtml((beat.producer_username || '?')[0].toUpperCase());

  // Build the 3-tier pricing panel HTML
  const leaseVal = beat.price === 0 ? 'FREE' : `$${Math.round(beat.price)}`;
  const isSolo   = !beat.premium_price && !beat.exclusive_price;
  let pricingPanel = `
    <div class="feed-pricing-panel">
      <div class="feed-pricing-tier${isSolo ? ' feed-pricing-tier-solo' : ''}">
        <span class="feed-pricing-label">Lease</span>
        <span class="feed-pricing-value">${leaseVal}</span>
      </div>
      ${beat.premium_price ? `
      <div class="feed-pricing-tier">
        <span class="feed-pricing-label">Premium</span>
        <span class="feed-pricing-value">$${Math.round(beat.premium_price)}</span>
      </div>` : ''}
      ${beat.exclusive_price ? `
      <div class="feed-pricing-tier feed-pricing-excl">
        <span class="feed-pricing-label">Exclusive</span>
        <span class="feed-pricing-value">$${Math.round(beat.exclusive_price)}</span>
      </div>` : ''}
    </div>
    <a href="/beats/${beat.id}" class="feed-ghost-btn">
      <i class="bi bi-info-circle"></i> Details &amp; Purchase
    </a>`;

  // Build identical DOM structure to the server-rendered feed.html cards
  card.innerHTML = `
    <div class="feed-bg feed-bg-${bgIndex}"></div>
    <div class="feed-vignette"></div>
    <div class="feed-waveform-shell"></div>
    <div class="feed-transport-dock" id="transport-${beat.id}" data-beat-id="${beat.id}">
      <div class="feed-transport-row">
        <button type="button" class="feed-transport-btn" data-action="restart" data-beat-id="${beat.id}" aria-label="Restart track"><i class="bi bi-arrow-counterclockwise"></i></button>
        <button type="button" class="feed-transport-btn feed-transport-skip" data-action="back15" data-beat-id="${beat.id}" aria-label="Back 15 seconds"><span class="feed-skip-label">−15</span></button>
        <button type="button" class="feed-transport-btn primary" data-action="play-toggle" data-beat-id="${beat.id}" aria-label="Play or pause"><i class="bi bi-play-fill"></i></button>
        <button type="button" class="feed-transport-btn feed-transport-skip" data-action="forward15" data-beat-id="${beat.id}" aria-label="Forward 15 seconds"><span class="feed-skip-label">+15</span></button>
      </div>
      <div class="feed-transport-sliders">
        <div class="feed-transport-slider-block">
          <div class="feed-transport-labels">
            <span id="feed-player-time-${beat.id}">0:00</span>
            <span id="feed-player-duration-${beat.id}">0:00</span>
          </div>
          <input type="range" class="feed-transport-seek" id="feed-player-seek-${beat.id}" data-beat-id="${beat.id}" min="0" max="100" value="0" step="0.1" />
        </div>
        <div class="feed-transport-slider-block">
          <div class="feed-transport-labels">
            <span><i class="bi bi-volume-down"></i> Volume</span>
            <span id="feed-player-volume-value-${beat.id}">50%</span>
          </div>
          <input type="range" class="feed-transport-volume" id="feed-player-volume-${beat.id}" data-beat-id="${beat.id}" min="0" max="100" value="50" step="1" />
        </div>
      </div>
    </div>
    <div class="feed-rail">
      <div class="feed-rail-avatar-wrap">
        <a href="/profile/${beat.producer_id}" class="feed-rail-avatar">
          ${producerAvatar}
        </a>
        <button class="feed-follow-btn ${followClass}" data-producer-id="${beat.producer_id}">
          <i class="bi ${followIcon}"></i>
        </button>
      </div>
      <div class="feed-rail-item">
        <button class="feed-rail-btn feed-like-btn ${isLiked}" data-beat-id="${beat.id}">
          <i class="bi ${likedIcon}"></i>
        </button>
        <span class="feed-rail-count" id="likes-count-${beat.id}">${formatNum(beat.likes_count)}</span>
      </div>
      <div class="feed-rail-item">
        <button class="feed-rail-btn feed-comment-btn" data-beat-id="${beat.id}">
          <i class="bi bi-chat-dots-fill"></i>
        </button>
        <span class="feed-rail-count" id="comments-count-${beat.id}">${formatNum(beat.comment_count)}</span>
      </div>
      <div class="feed-rail-item">
        <div class="feed-rail-btn feed-rail-plays"><i class="bi bi-play-circle-fill"></i></div>
        <span class="feed-rail-count" id="plays-count-${beat.id}">${formatNum(beat.play_count)}</span>
      </div>
    </div>
    <div class="feed-info">
      <a href="/profile/${beat.producer_id}" class="feed-producer-handle">
        @${escHtml(beat.producer_username || 'Unknown')}
      </a>
      <h2 class="feed-beat-title">${escHtml(beat.title)}</h2>
      <div class="feed-tags">
        ${beat.genre    ? `<span class="feed-tag">${escHtml(beat.genre)}</span>` : ''}
        ${beat.bpm      ? `<span class="feed-tag">${beat.bpm} BPM</span>` : ''}
        ${beat.key      ? `<span class="feed-tag">${escHtml(beat.key)}</span>` : ''}
        ${beat.mood_tag ? `<span class="feed-tag feed-tag-mood">${escHtml(beat.mood_tag)}</span>` : ''}
      </div>
      ${pricingPanel}
    </div>
    <div class="feed-drawer" id="drawer-${beat.id}" data-beat-id="${beat.id}">
      <div class="feed-drawer-header">
        <span class="feed-drawer-title">Comments</span>
        <button class="feed-drawer-close" data-beat-id="${beat.id}"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="feed-drawer-list" id="drawer-list-${beat.id}">
        <div class="feed-drawer-loading"><i class="bi bi-arrow-repeat"></i> Loading…</div>
      </div>
      <div class="feed-drawer-input-row">
        ${cfg.isAuthenticated
          ? `<input type="text" class="feed-drawer-input" placeholder="Add a comment…" data-beat-id="${beat.id}" maxlength="500" />
             <button class="feed-drawer-send" data-beat-id="${beat.id}"><i class="bi bi-send-fill"></i></button>`
          : `<a href="/login" class="feed-drawer-login-prompt"><i class="bi bi-person-circle"></i> Sign in to comment</a>`
        }
      </div>
    </div>`;

  // Insert before the sentinel so the observer element stays at the bottom
  scroll.insertBefore(card, sentinel);

  // Each dynamically added card needs its own IntersectionObserver instance
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) activateCard(Number(entry.target.dataset.beatId));
    });
  }, { threshold: 0.6 });
  obs.observe(card);

  // Add reply banner to the newly created drawer
  const header = card.querySelector('.feed-drawer-header');
  if (header) {
    const banner = document.createElement('div');
    banner.className = 'feed-drawer-replying-to';
    header.after(banner);
  }
}

function initInfiniteScroll() {
  const sentinel = document.getElementById('feed-load-sentinel');
  if (!sentinel) return;

  const loader = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting) return;
    if (!cfg.hasMore) return;  // server signalled no more pages

    cfg.hasMore = false;  // guard against double-fire while the request is in-flight

    try {
      const seen = (cfg.seenIds || []).join(',');
      const url  = `/api/feed?page=${cfg.nextPage}&seen=${seen}`;
      const r    = await fetch(url);
      const data = await r.json();

      (data.beats || []).forEach(beat => {
        appendBeatCard(beat);
        // Track IDs so subsequent page requests exclude already-rendered beats
        (cfg.seenIds = cfg.seenIds || []).push(beat.id);
      });

      cfg.hasMore  = data.has_next;
      cfg.nextPage = (data.page || 1) + 1;
    } catch (_) {}
  }, { threshold: 0.5 });

  loader.observe(sentinel);
}

// ── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const audio = getAudioEl();
  if (audio) audio.volume = 0.5;

  initIntersectionObserver();
  initPlayPauseButtons();
  initLikeButtons();
  initFollowButtons();
  initReplyBanners();
  initCommentDrawers();
  initInfiniteScroll();
});
