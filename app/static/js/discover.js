/* ============================================================
   TUNEFEED — Discover Page
   Animated portal wave canvas.
   ============================================================ */

(function () {
  'use strict';

  const canvas = document.getElementById('portal-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  /* ── Resize handler ─────────────────────────────────────────
     Keep canvas pixel dimensions synced with its CSS size.
     devicePixelRatio scales for Retina / HiDPI screens.
  ─────────────────────────────────────────────────────────── */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ── Wave parameters ─────────────────────────────────────── */
  const WAVES = [
    /* amplitude, frequency, speed, phase offset, colour (with alpha) */
    { amp: 55,  freq: 0.012, speed: 0.018, phase: 0,           colour: 'rgba(217,119,6,0.22)'  },
    { amp: 40,  freq: 0.018, speed: 0.024, phase: Math.PI/3,   colour: 'rgba(245,158,11,0.18)' },
    { amp: 30,  freq: 0.022, speed: 0.030, phase: Math.PI*0.7, colour: 'rgba(232,121,249,0.14)'},
    { amp: 20,  freq: 0.030, speed: 0.040, phase: Math.PI/1.4, colour: 'rgba(0,212,170,0.12)'  },
    { amp: 65,  freq: 0.008, speed: 0.012, phase: Math.PI/5,   colour: 'rgba(217,119,6,0.08)'  },
  ];

  let t = 0;  /* global animation timer */

  /* ── Draw one sinusoidal wave as a filled path ──────────────
     Each wave is drawn as a closed shape from the vertical
     midpoint, oscillating up and down, filled with a semi-
     transparent gradient so waves stack with depth.
  ─────────────────────────────────────────────────────────── */
  function drawWave(w, cssW, cssH) {
    const midY = cssH * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);

    /* Step across the width in 4px increments for smooth curves */
    for (let x = 0; x <= cssW; x += 4) {
      const y = midY
        + Math.sin(x * w.freq + t * w.speed + w.phase) * w.amp
        + Math.sin(x * w.freq * 1.7 + t * w.speed * 0.6 + w.phase * 1.3) * (w.amp * 0.35);
      ctx.lineTo(x, y);
    }

    ctx.lineTo(cssW, cssH);
    ctx.lineTo(0, cssH);
    ctx.closePath();

    /* Vertical gradient fills each wave from colour → transparent */
    const grad = ctx.createLinearGradient(0, midY - w.amp, 0, cssH);
    grad.addColorStop(0, w.colour);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /* ── Main animation loop ────────────────────────────────────
     requestAnimationFrame throttles to the display refresh
     rate (usually 60 fps) so the animation is smooth and
     doesn't run faster than necessary.
  ─────────────────────────────────────────────────────────── */
  function animate() {
    const cssW = canvas.offsetWidth;
    const cssH = canvas.offsetHeight;

    /* Clear only the logical CSS pixel area (not the scaled canvas) */
    ctx.clearRect(0, 0, cssW, cssH);

    for (const w of WAVES) {
      drawWave(w, cssW, cssH);
    }

    /* Mirror the same waves above the midpoint for a symmetric effect */
    ctx.save();
    ctx.scale(1, -1);
    ctx.translate(0, -cssH);
    for (const w of WAVES) {
      drawWave(w, cssW, cssH);
    }
    ctx.restore();

    t += 1;
    requestAnimationFrame(animate);
  }

  animate();
})();
