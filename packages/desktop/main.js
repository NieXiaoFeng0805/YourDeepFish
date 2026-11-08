'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, clipboard, powerMonitor, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const persona = require('../core/persona');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const W = 260;
const H = 340;
const PORT = 45871;
const SHOT = process.argv.includes('--shot');
const CONSOLE_SHOT = process.argv.includes('--console-shot');
const HEADLESS = SHOT || CONSOLE_SHOT;
const QA = process.argv.includes('--qa');
const SAVE_PATH = path.join(DATA, 'state.json');

/* 开机时的登场动画：`--entrance` 随机选边，`--entrance=left|right|bottom|top`
   可以钉死方向（调试用）。不带这个参数就是普通启动，不做动画。 */
const ENTRANCE = (() => {
  const arg = process.argv.find((a) => a === '--entrance' || a.startsWith('--entrance='));
  if (!arg) return null;
  const edge = arg.includes('=') ? arg.split('=')[1] : 'random';
  return ['left', 'right', 'bottom', 'top'].includes(edge) ? edge : 'random';
})();

if (!HEADLESS && !app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let tray = null;
let ignore = true;
let dragging = false;
let physicsTimer = null;
let ws = null;
let coreChild = null;

const pet = { x: 0, y: 0, vx: 0, vy: 0, grounded: true, lastTs: 0 };
const grab = { dx: 0, dy: 0 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState() {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(SAVE_PATH, JSON.stringify({ x: Math.round(pet.x), y: Math.round(pet.y) }), 'utf8');
  } catch {
    /* ignore */
  }
}

function workBounds() {
  const cx = Math.round(pet.x + W / 2);
  const cy = Math.round(pet.y + H / 2);
  const display = screen.getDisplayNearestPoint({ x: cx, y: cy });
  const wa = display.workArea;
  return {
    left: wa.x - 40,
    right: wa.x + wa.width - W + 40,
    ceiling: wa.y - 30,
    floor: wa.y + wa.height - H + 18,
  };
}

function placeWindow() {
  if (!win) return;
  const x = Math.round(pet.x);
  const y = Math.round(pet.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  win.setPosition(x, y, false);
}

/* ---------------- 登场动画 ----------------
   从屏幕边缘探头：先露出一小截，停顿一下，再把整个身体移进来。
   顶部做不了“头先出来”（角色是站姿，头在窗口上方），所以顶部改成从屏幕上方落下，
   落地沿用现有的弹跳物理。角色在本体 260×340 画布里的范围约 x 65–196、y 157–328，
   探头的偏移量就是按这个范围算的，保证露出来的是头而不是空白。 */

const EDGES = ['left', 'right', 'bottom', 'top'];
let entranceTimers = [];

const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

function tween(from, to, ms, ease, done) {
  const t0 = performance.now();
  const timer = setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / ms);
    const k = ease(p);
    pet.x = from.x + (to.x - from.x) * k;
    pet.y = from.y + (to.y - from.y) * k;
    if (!Number.isFinite(pet.x) || !Number.isFinite(pet.y)) {
      try {
        fs.appendFileSync(
          path.join(DATA, 'logs', 'entrance.log'),
          new Date().toISOString() + ' bad tween ms=' + ms + ' k=' + k + ' from=' + JSON.stringify(from) + ' to=' + JSON.stringify(to) + '\n',
        );
      } catch {
        /* ignore */
      }
      pet.x = to.x;
      pet.y = to.y;
      placeWindow();
      clearInterval(timer);
      entranceTimers = entranceTimers.filter((t) => t !== timer);
      if (done) done();
      return;
    }
    placeWindow();
    if (p >= 1) {
      clearInterval(timer);
      entranceTimers = entranceTimers.filter((t) => t !== timer);
      if (done) done();
    }
  }, 16);
  entranceTimers.push(timer);
}

function cancelEntrance() {
  for (const t of entranceTimers) {
    clearTimeout(t);
    clearInterval(t);
  }
  entranceTimers = [];
}

function playEntrance() {
  if (!win) return;
  const edge = ENTRANCE === 'random' ? EDGES[Math.floor(Math.random() * EDGES.length)] : ENTRANCE;
  const wa = screen.getPrimaryDisplay().workArea;
  const baseY = wa.y + wa.height - H + 18;
  const centerX = wa.x + Math.round((wa.width - W) / 2);

  const rest = {
    left: { x: wa.x + 40, y: baseY },
    right: { x: wa.x + wa.width - W - 40, y: baseY },
    bottom: { x: centerX, y: baseY },
    top: { x: centerX, y: baseY },
  }[edge];

  const start = {
    left: { x: wa.x - W - 24, y: baseY },
    right: { x: wa.x + wa.width + 24, y: baseY },
    bottom: { x: centerX, y: wa.y + wa.height + 24 },
    top: { x: centerX, y: wa.y - H - 24 },
  }[edge];

  stopPhysics();
  pet.vx = 0;
  pet.vy = 0;
  pet.grounded = true;
  pet.x = start.x;
  pet.y = start.y;
  win.setPosition(Math.round(pet.x), Math.round(pet.y), false);
  win.showInactive();
  win.moveTop();

  if (edge === 'top') {
    const drop = setTimeout(() => {
      pet.grounded = false;
      pet.vy = 0;
      pet.vx = 0;
      startPhysics();
    }, 260);
    entranceTimers.push(drop);
    return;
  }

  /* 探头位置：左/右各露出约 100px 的窗口，底部露出窗口顶部 210px——
     角色头顶在 y≈157，所以底部探头时露出的是小半个头。 */
  const peek = {
    left: { x: wa.x - 100, y: baseY },
    right: { x: wa.x + wa.width - W + 100, y: baseY },
    bottom: { x: centerX, y: wa.y + wa.height - 210 },
  }[edge];

  const t0 = setTimeout(() => {
    tween(start, peek, 320, easeOut, () => {
      const hold = setTimeout(() => {
        tween(peek, rest, 460, easeInOut, () => {
          pet.x = rest.x;
          pet.y = rest.y;
          placeWindow();
          pet.grounded = true;
          saveState();
        });
      }, 700);
      entranceTimers.push(hold);
    });
  }, 80);
  entranceTimers.push(t0);
}

function startPhysics() {
  if (physicsTimer) return;
  pet.lastTs = 0;
  physicsTimer = setInterval(step, 16);
}

function stopPhysics() {
  if (physicsTimer) clearInterval(physicsTimer);
  physicsTimer = null;
}

function step() {
  const now = performance.now();
  const dt = pet.lastTs ? Math.min(0.033, (now - pet.lastTs) / 1000) : 0.016;
  pet.lastTs = now;
  if (dragging || pet.grounded) {
    stopPhysics();
    return;
  }

  pet.vy += 2600 * dt;
  pet.x += pet.vx * dt;
  pet.y += pet.vy * dt;

  const b = workBounds();
  if (pet.y >= b.floor) {
    const impact = Math.abs(pet.vy);
    pet.y = b.floor;
    if (impact < 140) {
      pet.vy = 0;
      pet.vx = 0;
      pet.grounded = true;
      send('pet:land', { impact: 0 });
      saveState();
    } else {
      pet.vy = -impact * 0.34;
      pet.vx *= 0.82;
      send('pet:land', { impact: Math.round(impact) });
      if (impact > 900 && Math.random() < 0.6) {
        const l = persona.line('fluster');
        send('pet:say', { text: l.text, mood: l.mood });
      }
    }
  }
  if (pet.x < b.left) {
    pet.x = b.left;
    pet.vx = Math.abs(pet.vx) * 0.45;
  }
  if (pet.x > b.right) {
    pet.x = b.right;
    pet.vx = -Math.abs(pet.vx) * 0.45;
  }
  if (pet.y < b.ceiling) {
    pet.y = b.ceiling;
    pet.vy = 0;
  }
  placeWindow();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const saved = loadState();
  const defaultX = workArea.x + workArea.width - W - 80;
  const defaultY = workArea.y + workArea.height - H + 18;
  pet.x = Number.isFinite(saved.x) ? saved.x : defaultX;
  pet.y = Number.isFinite(saved.y) ? saved.y : defaultY;
  if (QA) {
    pet.x = Math.round(workArea.x + workArea.width - W - 60);
    pet.y = Math.round(workArea.y + workArea.height - H + 18);
  }

  const b = workBounds();
  pet.x = clamp(pet.x, b.left, b.right);
  pet.y = clamp(pet.y, b.ceiling, b.floor);

  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(pet.x),
    y: Math.round(pet.y),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      offscreen: QA,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* Windows 不支持，忽略 */
  }
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.once('did-finish-load', () => {
    try {
      // 清掉历史遗留的页面缩放，保证截图与真实比例一致
      win.webContents.setZoomFactor(1);
    } catch {
      /* ignore */
    }
  });

  win.once('ready-to-show', () => {
    if (QA) return;
    if (ENTRANCE) {
      playEntrance();
      return;
    }
    win.showInactive();
    win.moveTop();
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.moveTop();
    }, 1200);
    if (SHOT) {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'build', 'shot.png'), image.toPNG());
        console.log('[shot] saved build/shot.png');
        app.quit();
      }, 1600);
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

/* ---------------- 托盘 ---------------- */

function buildMenu() {
  const autostart = app.isPackaged ? app.getLoginItemSettings().openAtLogin : false;
  return Menu.buildFromTemplate([
    { label: '摸摸头', click: () => pat() },
    { label: '说句话', click: () => { const l = persona.line(['happy', 'cozy', 'tsundere'][Math.floor(Math.random() * 3)]); send('pet:say', l); } },
    { label: '控制台…', click: () => openConsole() },
    { type: 'separator' },
    { label: '整理下载目录', click: () => cmd('organize') },
    { label: '让它生气一下', click: () => { send('pet:mood', 'angry'); setTimeout(() => send('pet:mood', 'happy'), 3200); } },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: autostart,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: '打开数据目录', click: () => require('electron').shell.openPath(DATA) },
    { label: '审计日志', click: () => require('electron').shell.openPath(path.join(DATA, 'logs')) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon', 'tray32.png'));
  tray = new Tray(icon);
  tray.setToolTip('小肥鱼 · 桌宠');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.showInactive();
  });
}

/* ---------------- 与内核通信 ---------------- */

function speak(text, mood = 'happy') {
  send('pet:say', { text, mood });
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'cmd', cmd: 'say', text, mood }));
}

function pat() {
  const l = persona.line('shy');
  send('pet:say', { text: l.text, mood: l.mood });
}

function cmd(name) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'cmd', cmd: name }));
  else speak('内核还没准备好像我一样勤快。');
}

function ensureCore() {
  return new Promise((resolve) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const done = (ok) => {
      try { sock.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function startCore() {
  const running = await ensureCore();
  if (running) return;
  coreChild = spawn(process.execPath, [path.join(ROOT, 'packages', 'core', 'index.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CORE_PARENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: ROOT,
  });
  coreChild.stdout.on('data', (buf) => process.stdout.write(`[core] ${buf}`));
  coreChild.stderr.on('data', (buf) => process.stderr.write(`[core!] ${buf}`));
  coreChild.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error('[core] 退出码', code);
    coreChild = null;
  });
  await new Promise((r) => setTimeout(r, 900));
}

function connectCore(attempt = 0) {
  if (!win) return;
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
  socket.on('open', () => {
    ws = socket;
    socket.send(JSON.stringify({ type: 'hello', shell: 'electron', version: app.getVersion() }));
  });
  socket.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (msg.type === 'say') {
      send('pet:say', { text: msg.text, mood: msg.mood });
    } else if (msg.type === 'status') {
      console.log(`[core] 已连接，权限上限 L${msg.allowLevel}`);
    }
  });
  socket.on('close', () => {
    ws = null;
    if (attempt < 30) setTimeout(() => connectCore(attempt + 1), 2000);
  });
  socket.on('error', () => {});
}

/* ---------------- 感知 ---------------- */

let lastClip = '';

function startSensors() {
  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    const idle = powerMonitor.getSystemIdleTime();
    if (idle > 30) ws.send(JSON.stringify({ type: 'idle', seconds: idle }));
  }, 20_000);

  // 光标轮询：鼠标静止时也能正确切换「可点 / 穿透」
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || dragging) return;
    const point = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
      if (!ignore) {
        ignore = true;
        win.setIgnoreMouseEvents(true, { forward: true });
      }
      return;
    }
    send('pet:cursor', { x, y });
  }, 200);

  setInterval(() => {
    if (!ws || ws.readyState !== 1) return;
    let text = '';
    try {
      text = clipboard.readText();
    } catch {
      return;
    }
    if (!text || text.length < 800 || text === lastClip) return;
    lastClip = text;
    let hash = 0;
    for (let i = 0; i < text.length; i = i + 7) hash = ((hash * 31) ^ text.charCodeAt(i)) >>> 0;
    ws.send(JSON.stringify({ type: 'clipboard', chars: text.length, hash: String(hash) }));
  }, 8000);
}

/* ---------------- IPC ---------------- */

ipcMain.on('hit:set', (_e, opaque) => {
  if (dragging) return;
  const shouldIgnore = !opaque;
  if (shouldIgnore === ignore) return;
  ignore = shouldIgnore;
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('drag:start', (_e, p) => {
  if (!win) return;
  cancelEntrance();
  dragging = true;
  stopPhysics();
  pet.grounded = false;
  const b = win.getBounds();
  grab.dx = b.x - p.x;
  grab.dy = b.y - p.y;
  send('pet:drag', { on: true });
  send('pet:mood', 'fluster');
  if (Math.random() < 0.5) {
    const l = persona.line('fluster');
    send('pet:say', { text: l.text, mood: l.mood });
  }
});

ipcMain.on('drag:move', (_e, p) => {
  if (!dragging || !win) return;
  pet.x = p.x + grab.dx;
  pet.y = p.y + grab.dy;
  placeWindow();
});

ipcMain.on('drag:end', (_e, v) => {
  if (!win) return;
  dragging = false;
  pet.vx = clamp(Number(v.vx) || 0, -1800, 1800);
  pet.vy = clamp(Number(v.vy) || 0, -1800, 1800);
  pet.grounded = false;
  send('pet:drag', { on: false });
  startPhysics();
});

ipcMain.on('menu:show', () => {
  if (!tray) return;
  tray.popUpContextMenu();
});

ipcMain.on('pet:pat', () => pat());

ipcMain.handle('persona:line', (_e, category) => persona.line(category));

/* ---------------- 控制台 ---------------- */

const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const PLUGIN_ID = 'dsh-yourdeepfish';
const PLUGIN_SRC = path.join(ROOT, 'packages', 'plugin-dsh');
const CONFIG_PATH = path.join(DATA, 'config.json');

const CONFIG_DEFAULTS = {
  allowLevel: 1,
  downloadsDir: path.join(os.homedir(), 'Downloads'),
  dailyOrganize: '09:00',
  idleRemindMinutes: 20,
  clipboardMinChars: 800,
  muted: false,
};

let consoleWin = null;

function readConfig() {
  try {
    return { ...CONFIG_DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function pluginState() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, 'package.json'), 'utf8'));
    return {
      installed: fs.existsSync(path.join(PROFILE_DIR, 'node_modules', PLUGIN_ID, 'package.json')),
      enabled: (pkg.dsh?.profile?.bundles || []).includes(PLUGIN_ID),
      profile: PROFILE_DIR,
    };
  } catch {
    return { installed: false, enabled: false, profile: PROFILE_DIR, error: '找不到 DSH profile' };
  }
}

function pluginSet(enable) {
  const pkgPath = path.join(PROFILE_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

  if (enable) {
    const dest = path.join(PROFILE_DIR, 'node_modules', PLUGIN_ID);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(PLUGIN_SRC, dest, { recursive: true });
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies[PLUGIN_ID] = 'file:' + PLUGIN_SRC.replace(/\\/g, '/');
    if (!bundles.includes(PLUGIN_ID)) bundles.push(PLUGIN_ID);
  }
  pkg.dsh.profile.bundles = enable ? bundles : bundles.filter((b) => b !== PLUGIN_ID);

  fs.copyFileSync(pkgPath, pkgPath + '.bak-yourdeepfish');
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
  return pluginState();
}

function openConsole() {
  if (consoleWin && !consoleWin.isDestroyed()) {
    consoleWin.show();
    consoleWin.focus();
    return consoleWin;
  }
  consoleWin = new BrowserWindow({
    width: 660,
    height: 780,
    minWidth: 560,
    minHeight: 640,
    title: '小肥鱼 · 控制台',
    backgroundColor: '#0e1729',
    autoHideMenuBar: true,
    show: !process.argv.includes('--console-shot'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: process.argv.includes('--console-shot'),
    },
  });
  consoleWin.loadFile(path.join(__dirname, 'console.html'));
  consoleWin.on('closed', () => {
    consoleWin = null;
  });
  return consoleWin;
}

ipcMain.handle('console:get', () => ({
  config: readConfig(),
  status: {
    core: !!(ws && ws.readyState === 1),
    petVisible: !!(win && win.isVisible()),
    autostart: app.getLoginItemSettings().openAtLogin,
    plugin: pluginState(),
  },
}));

ipcMain.handle('console:save', (_e, payload) => {
  const next = { ...readConfig(), ...(payload || {}) };
  delete next.autostart;
  writeConfig(next);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'cmd', cmd: 'config:reload' }));
  if (payload && typeof payload.autostart === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: payload.autostart, path: process.execPath, args: [ROOT] });
  }
  return { ok: true, config: next };
});

ipcMain.handle('console:plugin', (_e, enable) => {
  try {
    return { ok: true, state: pluginSet(!!enable) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('console:pickDir', async () => {
  const result = await dialog.showOpenDialog(consoleWin || win, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.on('pet:visible', (_e, visible) => {
  if (!win) return;
  if (visible) win.showInactive();
  else win.hide();
});

/* ---------------- 生命周期 ---------------- */

app.on('second-instance', () => {
  if (win) win.showInactive();
});

app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
  saveState();
  if (coreChild) {
    try { coreChild.kill(); } catch { /* ignore */ }
  }
});

app.whenReady().then(async () => {
  if (process.argv.includes('--console-shot')) {
    const cw = openConsole();
    cw.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await cw.webContents.capturePage();
        fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'build', 'console.png'), img.toPNG());
        console.log('[console] saved build/console.png', img.getSize());
        app.quit();
      }, 1400);
    });
    return;
  }

  if (QA) {
    // 离屏渲染：只截图，不在屏幕上弹任何窗口
    createWindow();
    win.webContents.once('did-finish-load', () => {
      win.webContents.executeJavaScript(
        "document.body.style.background='linear-gradient(150deg,#131c33 0%,#20395c 45%,#4a5f8c 100%)'",
      );
      setTimeout(() => {
        const g = persona.line('greet');
        send('pet:say', { text: g.text, mood: g.mood });
      }, 400);
      setTimeout(async () => {
        await qaCapture();
        app.quit();
      }, 1800);
    });
    return;
  }

  createWindow();
  createTray();
  startSensors();
  if (!SHOT) {
    await startCore();
    connectCore();
  }
});

async function qaCapture() {
  if (!win) return;
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'build', 'preview.png'), image.toPNG());
  console.log('[qa] saved build/preview.png', image.getSize());
}
