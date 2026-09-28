/*
 * GENSLATE profile site.
 *
 * The background is a field of small capsule particles on a jittered grid.
 * A focal point eases toward the pointer (or wanders on its own when idle);
 * particles near a breathing ring around it light up, stretch, turn to face
 * it and get pushed outward, then spring back home. Colour follows the angle
 * around the focus through the Nord frost and aurora palettes. Clicking sends
 * a shockwave through the field.
 */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;

  /* ---------------- Particle field ---------------- */

  const canvas = document.getElementById('field');
  const ctx = canvas.getContext('2d');

  // Colour wheel around the focus: frost → purple → red → orange → yellow → green → frost.
  const WHEEL = ['#88c0d0', '#81a1c1', '#5e81ac', '#b48ead', '#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#8fbcbb'];
  const HUES = 36;
  const ALPHAS = 6;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const wheelRGB = WHEEL.map(hex);
  const palette = [];
  for (let i = 0; i < HUES; i++) {
    const t = (i / HUES) * (wheelRGB.length - 1);
    const a = wheelRGB[Math.floor(t)];
    const b = wheelRGB[Math.min(wheelRGB.length - 1, Math.floor(t) + 1)];
    const f = t - Math.floor(t);
    palette.push(a.map((v, k) => Math.round(v + (b[k] - v) * f)));
  }

  let W = 0, H = 0, DPR = 1;
  let particles = [];
  // One path bucket per (hue, alpha) so each frame is ~200 strokes, not thousands.
  let buckets = [];

  const focus = { x: 0, y: 0, tx: 0, ty: 0 };
  const pointer = { x: 0, y: 0, active: false, last: 0 };
  const waves = [];
  let scrollFade = 1;
  let theme = root.dataset.theme;
  let time = 0;
  let running = false;
  let rafId = 0;

  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Denser on big screens, lighter on phones; capped for slow devices.
    const spacing = W < 640 ? 24 : W < 1200 ? 26 : 28;
    const cols = Math.ceil(W / spacing) + 2;
    const rows = Math.ceil(H / spacing) + 2;
    particles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const hx = (c - 1) * spacing + (r % 2) * spacing * 0.5 + (Math.random() - 0.5) * spacing * 0.7;
        const hy = (r - 1) * spacing + (Math.random() - 0.5) * spacing * 0.7;
        particles.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, seed: Math.random() * 0.8, ang: 0 });
      }
    }
    if (!focus.x) {
      focus.x = focus.tx = W * 0.5;
      focus.y = focus.ty = H * 0.46;
    }
    buckets = Array.from({ length: HUES * ALPHAS }, () => []);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000) || 0.016;
    frame.last = now;
    time += dt;
    step(dt);
    draw();
    if (running) rafId = requestAnimationFrame(frame);
  }

  function step(dt) {
    // Focus follows the pointer; after a few idle seconds (or on touch) it wanders on a slow Lissajous path.
    const idle = !pointer.active || performance.now() - pointer.last > 4000;
    if (idle) {
      focus.tx = W * (0.5 + 0.22 * Math.sin(time * 0.21));
      focus.ty = H * (0.46 + 0.16 * Math.sin(time * 0.33 + 1.2));
    } else {
      focus.tx = pointer.x;
      focus.ty = pointer.y;
    }
    const follow = 1 - Math.pow(0.0025, dt);
    focus.x += (focus.tx - focus.x) * follow;
    focus.y += (focus.ty - focus.y) * follow;

    const scrolled = Math.min(1, window.scrollY / (H * 0.9));
    scrollFade += ((1 - scrolled * 0.55) - scrollFade) * 0.08;

    for (let i = waves.length - 1; i >= 0; i--) {
      waves[i].r += dt * 900;
      waves[i].life -= dt * 0.9;
      if (waves[i].life <= 0) waves.splice(i, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const b of buckets) b.length = 0;

    const minDim = Math.min(W, H);
    const ringR = minDim * (0.26 + 0.025 * Math.sin(time * 1.3));
    const band = minDim * 0.16;
    const push = minDim * 0.075;
    const k = 0.06;       // spring stiffness toward the target
    const damp = 0.82;    // velocity damping
    const light = theme === 'light';
    const base = light ? 0.16 : 0.1;

    for (const p of particles) {
      const dx = p.hx - focus.x;
      const dy = p.hy - focus.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const nx = dx / d, ny = dy / d;

      // Brightness: a soft band around the ring plus a faint core glow.
      const off = (d - ringR) / band;
      let w = Math.exp(-off * off);
      if (d < ringR) w = Math.max(w, 0.35 * (1 - d / ringR));

      // Gentle flow-field drift so the field never sits perfectly still.
      const flow = Math.sin(p.hx * 0.006 + time * 0.5) + Math.cos(p.hy * 0.007 - time * 0.4) + p.seed;
      const drift = 2.2 + w * 3;
      let tx = p.hx + Math.cos(flow) * drift;
      let ty = p.hy + Math.sin(flow) * drift;

      // Outward push strongest inside the ring, so the cursor opens a quiet pocket.
      const repel = push * (d < ringR ? 1 - (d / ringR) * 0.4 : Math.exp(-((d - ringR) / band) * 1.4) * 0.6);
      tx += nx * repel;
      ty += ny * repel;

      // Shockwaves from clicks.
      for (const wv of waves) {
        const wd = Math.hypot(p.hx - wv.x, p.hy - wv.y);
        const hit = Math.exp(-Math.pow((wd - wv.r) / 60, 2)) * wv.life;
        if (hit > 0.01) {
          tx += ((p.hx - wv.x) / (wd || 1)) * hit * 38;
          ty += ((p.hy - wv.y) / (wd || 1)) * hit * 38;
          w = Math.max(w, hit);
        }
      }

      p.vx = (p.vx + (tx - p.x) * k) * damp;
      p.vy = (p.vy + (ty - p.y) * k) * damp;
      p.x += p.vx;
      p.y += p.vy;

      // Orientation: face the focus near the ring, follow the flow far away.
      const radial = Math.atan2(ny, nx);
      let target = w > 0.25 ? radial : flow;
      let delta = target - p.ang;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      p.ang += delta * 0.12;

      const alpha = Math.min(1, (base + w * 0.9) * scrollFade);
      if (alpha < 0.04) continue;
      const len = 1.2 + w * 9 + Math.hypot(p.vx, p.vy) * 0.8;

      let hue = (radial + Math.PI) / (Math.PI * 2) + time * 0.03;
      hue = ((hue % 1) + 1) % 1;
      const hi = Math.floor(hue * HUES) % HUES;
      const ai = Math.min(ALPHAS - 1, Math.floor(alpha * ALPHAS));
      const cx = Math.cos(p.ang) * len * 0.5;
      const cy = Math.sin(p.ang) * len * 0.5;
      buckets[hi * ALPHAS + ai].push(p.x - cx, p.y - cy, p.x + cx, p.y + cy);
    }

    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    for (let hi = 0; hi < HUES; hi++) {
      const [r, g, b] = palette[hi];
      for (let ai = 0; ai < ALPHAS; ai++) {
        const segs = buckets[hi * ALPHAS + ai];
        if (!segs.length) continue;
        ctx.strokeStyle = `rgba(${r},${g},${b},${((ai + 0.5) / ALPHAS).toFixed(3)})`;
        ctx.beginPath();
        for (let i = 0; i < segs.length; i += 4) {
          ctx.moveTo(segs[i], segs[i + 1]);
          ctx.lineTo(segs[i + 2], segs[i + 3]);
        }
        ctx.stroke();
      }
    }
  }

  function start() {
    if (running || reduceMotion.matches || document.hidden) return;
    running = true;
    frame.last = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }
  // With reduced motion we still paint one settled, static frame.
  function still() {
    for (let i = 0; i < 90; i++) { step(1 / 60); draw(); }
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { build(); if (!running) still(); }, 120);
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.active = true; pointer.last = performance.now();
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.active = false; });
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;
    waves.push({ x: e.clientX, y: e.clientY, r: 0, life: 1 });
    if (waves.length > 4) waves.shift();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduceMotion.addEventListener('change', () => (reduceMotion.matches ? (stop(), still()) : start()));

  build();
  if (reduceMotion.matches) still(); else start();

  /* ---------------- Theme toggle ---------------- */

  const toggle = document.querySelector('.theme');
  toggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
      theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* storage may be blocked */ }
      if (!running) still();
    };
    if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(apply);
    else apply();
  });

  /* ---------------- Rotating role ---------------- */

  const roles = ['portable desktop apps', 'native Rust cores', 'practical AI tools', 'flat design systems', 'fast, quiet software'];
  const slot = document.querySelector('.rotator');
  let roleIndex = 0;
  if (slot && !reduceMotion.matches) {
    setInterval(() => {
      if (document.hidden) return;
      const current = slot.querySelector('.word');
      current.classList.add('out');
      current.addEventListener('animationend', () => {
        roleIndex = (roleIndex + 1) % roles.length;
        const next = document.createElement('span');
        next.className = 'word in';
        next.textContent = roles[roleIndex];
        current.replaceWith(next);
      }, { once: true });
    }, 2800);
  }

  /* ---------------- Reveal on scroll ---------------- */

  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    // Stagger siblings that reveal together.
    const groups = new Map();
    reveals.forEach((el) => {
      const n = groups.get(el.parentElement) || 0;
      groups.set(el.parentElement, n + 1);
      el.style.setProperty('--d', `${Math.min(n, 8) * 70}ms`);
      io.observe(el);
    });
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  /* ---------------- Nav: scrolled state and active section ---------------- */

  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const links = new Map([...document.querySelectorAll('.nav li a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const link = links.get(entry.target.id);
      if (link && entry.isIntersecting) {
        links.forEach((a) => a.classList.remove('active'));
        link.classList.add('active');
      }
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });

  /* ---------------- Card spotlight ---------------- */

  document.querySelectorAll('.glow').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
