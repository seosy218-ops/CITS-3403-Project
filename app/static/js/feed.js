"use strict";

/* ============================================================
   TUNEFEED — Feed JavaScript
   Covers:
     - Waveform canvas visualiser
     - IntersectionObserver: auto-play/pause waveform per card
     - Play-count AJAX (with deduplication)
     - Like / Follow AJAX with animations
     - Comments drawer: load, post, reply, like
     - Infinite scroll: AJAX load next page
   ============================================================ */

// FEED_CONFIG is injected by the Jinja template at page load
const cfg = window.FEED_CONFIG || {};

// CSRF token required by Flask-WTF for all state-changing requests
const CSRF = cfg.csrfToken || document.querySelector('meta[name="csrf-token"]')?.content || '';

// ── Active card state ──────────────────────────────────────────────────────
const FeedState = {
  activeCardId: null,   // beat id of the card currently snapped into view
  waveAnims:    {},     // { beatId: requestAnimationFrameId } — live animation handles
  waveDatas:    {},     // { beatId: Float32Array } smoothed bar heights per card
  wavePeaks:    {},     // { beatId: Float32Array } peak-hold values per bar
  wavePeakAge:  {},     // { beatId: Float32Array } frames elapsed since each peak was set
  playStates:   {},     // { beatId: bool } — whether the waveform is currently animating
  playTimers:   {},
  audioBeatId: null,
  userPaused: false,
  audioActuallyPlaying: false,  // true only after audio.play() Promise resolves
  bpmOverrides: {},     // { beatId: number } — user-adjusted BPM per card
};

const AudioVizState = {
  context: null,
  source: null,
  analyser: null,
  freqData: null,
  timeData: null,
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

function formatBpm(bpm) {
  const n = Number(bpm);
  if (Number.isInteger(n)) return `${n} BPM`;
  // Strip trailing zeros after rounding to 2 decimal places
  return `${parseFloat(n.toFixed(2))} BPM`;
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
  FeedState.playStates[beatId] = playing;
  if (playing) {
    drawWaveform(beatId, true);
  } else {
    stopWaveform(beatId);
  }
  updateTransportPlayIcon(beatId, playing);
  syncTransportControls(beatId);
}

function loadAudioForBeat(beatId) {
  const audio = getAudioEl();
  const meta = getBeatMetaFromCard(beatId);
  if (!audio || !meta || !meta.audio_url) return false;

  if (FeedState.audioBeatId !== beatId) {
    // crossOrigin must be set BEFORE src so the browser sends the CORS request
    // header, enabling Web Audio API analysis via createMediaElementSource.
    audio.crossOrigin = 'anonymous';
    audio.src = meta.audio_url;
    audio.loop = true;   // infinite playback — track restarts automatically on end
    audio.load();
    audio.playbackRate = 1.0;  // reset rate for the incoming track
    FeedState.audioBeatId = beatId;
    // DO NOT reset AudioVizState.source — createMediaElementSource can only be
    // called once per element per AudioContext; the node follows src changes.
  } else {
    // Restore any BPM override the user set for this track on previous visit
    const override = FeedState.bpmOverrides[beatId];
    if (override) {
      const origBpm = meta.bpm || 120;
      audio.playbackRate = override / origBpm;
    }
  }
  return true;
}

function playBeatAudio(beatId) {
  if (!loadAudioForBeat(beatId)) return;
  const audio = getAudioEl();
  if (!audio) return;

  // If the shared player was muted, restore audible output for explicit play actions.
  if (audio.volume === 0) audio.volume = 1;

  setBeatPlayingState(beatId, true);

  audio.play().then(() => {
    FeedState.userPaused = false;
    FeedState.audioActuallyPlaying = true;
    // Wire up the Web Audio analyser now that we have a confirmed user gesture
    // and playback is running — avoids SecurityError from CORS-tainted elements
    // and ensures AudioContext is resumed after the gesture unlocks it.
    const viz = ensureAudioVisualizer();
    if (viz && viz.context && viz.context.state === 'suspended') {
      viz.context.resume();
    }
  }).catch((err) => {
    FeedState.audioActuallyPlaying = false;
    // Audio blocked (autoplay policy) — keep the waveform animating; just
    // reset the play-button icon so the user knows they need to tap Play.
    updateTransportPlayIcon(beatId, false);
    // NotAllowedError means we need a user gesture — show the tap hint
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

function adjustBeatBPM(beatId, delta) {
  const meta = getBeatMetaFromCard(beatId);
  const origBpm = meta ? (meta.bpm || 120) : 120;
  const current = FeedState.bpmOverrides[beatId] ?? origBpm;
  const next    = Math.max(60, Math.min(220, current + delta));
  FeedState.bpmOverrides[beatId] = next;

  // Change audio playback rate proportionally so pitch and speed shift together
  const audio = getAudioEl();
  if (audio && FeedState.audioBeatId === beatId) {
    audio.playbackRate = next / origBpm;
  }

  const label = document.getElementById(`feed-bpm-label-${beatId}`);
  if (label) {
    if (label.tagName === 'INPUT') {
      label.value = parseFloat(next.toFixed(2));
    } else {
      label.textContent = formatBpm(next);
    }
  }
}

function closeBpmControls(exceptBeatId = null) {
  // Keep the dock predictable by leaving only one BPM pill expanded at a time.
  document.querySelectorAll('.feed-bpm-control.is-open').forEach((control) => {
    const controlBeatId = Number(control.dataset.beatId);
    if (exceptBeatId !== null && controlBeatId === exceptBeatId) return;
    control.classList.remove('is-open');
  });
}

function toggleBpmControl(beatId) {
  // Toggle this card's BPM pill while preserving a single active open state.
  const control = document.querySelector(`.feed-bpm-control[data-beat-id="${beatId}"]`);
  if (!control) return;
  const willOpen = !control.classList.contains('is-open');
  closeBpmControls(willOpen ? beatId : null);
  control.classList.toggle('is-open', willOpen);
}

function ensureAudioVisualizer() {
  const audio = getAudioEl();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!audio || !AudioContextClass) return null;

  if (!AudioVizState.context) {
    AudioVizState.context = new AudioContextClass();
  }

  if (!AudioVizState.analyser) {
    AudioVizState.analyser = AudioVizState.context.createAnalyser();
    AudioVizState.analyser.fftSize               = 2048;
    AudioVizState.analyser.smoothingTimeConstant = 0.85;  // high = silky smooth frequency curves
    AudioVizState.analyser.minDecibels           = -85;
    AudioVizState.analyser.maxDecibels           = -15;
    AudioVizState.freqData = new Uint8Array(AudioVizState.analyser.frequencyBinCount);
    AudioVizState.timeData = new Uint8Array(AudioVizState.analyser.fftSize);
  }

  if (!AudioVizState.source) {
    try {
      AudioVizState.source = AudioVizState.context.createMediaElementSource(audio);
      AudioVizState.source.connect(AudioVizState.analyser);
      AudioVizState.analyser.connect(AudioVizState.context.destination);
    } catch (_) {
      return null;
    }
  }

  return AudioVizState;
}

// ── Tap-to-play hint ──────────────────────────────────────────────────────
// Shown over the waveform when the browser blocks autoplay.
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
  if (seekEl && document.activeElement !== seekEl) {
    seekEl.value = String(progress);
    seekEl.style.setProperty('--range-pct', String(progress));
  }
  if (volumeEl && document.activeElement !== volumeEl) {
    volumeEl.value = String(volume);
    volumeEl.style.setProperty('--range-pct', String(volume));
  }
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
    if (action !== 'bpm-toggle') return;
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
    case 'bpm-up':
      adjustBeatBPM(beatId, 5);
      break;
    case 'bpm-down':
      adjustBeatBPM(beatId, -5);
      break;
    case 'bpm-toggle':
      toggleBpmControl(beatId);
      break;
    case 'play-toggle':
    default:
      // Unrecognised action strings fall through to play/pause so any transport
      // button without an explicit handler still has a predictable default.
      FeedState.userPaused = false;
      if (!audio.paused) {
        pauseBeatAudio(beatId);
      } else {
        playBeatAudio(beatId);
      }
      break;
  }
}

// ── Waveform visualiser ────────────────────────────────────────────────────
// Architecture:
//   • Bar-mode helper uses 64 bins (see `getWaveBars`).
//   • Main renderer uses a 120-point symmetric bezier envelope (`drawWaveform`).
//   • Real FFT path uses logarithmic frequency mapping from `getByteFrequencyData()`.
//     Values are 0-255 with analyser range controlled by min/maxDecibels.
//   • Fallback simulation path synthesizes kick/snare/hat energy from BPM timing.
//   • Render stack: bloom fill, gradient body, and glowing top/bottom edge strokes.

const WAVE_BAR_COUNT = 64;

// Deterministic per-beat "personality" so every beat looks visually distinct
// even when two beats share the same BPM. Derived from beatId via a simple
// integer hash — stable across frames and page reloads.
function getBeatPersonality(beatId) {
  const id = Number(beatId) || 1;
  // Cheap integer hash (Bob Jenkins mix)
  let h = (id ^ (id >>> 16)) * 0x45d9f3b;
  h = (h ^ (h >>> 16)) * 0x45d9f3b;
  h = h ^ (h >>> 16);
  const frac = (n) => ((n >>> 0) & 0xffff) / 0xffff; // 0–1
  return {
    // Phase offsets shift WHERE in the cycle each region peaks, making patterns
    // start and evolve differently per beat.
    bassPhaseOffset:   frac(h)         * Math.PI * 2,
    lowMidPhaseOffset: frac(h * 1597)  * Math.PI * 2,
    midPhaseOffset:    frac(h * 6271)  * Math.PI * 2,
    // Energy weights (0.6–1.4) scale how dominant each region is, giving each
    // beat a unique spectral "character" — some are bass-heavy, some mid-forward.
    bassWeight:   0.6 + frac(h * 2053)  * 0.8,
    lowMidWeight: 0.6 + frac(h * 3581)  * 0.8,
    midWeight:    0.6 + frac(h * 7919)  * 0.8,
    trebleWeight: 0.6 + frac(h * 11743) * 0.8,
    // Phrase arc speed and offset — slow modulation unique per beat
    phraseSpeed:  0.012 + frac(h * 4999) * 0.012,
    phraseOffset: frac(h * 8191) * Math.PI * 2,
  };
}

// Cache personalities so they are not recomputed every frame
const _beatPersonalities = {};
function getPersonality(beatId) {
  if (!_beatPersonalities[beatId]) _beatPersonalities[beatId] = getBeatPersonality(beatId);
  return _beatPersonalities[beatId];
}

function getWaveBars(beatId, playing, barCount, t) {
  if (!FeedState.waveDatas[beatId]) {
    FeedState.waveDatas[beatId] = new Float32Array(barCount).fill(0.03);
  }
  const bars = FeedState.waveDatas[beatId];

  // ── Idle / paused state — completely flat, no animation ───────────────────
  if (!playing) {
    for (let i = 0; i < barCount; i++) {
      bars[i] = bars[i] * 0.82 + 0.03 * 0.18;   // decay smoothly to near-zero
    }
    return Array.from(bars);
  }

  // ── Real FFT path ─────────────────────────────────────────────────────────
  // Bass energy (20–200 Hz) drives a global gain multiplier so kick hits surge
  // the whole wave dramatically. Soft vocals with no kick stay nearly flat.
  // Super-linear shape curve (1.4) expands dynamic range: quiet bins near-zero,
  // loud bins full height — preventing the uniform-blob effect.
  const viz = AudioVizState;
  if (viz.analyser && viz.freqData) {
    viz.analyser.getByteFrequencyData(viz.freqData);
    const raw = viz.freqData;
    if (raw.some(v => v > 0)) {
      const binCount = raw.length;
      const nyquist  = (viz.context?.sampleRate ?? 44100) / 2;

      // Bass energy: average of bins from ~20 Hz to ~200 Hz
      const bassEndBin = Math.max(2, Math.floor(200 / nyquist * binCount));
      let bassSum = 0;
      for (let j = 1; j <= bassEndBin; j++) bassSum += raw[j];
      const bassLevel = bassSum / (bassEndBin * 255);

      // Global gain: silence ≈ 0.15 (flat), strong kick ≈ 2.2 (tall spike)
      const globalGain = 0.15 + Math.pow(Math.max(0, bassLevel), 0.60) * 2.0;

      const logMin   = Math.log2(30);
      const logMax   = Math.log2(18000);
      const logRange = logMax - logMin;

      for (let i = 0; i < barCount; i++) {
        const freqLo = Math.pow(2, logMin + (i / barCount)       * logRange);
        const freqHi = Math.pow(2, logMin + ((i + 1) / barCount) * logRange);
        const lo = Math.max(0, Math.min(Math.floor(freqLo / nyquist * binCount), binCount - 1));
        const hi = Math.max(lo + 1, Math.min(Math.ceil(freqHi  / nyquist * binCount), binCount));
        let peak = 0;
        for (let j = lo; j < hi; j++) peak = Math.max(peak, raw[j]);

        // Super-linear: quiet bins → near-zero shape, loud bins → full height
        const shape = Math.pow(peak / 255, 1.4);
        const norm  = Math.min(1, shape * globalGain);

        // Fast attack catches transients; slow decay keeps spikes visible
        const atk = norm > bars[i] ? 0.50 : 0.07;
        bars[i]   = bars[i] * (1 - atk) + norm * atk;
      }
      return Array.from(bars);
    }
  }

  // ── BPM simulation path ────────────────────────────────────────────────────
  // kickBoost mirrors the real-audio bassGain: between beats the wave is quiet,
  // on the kick it surges the same way the real bass gain would.
  const bpm      = FeedState.bpmOverrides[beatId] ?? (getBeatMetaFromCard(beatId)?.bpm || 120);
  const bpmPhase = (t * bpm * Math.PI) / 30;
  const p        = getPersonality(beatId);

  const kick   = Math.pow(Math.max(0, Math.sin(bpmPhase)),           8);
  const snare  = Math.pow(Math.max(0, Math.sin(bpmPhase - Math.PI)), 6);
  const hihat  = Math.pow(Math.abs(Math.sin(bpmPhase)),              2) * 0.45;
  const hat16  = Math.pow(Math.abs(Math.sin(bpmPhase * 2)),          2) * 0.22;
  const phrase = Math.abs(Math.sin(t * p.phraseSpeed + p.phraseOffset)) * 0.30;

  // Between beats = 0.18× (near-flat), on kick = up to 1.68× (big surge)
  const kickBoost = 0.18 + kick * 1.5;

  for (let i = 0; i < barCount; i++) {
    const norm = i / (barCount - 1);
    const pink = 1 - norm * 0.45;

    const sub = norm < 0.15
      ? kick * 1.0 * Math.pow(1 - norm / 0.15, 0.5) : 0;

    const bassEnv = Math.exp(-Math.pow((norm - 0.18) * 4.2, 2));
    const bass    = (kick * 0.65 + Math.abs(Math.sin(bpmPhase * 0.5 + p.bassPhaseOffset)) * 0.45)
                    * bassEnv * p.bassWeight;

    const lmEnv  = Math.exp(-Math.pow((norm - 0.34) * 3.5, 2));
    const lowMid = Math.abs(Math.sin(bpmPhase * 0.25 + i * 0.65 + p.lowMidPhaseOffset))
                   * 0.55 * lmEnv * p.lowMidWeight;

    const mEnv = Math.exp(-Math.pow((norm - 0.52) * 2.8, 2));
    const mid  = (Math.abs(Math.sin(bpmPhase * 0.5 + i * 0.55 + p.midPhaseOffset)) * 0.50
                  + phrase * 0.22) * mEnv * p.midWeight;

    const hmEnv = Math.exp(-Math.pow((norm - 0.66) * 4.5, 2));
    const hiMid = snare * 0.55 * hmEnv;

    const treble = norm > 0.72
      ? (hihat + hat16) * 0.40 * p.trebleWeight * Math.pow((norm - 0.72) / 0.28, 0.45) : 0;

    const shaped = (sub + bass + lowMid + mid + hiMid + treble) * pink;
    const target = Math.min(0.98, Math.max(0.02, shaped * kickBoost));

    const atk  = target > bars[i] ? 0.52 : 0.08;
    bars[i]    = bars[i] * (1 - atk) + target * atk;
  }

  return Array.from(bars);
}

// Simulation wave: multi-harmonic time-domain signal that swells on BPM kick.
// Returns an array of NUM_PTS amplitude values in -1..+1.
function simWave(t, kickPow, numPts) {
  const swell = 0.10 + kickPow * 0.90;
  const amps  = new Array(numPts);
  for (let p = 0; p < numPts; p++) {
    const x   = p / (numPts - 1);
    const env = Math.sin(x * Math.PI);  // taper to 0 at both edges
    const v   = Math.sin(x * Math.PI *  8 + t *  6.0) * 0.50
              + Math.sin(x * Math.PI * 16 + t *  9.5) * 0.25
              + Math.sin(x * Math.PI * 30 + t * 15.0) * 0.15
              + Math.sin(x * Math.PI * 52 + t * 22.0) * 0.07
              + Math.sin(x * Math.PI * 84 + t * 33.0) * 0.03;
    amps[p] = v * env * swell;
  }
  return amps;
}

function drawWaveform(beatId, playing) {
  const canvas = document.getElementById(`waveform-${beatId}`);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const bpm = getBeatMetaFromCard(beatId)?.bpm || 120;

  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;

  // Fewer points = longer bezier segments = inherently smoother curves
  const NUM_PTS    = 120;
  let t            = 0;
  let smoothedBass = 0;
  let smoothedRms  = 0;

  // Inter-frame blend buffer: persists across rAF ticks, eliminates residual jitter
  const prevAmps = new Float32Array(NUM_PTS).fill(0);

  function frame() {
    const w = canvas.width  / dpr;
    const h = canvas.height / dpr;
    if (w < 1 || h < 1) { FeedState.waveAnims[beatId] = requestAnimationFrame(frame); return; }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cy        = h * 0.5;
    const activeBpm = FeedState.bpmOverrides[beatId] ?? bpm;
    const bpmRad    = (t * activeBpm * Math.PI) / 30;
    const kickPow   = Math.pow(Math.max(0, Math.sin(bpmRad)), 8);

    // ── Build amplitude array (all values 0..1, unsigned) ────────────────────
    // Using frequency domain exclusively — getByteFrequencyData() has built-in
    // temporal smoothing (smoothingTimeConstant=0.85), so it never jitters.
    // getByteTimeDomainData() shows raw PCM phase which rotates each frame →
    // the shape changes randomly every tick → that IS the jitter.

    const viz = AudioVizState;

    if (!playing) {
      // Paused: decay existing amps to zero over ~15 frames
      for (let p = 0; p < NUM_PTS; p++) prevAmps[p] *= 0.80;

    } else if (viz.analyser && viz.freqData) {
      // ── Analyser connected: use frequency data ──────────────────────────────
      viz.analyser.getByteFrequencyData(viz.freqData);
      const freq     = viz.freqData;
      const binCount = freq.length;
      const nyquist  = (viz.context?.sampleRate ?? 44100) / 2;

      // Silence guard: if max bin < 10/255 (~4%), the track is silent.
      // Never fall back to simulation — the analyser IS connected; just show flat.
      let maxBin = 0;
      for (let k = 0; k < binCount; k++) { if (freq[k] > maxBin) maxBin = freq[k]; }

      if (maxBin > 10) {
        // Bass energy: average over ~0–220 Hz
        const bassEndBin = Math.max(2, Math.floor(220 / nyquist * binCount));
        let bSum = 0;
        for (let k = 1; k <= bassEndBin; k++) bSum += freq[k];
        const instBass = bSum / (bassEndBin * 255);
        const bAtk     = instBass > smoothedBass ? 0.45 : 0.10;
        smoothedBass   = smoothedBass * (1 - bAtk) + instBass * bAtk;

        // Log-scale frequency → display-point mapping (matches human ear perception).
        // Low freqs at left, high freqs at right; bass region is visually wide.
        const logMin   = Math.log2(40);
        const logMax   = Math.log2(14000);
        const logRange = logMax - logMin;
        const rawAmps  = new Float32Array(NUM_PTS);

        for (let p = 0; p < NUM_PTS; p++) {
          const fLo = Math.pow(2, logMin + (p       / NUM_PTS) * logRange);
          const fHi = Math.pow(2, logMin + ((p + 1) / NUM_PTS) * logRange);
          const lo  = Math.max(0, Math.floor(fLo / nyquist * binCount));
          const hi  = Math.min(Math.ceil(fHi / nyquist * binCount), binCount);
          let peak  = 0;
          for (let k = lo; k < hi; k++) { if (freq[k] > peak) peak = freq[k]; }
          // Mild power-law expansion: quiet bins near-zero, loud bins tall
          rawAmps[p] = Math.pow(peak / 255, 1.15);
        }

        // 5-tap Gaussian spatial smooth (two passes) — removes any remaining bin-edge
        // artifacts and produces silky, continuous curves
        const G = [0.06, 0.24, 0.40, 0.24, 0.06];
        for (let pass = 0; pass < 2; pass++) {
          const tmp = rawAmps.slice();
          for (let p = 2; p < NUM_PTS - 2; p++) {
            rawAmps[p] = tmp[p-2]*G[0] + tmp[p-1]*G[1] + tmp[p]*G[2] + tmp[p+1]*G[3] + tmp[p+2]*G[4];
          }
        }

        // Sine taper: fade in from left edge, fade out at right edge
        for (let p = 0; p < NUM_PTS; p++) {
          rawAmps[p] *= Math.sin((p / (NUM_PTS - 1)) * Math.PI);
        }

        // Global amplitude boost driven by bass energy:
        // kick drum → smoothedBass surges → whole wave amplified up to ~3.8×
        const boost = 1.0 + smoothedBass * 2.8;

        // Inter-frame temporal blend: new frame contributes 45%, previous 55%.
        // This is an additional safety net on top of the analyser's own smoothing,
        // ensuring no frame-to-frame jumps even if the browser throttles rAF.
        for (let p = 0; p < NUM_PTS; p++) {
          // Cap at 1.0: at 100 % volume prevAmps reaches 1.0 and the wave peak
          // lands exactly EDGE_PADDING pixels from the canvas boundary (see below).
          const target = Math.min(1.0, rawAmps[p] * boost);
          prevAmps[p]  = prevAmps[p] * 0.55 + target * 0.45;
        }

        // RMS of final display amps → controls fill body opacity
        let rmsSum = 0;
        for (let p = 0; p < NUM_PTS; p++) rmsSum += prevAmps[p] * prevAmps[p];
        const instRms = Math.sqrt(rmsSum / NUM_PTS);
        smoothedRms   = smoothedRms * 0.88 + instRms * 0.12;

      } else {
        // Analyser connected but track is genuinely silent right now.
        // Decay cleanly to flat — never run simulation here.
        for (let p = 0; p < NUM_PTS; p++) prevAmps[p] *= 0.88;
        smoothedBass *= 0.90;
        smoothedRms  *= 0.90;
      }

    } else {
      // No analyser yet (AudioContext not yet created / first-frame race).
      // Only animate if the audio element is confirmed playing.
      const audio = getAudioEl();
      if (audio && !audio.paused) {
        const aAtk   = kickPow > smoothedBass ? 0.55 : 0.08;
        smoothedBass = smoothedBass * (1 - aAtk) + kickPow * aAtk;
        smoothedRms  = 0.20 + kickPow * 0.45;
        const simAmps = simWave(t, kickPow, NUM_PTS);
        for (let p = 0; p < NUM_PTS; p++) {
          // Rectify sim output (–1..+1) → 0..1 so it uses the same unsigned shape
          prevAmps[p] = prevAmps[p] * 0.60 + Math.abs(simAmps[p]) * 0.40;
        }
      } else {
        // Audio not playing and no analyser: stay flat
        for (let p = 0; p < NUM_PTS; p++) prevAmps[p] *= 0.80;
      }
    }

    // ── Build geometry (unsigned amps → wave always extends outward from cy) ──
    // EDGE_PADDING: the wave peak sits this many logical pixels inside the canvas
    // boundary at amplitude 1.0, so the glow can touch the border without the
    // filled shape overflowing it.  Canvas clips the shadow automatically.
    const EDGE_PADDING = 4;
    const topPts = new Array(NUM_PTS);
    for (let p = 0; p < NUM_PTS; p++) {
      topPts[p] = { x: (p / (NUM_PTS - 1)) * w, y: cy - prevAmps[p] * (cy - EDGE_PADDING) };
    }
    const botPts = topPts.map(pt => ({ x: pt.x, y: 2 * cy - pt.y }));

    // ── Bezier helpers ────────────────────────────────────────────────────────
    function bezierThrough(pts) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let p = 0; p < pts.length - 1; p++) {
        const mx = (pts[p].x + pts[p + 1].x) / 2;
        const my = (pts[p].y + pts[p + 1].y) / 2;
        ctx.quadraticCurveTo(pts[p].x, pts[p].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }

    function closedShape() {
      ctx.beginPath();
      bezierThrough(topPts);
      for (let p = topPts.length - 1; p > 0; p--) {
        const mx = (botPts[p].x + botPts[p - 1].x) / 2;
        const my = (botPts[p].y + botPts[p - 1].y) / 2;
        ctx.quadraticCurveTo(botPts[p].x, botPts[p].y, mx, my);
      }
      ctx.lineTo(topPts[0].x, botPts[0].y);
      ctx.closePath();
    }

    // ── Render ────────────────────────────────────────────────────────────────
    const peakAmp = Math.max(...prevAmps);

    if (peakAmp < 0.005) {
      // Essentially silent / fully decayed: show only the thin centerline
      ctx.save();
      ctx.shadowColor = '#d97706';
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = 'rgba(217, 119, 6, 0.38)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();
      ctx.restore();
    } else {
      // ── Layer 1: wide bloom glow ────────────────────────────────────────────
      ctx.save();
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur  = 10 + smoothedBass * 28;
      closedShape();
      ctx.fillStyle = `rgba(245, 158, 11, ${0.03 + smoothedBass * 0.07})`;
      ctx.fill();
      ctx.restore();

      // ── Layer 2: filled body — vertical orange ↔ teal gradient ─────────────
      closedShape();
      const bAlpha = 0.22 + smoothedRms * 0.18;
      const vGrad  = ctx.createLinearGradient(0, 0, 0, h);
      vGrad.addColorStop(0,    `rgba(  0, 212, 170, ${bAlpha * 0.50})`);
      vGrad.addColorStop(0.30, `rgba(245, 158,  11, ${bAlpha * 0.95})`);
      vGrad.addColorStop(0.50, `rgba(217, 119,   6, ${bAlpha * 1.10})`);
      vGrad.addColorStop(0.70, `rgba(245, 158,  11, ${bAlpha * 0.95})`);
      vGrad.addColorStop(1,    `rgba(  0, 212, 170, ${bAlpha * 0.50})`);
      ctx.fillStyle = vGrad;
      ctx.fill();

      // ── Layer 3: bright glowing edge strokes ────────────────────────────────
      const edgeA = 0.45 + smoothedBass * 0.55;
      ctx.save();
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur  = 3 + smoothedBass * 11;
      ctx.strokeStyle = `rgba(255, 210, 90, ${edgeA})`;
      ctx.lineWidth   = 1.5;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath(); bezierThrough(topPts); ctx.stroke();
      ctx.beginPath(); bezierThrough(botPts); ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
    t += 0.055;

    if (playing) {
      FeedState.waveAnims[beatId] = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(FeedState.waveAnims[beatId]);
      delete FeedState.waveAnims[beatId];
    }
  }

  if (FeedState.waveAnims[beatId]) cancelAnimationFrame(FeedState.waveAnims[beatId]);
  frame();
}

function stopWaveform(beatId) {
  if (FeedState.waveAnims[beatId]) {
    cancelAnimationFrame(FeedState.waveAnims[beatId]);
    delete FeedState.waveAnims[beatId];
  }
  // Draw one final static frame so the waveform doesn't disappear when paused
  drawWaveform(beatId, false);
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

  // Auto-play audio when a card becomes active unless the user explicitly paused.
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

  const bpmControl = card?.querySelector('.feed-bpm-control');
  if (bpmControl) bpmControl.classList.remove('is-open');
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

// ── BPM direct edit ────────────────────────────────────────────────────────
// Clicking the BPM display replaces it with a number input so the user can
// type a precise value (supports two decimal places, e.g. 155.31).
// Pressing Enter or blurring commits; Escape cancels without change.

function startBpmEdit(beatId) {
  const label = document.getElementById(`feed-bpm-label-${beatId}`);
  if (!label || label.tagName === 'INPUT') return;

  const meta = getBeatMetaFromCard(beatId);
  const origBpm = meta ? (meta.bpm || 120) : 120;
  const currentBpm = FeedState.bpmOverrides[beatId] ?? origBpm;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '60';
  input.max = '220';
  input.step = '0.01';
  input.value = parseFloat(currentBpm.toFixed(2));
  input.className = 'feed-bpm-edit-input';
  input.id = `feed-bpm-label-${beatId}`;
  input.dataset.beatId = String(beatId);
  input.setAttribute('aria-label', 'Edit BPM');

  label.replaceWith(input);
  input.focus();
  input.select();

  function restoreLabel(value) {
    const newLabel = document.createElement('span');
    newLabel.className = 'feed-bpm-display';
    newLabel.id = `feed-bpm-label-${beatId}`;
    newLabel.title = 'Click to edit BPM';
    newLabel.textContent = formatBpm(value);
    input.replaceWith(newLabel);
  }

  function applyEdit() {
    const val = parseFloat(input.value);
    const next = isNaN(val) ? currentBpm : Math.max(60, Math.min(220, val));
    FeedState.bpmOverrides[beatId] = next;
    const audio = getAudioEl();
    if (audio && FeedState.audioBeatId === beatId) {
      audio.playbackRate = next / origBpm;
    }
    restoreLabel(next);
  }

  function cancelEdit() {
    input.removeEventListener('blur', applyEdit);
    restoreLabel(currentBpm);
  }

  input.addEventListener('blur', applyEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
    e.stopPropagation(); // prevent transport handlers from intercepting keystrokes
  });
}

function initBpmEdit() {
  document.addEventListener('click', (e) => {
    const display = e.target.closest('.feed-bpm-display');
    if (!display) return;
    e.stopPropagation();
    const group = display.closest('.feed-bpm-btn-group');
    if (!group) return;
    const beatId = Number(group.dataset.beatId);
    if (!beatId) return;
    startBpmEdit(beatId);
  });
}

// ── Play/Pause toggle ──────────────────────────────────────────────────────

function initPlayPauseButtons() {
  // Clicking any transport or BPM control button
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.feed-transport-btn, .feed-bpm-adj, .feed-bpm-toggle-btn');
    if (!btn) return;
    const beatId = Number(btn.dataset.beatId);
    const action = btn.dataset.action;
    if (!beatId || !action) return;
    handleTransportAction(beatId, action);
  });

  // Clicking outside the BPM control closes any expanded BPM panel.
  document.addEventListener('click', (event) => {
    if (event.target.closest('.feed-bpm-control')) return;
    closeBpmControls();
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
      seek.style.setProperty('--range-pct', seek.value);
      syncTransportControls(beatId);
      return;
    }

    if (volume) {
      const beatId = Number(volume.dataset.beatId);
      if (!beatId) return;
      audio.volume = Number(volume.value) / 100;
      volume.style.setProperty('--range-pct', volume.value);
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
  const avatar  = c.author_avatar
    ? `<img src="${escHtml(c.author_avatar)}" alt="${escHtml(c.author_username)}" />`
    : initial;

  const replyTo = c.reply_to ? `<div class="feed-comment-reply-to">↩ @${escHtml(c.reply_to)}</div>` : '';

  const replies = (c.replies || []).map(r => `
    <div class="feed-comment-replies">${renderCommentHTML(r, true)}</div>
  `).join('');

  // Disliked comments start visually hidden — show-anyway reveals without undisliking
  const dislikedClass = c.is_disliked ? 'is-user-disliked' : '';

  // Report button: filled flag if already reported, outline if not
  const reportedClass = c.is_reported ? 'is-reported' : '';
  const reportIcon    = c.is_reported ? 'bi-flag-fill' : 'bi-flag';
  const reportTitle   = c.is_reported ? 'Reported (tap to undo)' : 'Report comment';

  return `
    <div class="feed-comment-item ${dislikedClass}" data-comment-id="${c.id}" data-beat-id="${c.beat_id || ''}">
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
          <button class="feed-comment-action-btn feed-comment-report-btn ${reportedClass}"
                  data-comment-id="${c.id}" title="${reportTitle}">
            <i class="bi ${reportIcon}"></i>
          </button>
          ${c.can_delete ? `<button class="feed-comment-action-btn feed-comment-delete" data-comment-id="${c.id}"><i class="bi bi-trash3"></i></button>` : ''}
        </div>
        <div class="feed-comment-dislike-hint">
          <span>Comment hidden</span>
          <button class="feed-comment-show-btn" data-comment-id="${c.id}">Show anyway</button>
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

  // Dislike comment — hides the comment visually; re-clicking undoes dislike and shows it
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
        // Toggle the visual hide: disliked = hidden, undisliked = visible again
        const commentItem = btn.closest('.feed-comment-item');
        if (commentItem) commentItem.classList.toggle('is-user-disliked', data.disliked);
      } catch (_) {}
    });
  });

  // Show-anyway: reveals a hidden (disliked) comment without undisliking
  container.querySelectorAll('.feed-comment-show-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.feed-comment-item');
      if (item) item.classList.remove('is-user-disliked');
    });
  });

  // Report comment — opens the styled modal instead of a browser confirm
  container.querySelectorAll('.feed-comment-report-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!cfg.isAuthenticated) { window.location.href = '/login'; return; }
      openReportModal(Number(btn.dataset.commentId), btn);
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

// ── Report modal ───────────────────────────────────────────────────────────
// One shared modal manages all comment reports. The current comment id and
// triggering button are stored at module level so modal actions can update them.

let _reportCommentId = null;
let _reportTriggerBtn = null;

function openReportModal(commentId, triggerBtn) {
  _reportCommentId  = commentId;
  _reportTriggerBtn = triggerBtn;

  const modal = document.getElementById('report-modal');
  const bodySelect = document.getElementById('report-modal-body-select');
  const bodyDone   = document.getElementById('report-modal-body-done');
  if (!modal) return;

  // Decide which view to show based on whether already reported
  const alreadyReported = triggerBtn && triggerBtn.classList.contains('is-reported');
  if (bodySelect) bodySelect.style.display = alreadyReported ? 'none' : '';
  if (bodyDone)   bodyDone.style.display   = alreadyReported ? '' : 'none';

  modal.classList.add('is-open');
  modal.removeAttribute('aria-hidden');
}

function closeReportModal() {
  const modal = document.getElementById('report-modal');
  if (modal) { modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); }
  _reportCommentId  = null;
  _reportTriggerBtn = null;
}

function initReportModal() {
  const modal       = document.getElementById('report-modal');
  const bodySelect  = document.getElementById('report-modal-body-select');
  const bodyDone    = document.getElementById('report-modal-body-done');
  const closeBtn    = document.getElementById('report-modal-close');
  const cancelBtn   = document.getElementById('report-modal-cancel');
  const unreportBtn = document.getElementById('report-unreport-btn');

  if (!modal) return;

  // Close on X or Cancel
  [closeBtn, cancelBtn].forEach(el => {
    if (el) el.addEventListener('click', closeReportModal);
  });

  // Close on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) closeReportModal();
  });

  // Reason buttons — each submits the report with the matching reason string
  modal.querySelectorAll('.report-reason-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!_reportCommentId) return;
      const reason = btn.dataset.reason || 'inappropriate';
      try {
        await postJSON(`/api/comments/${_reportCommentId}/report`, { reason });
        // Update the triggering flag button to reported state
        if (_reportTriggerBtn) {
          _reportTriggerBtn.classList.add('is-reported');
          const icon = _reportTriggerBtn.querySelector('i');
          if (icon) icon.className = 'bi bi-flag-fill';
          _reportTriggerBtn.title = 'Reported (tap to undo)';
        }
        // Switch to confirmation view without closing the modal
        if (bodySelect) bodySelect.style.display = 'none';
        if (bodyDone)   bodyDone.style.display   = '';
      } catch (err) {
        if (err.message && err.message.includes('409')) {
          // Already reported — jump straight to done view
          if (_reportTriggerBtn) _reportTriggerBtn.classList.add('is-reported');
          if (bodySelect) bodySelect.style.display = 'none';
          if (bodyDone)   bodyDone.style.display   = '';
        }
      }
    });
  });

  // Unreport button in the done view
  if (unreportBtn) {
    unreportBtn.addEventListener('click', async () => {
      if (!_reportCommentId) return;
      try {
        await deleteJSON(`/api/comments/${_reportCommentId}/report`);
        if (_reportTriggerBtn) {
          _reportTriggerBtn.classList.remove('is-reported');
          const icon = _reportTriggerBtn.querySelector('i');
          if (icon) icon.className = 'bi bi-flag';
          _reportTriggerBtn.title = 'Report comment';
        }
        closeReportModal();
      } catch (_) { closeReportModal(); }
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeReportModal();
  });
}

// ── Save / Bookmark AJAX ───────────────────────────────────────────────────

function initSaveButtons() {
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.feed-save-btn');
    if (!btn) return;
    if (!cfg.isAuthenticated) { window.location.href = '/login'; return; }
    const beatId = Number(btn.dataset.beatId);
    try {
      const data = await postJSON(`/api/beats/${beatId}/save`);
      const icon = btn.querySelector('i');
      if (data.saved) {
        btn.classList.add('is-saved');
        if (icon) icon.className = 'bi bi-bookmark-fill';
        btn.setAttribute('aria-label', 'Remove from saved');
      } else {
        btn.classList.remove('is-saved');
        if (icon) icon.className = 'bi bi-bookmark';
        btn.setAttribute('aria-label', 'Save this beat');
      }
    } catch (err) {
      if (err.message && err.message.includes('401')) window.location.href = '/login';
    }
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
  const isSaved     = beat.is_saved     ? 'is-saved'      : '';
  const savedIcon   = beat.is_saved     ? 'bi-bookmark-fill' : 'bi-bookmark';
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
    <div class="feed-waveform-shell">
      <canvas class="feed-waveform-canvas" id="waveform-${beat.id}"></canvas>
    </div>
    <div class="feed-transport-dock" id="transport-${beat.id}" data-beat-id="${beat.id}">
      <div class="feed-transport-row">
        <button type="button" class="feed-transport-btn" data-action="restart" data-beat-id="${beat.id}" aria-label="Restart track"><i class="bi bi-arrow-counterclockwise"></i></button>
        <button type="button" class="feed-transport-btn feed-transport-skip" data-action="back15" data-beat-id="${beat.id}" aria-label="Back 15 seconds"><span class="feed-skip-label">−15</span></button>
        <button type="button" class="feed-transport-btn primary" data-action="play-toggle" data-beat-id="${beat.id}" aria-label="Play or pause"><i class="bi bi-play-fill"></i></button>
        <button type="button" class="feed-transport-btn feed-transport-skip" data-action="forward15" data-beat-id="${beat.id}" aria-label="Forward 15 seconds"><span class="feed-skip-label">+15</span></button>
        <div class="feed-bpm-control" data-beat-id="${beat.id}">
          <button type="button" class="feed-bpm-toggle-btn" data-action="bpm-toggle" data-beat-id="${beat.id}" aria-label="Open BPM controls">BPM</button>
          <div class="feed-bpm-btn-group" data-beat-id="${beat.id}">
            <button type="button" class="feed-bpm-adj" data-action="bpm-down" data-beat-id="${beat.id}" aria-label="Decrease BPM">−</button>
            <span class="feed-bpm-display" id="feed-bpm-label-${beat.id}" title="Click to edit BPM">${beat.bpm} BPM</span>
            <button type="button" class="feed-bpm-adj" data-action="bpm-up" data-beat-id="${beat.id}" aria-label="Increase BPM">+</button>
          </div>
        </div>
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
        <button class="feed-rail-btn feed-save-btn ${isSaved}" data-beat-id="${beat.id}" aria-label="${beat.is_saved ? 'Remove from saved' : 'Save this beat'}">
          <i class="bi ${savedIcon}"></i>
        </button>
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

  // Initialise slider fill indicators so they match starting values
  document.querySelectorAll('.feed-transport-seek').forEach(el => el.style.setProperty('--range-pct', el.value));
  document.querySelectorAll('.feed-transport-volume').forEach(el => el.style.setProperty('--range-pct', el.value));

  // Draw a static (non-animated) waveform for every card present at page load
  document.querySelectorAll('.feed-card[data-beat-id]').forEach(card => {
    const beatId = Number(card.dataset.beatId);
    drawWaveform(beatId, false);
  });

  initIntersectionObserver();
  initPlayPauseButtons();
  initBpmEdit();
  initLikeButtons();
  initFollowButtons();
  initSaveButtons();
  initReplyBanners();
  initCommentDrawers();
  initReportModal();
  initInfiniteScroll();
});
