'use strict';

const api = window.petAPI;
const W = 200;
const H = 210;
const DPR = Math.min(2, window.devicePixelRatio || 1);
const BOTTOM = 12;
// 与 DSH 插件保持一致：本体显示高度 126px（插件画布 hh=126）
const DESIRED_H = 126;
let poseScale = 126 / 433;

const canvas = document.getElementById('stage');
const bubbleEl = document.getElementById('bubble');
const bubbleText = bubbleEl.querySelector('.bubble-text');

canvas.width = Math.round(W * DPR);
canvas.height = Math.round(H * DPR);

const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.scale(DPR, DPR);

/* ---------------- 资源 ---------------- */

const POSE_SRC = {
  idle: '../../assets/char/pose_idle.png',
  happy: '../../assets/char/pose_happy.png',
  sleep: '../../assets/char/pose_sleep.png',
};

const images = {};
for (const [key, src] of Object.entries(POSE_SRC)) {
  const img = new Image();
  img.src = src;
  img.onload = () => {
    images[key] = img;
    if (key === 'idle') poseScale = DESIRED_H / img.height;
  };
}

/* ---------------- 情绪 ---------------- */

const EMOTIONS = {
  happy: { puff: 0, jitter: 0, lean: 0, shrink: 1, cls: '' },
  tsundere: { puff: 0.028, jitter: 0.005, lean: 0, shrink: 1, cls: 'tsun' },
  fluster: { puff: 0.008, jitter: 0.016, lean: 0, shrink: 0.99, cls: 'fluster' },
  shy: { puff: 0, jitter: 0.004, lean: -0.02, shrink: 0.985, cls: 'shy' },
  sad: { puff: 0, jitter: 0, lean: -0.035, shrink: 0.97, cls: 'sad' },
  worry: { puff: 0, jitter: 0.002, lean: -0.015, shrink: 0.99, cls: 'sad' },
  cozy: { puff: -0.008, jitter: 0, lean: 0.04, shrink: 1, cls: '' },
};

const MOOD_CLASSES = ['tsun', 'fluster', 'shy', 'sad'];
const HAPPY_POSES = new Set(['happy', 'cozy', 'shy']);

/* ---------------- 待机小动作 ---------------- */

const ACTIONS = {
  hop: (p) => ({ dy: -Math.sin(Math.PI * p) * 9 }),
  tiltL: (p) => ({ rot: -Math.sin(Math.PI * p) * 0.07 }),
  tiltR: (p) => ({ rot: Math.sin(Math.PI * p) * 0.07 }),
  squash: (p) => ({ sy: 1 - Math.sin(Math.PI * p) * 0.06, sx: 1 + Math.sin(Math.PI * p) * 0.03 }),
  stretch: (p) => ({ sy: 1 + Math.sin(Math.PI * p) * 0.045 }),
  step: (p) => ({ dx: Math.sin(Math.PI * 2 * p) * 3 }),
  peek: (p) => ({ rot: Math.sin(Math.PI * p) * 0.05, dx: Math.sin(Math.PI * p) * 4 }),
};

const ACTION_KEYS = Object.keys(ACTIONS);

const state = {
  squash: 0,
  tilt: 0,
  targetTilt: 0,
  hover: 0,
  hoverOn: false,
  dragging: false,
  grounded: true,
  emoTarget: 'happy',
  emoUntil: 0,
  emo: { puff: 0, jitter: 0, lean: 0, shrink: 1 },
  pose: 'idle',
  prevPose: null,
  poseBlend: 1,
  action: null,
  nextActionAt: 0,
  lastActionKey: '',
  cursorX: W / 2,
  lastInteract: performance.now(),
  asleep: false,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function setEmotion(name, ms = 3000) {
  const key = EMOTIONS[name] ? name : 'happy';
  state.emoTarget = key;
  state.emoUntil = ms > 0 ? performance.now() + ms : 0;
  for (const cls of MOOD_CLASSES) bubbleEl.classList.remove(cls);
  const cls = EMOTIONS[key].cls;
  if (cls) bubbleEl.classList.add(cls);
}

function setPose(name) {
  if (name === state.pose) return;
  state.prevPose = state.pose;
  state.pose = name;
  state.poseBlend = 0;
}

function scheduleNextAction(now) {
  state.nextActionAt = now + 3500 + Math.random() * 5500;
}

function startRandomAction(now) {
  let key = ACTION_KEYS[Math.floor(Math.random() * ACTION_KEYS.length)];
  if (key === state.lastActionKey) {
    key = ACTION_KEYS[(ACTION_KEYS.indexOf(key) + 1) % ACTION_KEYS.length];
  }
  state.lastActionKey = key;
  state.action = { key, start: now, dur: 700 + Math.random() * 600 };
  scheduleNextAction(now + state.action.dur);
}

/* ---------------- 绘制 ---------------- */

function drawPose(key, alpha, sx, sy, rot, dx, dy) {
  const img = images[key];
  if (!img || alpha <= 0.002) return;
  const w = img.width * poseScale;
  const h = img.height * poseScale;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(W / 2 + dx, H - BOTTOM + dy);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

function drawCharacter(t, now) {
  if (!images[state.pose]) return;

  const idleSeconds = (now - state.lastInteract) / 1000;
  state.asleep = idleSeconds > 180 && !state.dragging && !state.action;

  const breathPeriod = state.asleep ? 5.2 : 3.4;
  const breath = Math.sin((t * Math.PI * 2) / breathPeriod);
  const sway = Math.sin((t * Math.PI * 2) / 4.8);
  const sq = state.squash;
  const e = state.emo;
  const jitter = Math.sin(t * 46) * e.jitter;
  const cursorLean = state.hoverOn ? clamp((state.cursorX - W / 2) / W, -0.5, 0.5) * 0.05 : 0;

  let dx = 0;
  let dy = 0;
  let extraRot = 0;
  let extraSx = 1;
  let extraSy = 1;
  if (state.action && !state.dragging) {
    const { key, start, dur } = state.action;
    const p = clamp((now - start) / dur, 0, 1);
    if (p >= 1) {
      state.action = null;
    } else {
      const out = ACTIONS[key](p);
      dx = out.dx || 0;
      dy = out.dy || 0;
      extraRot = out.rot || 0;
      extraSx = out.sx || 1;
      extraSy = out.sy || 1;
    }
  }

  const breathAmp = state.asleep ? 0.008 : 0.012;
  const sx = (1 + breathAmp * breath + sq * 0.08 + state.hover * 0.02) * e.shrink * (1 + e.puff) * extraSx;
  const sy = (1 - breathAmp * 1.3 * breath - sq * 0.1 + state.hover * 0.02) * e.shrink * (1 - e.puff * 0.55) * extraSy;
  const rot = sway * 0.012 + state.tilt + jitter + e.lean + cursorLean + extraRot;
  const sink = state.asleep ? 2 : 0;

  const blending = state.prevPose && state.poseBlend < 1;
  if (blending) {
    drawPose(state.prevPose, 1 - state.poseBlend, sx, sy, rot, dx, dy + sink);
  }
  drawPose(state.pose, blending ? state.poseBlend : 1, sx, sy, rot, dx, dy + sink);
}

let last = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  if (state.emoUntil && now > state.emoUntil) setEmotion('happy', 0);
  if (!state.dragging && !state.action && now > state.nextActionAt && !state.asleep) {
    startRandomAction(now);
  }
  if (state.prevPose && state.poseBlend < 1) {
    state.poseBlend = Math.min(1, state.poseBlend + dt / 0.28);
    if (state.poseBlend >= 1) state.prevPose = null;
  }

  // 选择姿态：睡觉 > 开心 > 默认坐姿
  const want = state.dragging ? 'idle' : state.asleep ? 'sleep' : HAPPY_POSES.has(state.emoTarget) ? 'happy' : 'idle';
  if (want !== state.pose) setPose(want);

  const target = EMOTIONS[state.emoTarget] || EMOTIONS.happy;
  const k = Math.min(1, dt * 6);
  state.emo.puff = lerp(state.emo.puff, target.puff, k);
  state.emo.jitter = lerp(state.emo.jitter, target.jitter, k);
  state.emo.lean = lerp(state.emo.lean, target.lean, k);
  state.emo.shrink = lerp(state.emo.shrink, target.shrink, k);

  state.squash *= Math.pow(0.0008, dt);
  state.hover = lerp(state.hover, state.hoverOn ? 1 : 0, Math.min(1, dt * 9));
  state.tilt = lerp(state.tilt, state.targetTilt, Math.min(1, dt * 10));

  ctx.clearRect(0, 0, W, H);
  drawCharacter(t, now);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

/* ---------------- 命中检测 ---------------- */

function alphaAt(cssX, cssY) {
  const x = Math.round(cssX * DPR);
  const y = Math.round(cssY * DPR);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 0;
  try {
    return ctx.getImageData(x, y, 1, 1).data[3];
  } catch {
    return 255;
  }
}

let hitOn = false;
let lastHitAt = 0;

function updateHit(cssX, cssY) {
  state.cursorX = cssX;
  if (state.dragging) return;
  const inside = alphaAt(cssX, cssY) > 24;
  if (inside !== hitOn) {
    hitOn = inside;
    state.hoverOn = inside;
    api.hit(inside);
  }
}

window.addEventListener('mousemove', (e) => {
  state.lastInteract = performance.now();
  if (state.dragging) return;
  const now = performance.now();
  if (now - lastHitAt < 40) return;
  lastHitAt = now;
  updateHit(e.clientX, e.clientY);
});

/* ---------------- 拖拽 ---------------- */

let press = null;
let moved = false;
let samples = [];

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (alphaAt(e.clientX, e.clientY) <= 24) return;
  state.lastInteract = performance.now();
  press = { id: e.pointerId, x: e.screenX, y: e.screenY, t: performance.now() };
  samples = [{ t: press.t, x: e.screenX, y: e.screenY }];
  moved = false;
  state.dragging = true;
  state.action = null;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  api.dragStart({ x: e.screenX, y: e.screenY });
});

window.addEventListener('pointermove', (e) => {
  if (!press) return;
  const dx = e.screenX - press.x;
  const dy = e.screenY - press.y;
  if (!moved && Math.hypot(dx, dy) > 4) moved = true;
  samples.push({ t: performance.now(), x: e.screenX, y: e.screenY });
  if (samples.length > 12) samples.shift();
  if (moved) {
    api.dragMove({ x: e.screenX, y: e.screenY });
    state.targetTilt = clamp((e.movementX || 0) * 0.012, -0.14, 0.14);
  }
});

function releaseVelocity() {
  const now = performance.now();
  const recent = samples.filter((sp) => now - sp.t < 140);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = Math.max(0.016, (b.t - a.t) / 1000);
  return { vx: clamp((b.x - a.x) / dt, -1800, 1800), vy: clamp((b.y - a.y) / dt, -1800, 1800) };
}

function endPress() {
  if (!press) return;
  const wasDrag = moved;
  press = null;
  state.dragging = false;
  state.targetTilt = 0;
  state.lastInteract = performance.now();
  api.dragEnd(wasDrag ? releaseVelocity() : { vx: 0, vy: 0 });
  if (!wasDrag) {
    api
      .line('tsundere')
      .then((l) => {
        setEmotion(l.mood, 2600);
        showBubble(l.text);
      })
      .catch(() => showBubble('哼。'));
  } else {
    state.grounded = false;
  }
}

window.addEventListener('pointerup', endPress);
window.addEventListener('pointercancel', endPress);

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu();
});

window.addEventListener('dblclick', (e) => {
  if (alphaAt(e.clientX, e.clientY) > 24) api.pat();
});

/* ---------------- 气泡 ---------------- */

let bubbleTimer = null;

function showBubble(text) {
  if (!text) return;
  bubbleText.textContent = text;
  bubbleEl.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), 8000);
}

api.onSay(({ text, mood }) => {
  if (mood) setEmotion(mood, 3000);
  showBubble(text);
});

api.onLand(({ impact }) => {
  state.grounded = true;
  state.squash = clamp(impact / 900, 0, 0.32);
});

api.onDrag(({ on }) => {
  state.dragging = on;
  state.grounded = !on;
  if (on) state.action = null;
});

api.onMood((mood) => setEmotion(mood, 2500));

api.onCursor(({ x, y }) => updateHit(x, y));
