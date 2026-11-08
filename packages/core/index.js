'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, DATA_DIR, LOG_DIR } = require('./config');
const audit = require('./audit');
const tools = require('./tools');
const persona = require('./persona');
const { Hub } = require('./server');

const config = loadConfig();
const hub = new Hub(config.port);

const ctx = {
  config,
  dataDir: DATA_DIR,
  logsDir: LOG_DIR,
  say,
  log,
};

let lastDailyKey = '';
let idleNotifiedAt = 0;
let lastClipHash = '';
let watchedFiles = new Set();
let seeded = false;
let watchTimer = null;
let lastNewFileNotice = 0;
let greetingDone = false;

function nowMinute() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function say(text, mood = 'happy', extra = {}) {
  if (!text) return;
  if (config.muted) {
    log(`[静音] ${text}`);
    return;
  }
  hub.broadcast({ type: 'say', text, mood, ts: Date.now(), ...extra });
  audit.record({ kind: 'say', text, mood, ...extra });
  log(`[说] ${text}`);
}

function log(...args) {
  console.log('[core]', ...args);
}

/* ---------------- 定时任务 ---------------- */

function startTicker() {
  setInterval(() => {
    const minute = nowMinute();
    if (minute !== config.dailyOrganize) return;
    const key = todayKey();
    if (lastDailyKey === key) return;
    lastDailyKey = key;
    runOrganize('每日整理').catch((err) => log('每日整理失败:', err.message));
  }, 20_000).unref?.();
}

/* ---------------- 下载目录监视 ---------------- */

function scanNames() {
  try {
    return new Set(fs.readdirSync(config.downloadsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name));
  } catch {
    return new Set();
  }
}

function startWatch() {
  if (!fs.existsSync(config.downloadsDir)) {
    log('下载目录不存在，跳过监视:', config.downloadsDir);
    return;
  }
  watchedFiles = scanNames();
  seeded = true;
  try {
    fs.watch(config.downloadsDir, { persistent: true }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(onDownloadsChanged, 2500);
    });
  } catch (err) {
    log('无法监视下载目录:', err.message);
  }
}

function onDownloadsChanged() {
  const next = scanNames();
  const added = [...next].filter((name) => !watchedFiles.has(name));
  watchedFiles = next;
  if (!seeded || added.length === 0) return;
  const now = Date.now();
  if (now - lastNewFileNotice < 90_000) return;
  lastNewFileNotice = now;
  const sample = added.slice(0, 2).join('、');
  say(
    `主人，下载目录里多了 ${added.length} 个新文件（${sample}${added.length > 2 ? ' 等' : ''}）……要我帮您整理吗？`,
    'happy',
    { tool: 'watch' },
  );
}

/* ---------------- 任务执行 ---------------- */

async function runOrganize(reason) {
  try {
    const res = await tools.execute('downloads.organize', { dryRun: false }, ctx);
    audit.record({ kind: 'task', tool: 'downloads.organize', reason, result: res });
    if (res.moved > 0) {
      const w = persona.line('work');
      say(
        `${w.text} 这次一共归位了 ${res.moved} 个文件${res.failed ? `，还有 ${res.failed} 个没搬动` : ''}。`,
        w.mood,
        { tool: 'downloads.organize' },
      );
    }
    watchedFiles = scanNames();
    return res;
  } catch (err) {
    audit.record({ kind: 'task', tool: 'downloads.organize', reason, error: err.message });
    say(`呜……归档失败了：${err.message}。对不起主人，我再试一次。`, 'fluster', { tool: 'downloads.organize' });
    throw err;
  }
}

/* ---------------- 消息处理 ---------------- */

hub.on('hello', (msg, ws) => {
  log('外壳已接入:', msg.shell || 'unknown');
  hub.safeSend(ws, {
    type: 'status',
    version: require('../../package.json').version,
    allowLevel: config.allowLevel,
    downloadsDir: config.downloadsDir,
    tools: tools.list(),
    todayOrganized: lastDailyKey === todayKey(),
  });
  if (!greetingDone) {
    greetingDone = true;
    const g = persona.line('greet');
    setTimeout(() => say(g.text, g.mood), 1200);
  }
});

hub.on('idle', (msg) => {
  const seconds = Number(msg.seconds || 0);
  const threshold = config.idleRemindMinutes * 60;
  const now = Date.now();
  if (seconds >= threshold && now - idleNotifiedAt > 30 * 60 * 1000) {
    idleNotifiedAt = now;
    const w = persona.line('worry');
    say(w.text, w.mood, { tool: 'idle' });
  }
});

hub.on('clipboard', (msg) => {
  const chars = Number(msg.chars || 0);
  const hash = String(msg.hash || '');
  if (chars < config.clipboardMinChars || hash === lastClipHash) return;
  lastClipHash = hash;
  say(`主人，剪贴板里有一段 ${chars} 字的内容。需要我帮您总结吗？`, 'happy', { tool: 'clipboard' });
});

hub.on('cmd', async (msg, ws) => {
  const name = String(msg.cmd || '');
  try {
    if (name === 'organize') {
      const res = await runOrganize('手动');
      hub.safeSend(ws, { type: 'ack', cmd: name, ok: true, moved: res.moved });
    } else if (name === 'scan') {
      const res = await tools.execute('downloads.scan', {}, ctx);
      hub.safeSend(ws, { type: 'ack', cmd: name, ok: true, result: res });
    } else if (name === 'say') {
      say(String(msg.text || ''), msg.mood || 'happy', { tool: 'manual' });
      hub.safeSend(ws, { type: 'ack', cmd: name, ok: true });
    } else if (name === 'status') {
      hub.safeSend(ws, { type: 'ack', cmd: name, ok: true, allowLevel: config.allowLevel, clients: hub.size });
    } else {
      hub.safeSend(ws, { type: 'ack', cmd: name, ok: false, error: '未知命令' });
    }
  } catch (err) {
    hub.safeSend(ws, { type: 'ack', cmd: name, ok: false, error: err.message });
  }
});

/* ---------------- 启动与退出 ---------------- */

startTicker();
startWatch();

log(`内核已启动：127.0.0.1:${config.port}，权限上限 L${config.allowLevel}`);
log(`监视目录：${config.downloadsDir}`);

let shutdownTimer = null;
const isChild = process.env.CORE_PARENT === '1';
setInterval(() => {
  if (!isChild) return;
  if (hub.size === 0) {
    if (!shutdownTimer) shutdownTimer = setTimeout(() => process.exit(0), 120_000);
  } else if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}, 10_000).unref?.();

function shutdown() {
  try {
    hub.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
