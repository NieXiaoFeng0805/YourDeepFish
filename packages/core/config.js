'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const LOG_DIR = path.join(DATA_DIR, 'logs');
for (const dir of [DATA_DIR, LOG_DIR]) fs.mkdirSync(dir, { recursive: true });

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  port: 45871,
  allowLevel: 1,           // L0 只读 / L1 本地写入 / L2 执行命令 / L3 对外发送
  petName: '小肥鱼',
  downloadsDir: path.join(os.homedir(), 'Downloads'),
  archiveDir: '_小肥鱼归档',
  dailyOrganize: '09:00',
  idleRemindMinutes: 20,
  clipboardMinChars: 800,
  muted: false,
};

function loadConfig() {
  let cfg = { ...DEFAULTS };
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    /* 首次运行 */
  }
  // 测试用覆盖，避免动到真实下载目录
  if (process.env.CORE_DOWNLOADS) cfg.downloadsDir = process.env.CORE_DOWNLOADS;
  if (process.env.CORE_PORT) cfg.port = Number(process.env.CORE_PORT);
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { ROOT, DATA_DIR, LOG_DIR, CONFIG_PATH, DEFAULTS, loadConfig, saveConfig };
