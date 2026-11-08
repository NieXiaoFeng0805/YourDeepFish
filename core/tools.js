'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = [
  ['图片', ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.tif', '.tiff']],
  ['文档', ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.csv']],
  ['压缩包', ['.zip', '.rar', '.7z', '.tar', '.gz']],
  ['音视频', ['.mp3', '.wav', '.flac', '.mp4', '.mkv', '.mov', '.avi']],
  ['安装包', ['.exe', '.msi', '.dmg', '.apk', '.pkg']],
  ['代码', ['.js', '.ts', '.py', '.json', '.html', '.css', '.java', '.go', '.rs', '.cs']],
];

function categoryOf(name) {
  const ext = path.extname(name).toLowerCase();
  for (const [cat, exts] of CATEGORIES) if (exts.includes(ext)) return cat;
  return '其他';
}

function listDownloads(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    files.push({ name: ent.name, size: st.size, mtime: st.mtimeMs, category: categoryOf(ent.name) });
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(candidate)) candidate = path.join(dir, `${stem} (${i++})${ext}`);
  return candidate;
}

const registry = new Map();

function register(tool) {
  if (!tool || !tool.name) throw new Error('tool.name 必填');
  const full = { level: 0, description: '', args: {}, ...tool };
  registry.set(full.name, full);
  return full;
}

function list() {
  return [...registry.values()].map(({ name, level, description, args }) => ({ name, level, description, args }));
}

register({
  name: 'sys.time',
  level: 0,
  description: '读取当前时间',
  run: () => ({
    iso: new Date().toISOString(),
    local: new Date().toLocaleString('zh-CN', { hour12: false }),
  }),
});

register({
  name: 'downloads.scan',
  level: 0,
  description: '扫描下载目录，按类型统计',
  run: (ctx, args) => {
    const dir = args.dir || ctx.config.downloadsDir;
    const files = listDownloads(dir);
    const byCat = {};
    for (const f of files) byCat[f.category] = (byCat[f.category] || 0) + 1;
    return {
      dir,
      total: files.length,
      byCategory: byCat,
      recent: files.slice(0, 10).map((f) => ({ name: f.name, size: f.size, category: f.category })),
    };
  },
});

register({
  name: 'downloads.organize',
  level: 1,
  description: '把下载目录里 10 分钟以上未改动的文件按类型移入归档子目录（只移动，不删除）',
  args: { dryRun: 'boolean' },
  run: (ctx, args) => {
    const dir = args.dir || ctx.config.downloadsDir;
    const archive = path.join(dir, ctx.config.archiveDir);
    const cutoff = Date.now() - 10 * 60 * 1000;
    const files = listDownloads(dir).filter((f) => f.mtime < cutoff && !/^~\$/.test(f.name));
    const plan = files.map((f) => ({ from: path.join(dir, f.name), to: path.join(archive, f.category, f.name), category: f.category }));

    if (args.dryRun) return { dryRun: true, count: plan.length, plan: plan.slice(0, 20) };

    const moves = [];
    for (const item of plan) {
      fs.mkdirSync(path.dirname(item.to), { recursive: true });
      const target = uniquePath(path.dirname(item.to), path.basename(item.to));
      try {
        fs.renameSync(item.from, target);
        moves.push({ from: item.from, to: target, ok: true });
      } catch (err) {
        moves.push({ from: item.from, to: target, ok: false, error: err.message });
      }
    }
    const manifest = path.join(ctx.logsDir, `moves-${Date.now()}.json`);
    fs.writeFileSync(manifest, JSON.stringify({ at: new Date().toISOString(), moves }, null, 2), 'utf8');
    return { dryRun: false, moved: moves.filter((m) => m.ok).length, failed: moves.filter((m) => !m.ok).length, manifest };
  },
});

register({
  name: 'notes.append',
  level: 1,
  description: '往小肥鱼的便签文件追加一行',
  args: { text: 'string' },
  run: (ctx, args) => {
    const text = String(args.text || '').trim();
    if (!text) throw new Error('text 不能为空');
    const file = path.join(ctx.dataDir, 'notes.md');
    const line = `- ${new Date().toLocaleString('zh-CN', { hour12: false })} ${text}\n`;
    fs.appendFileSync(file, line, 'utf8');
    return { file, appended: line.trim() };
  },
});

register({
  name: 'clipboard.inspect',
  level: 0,
  description: '对剪贴板文本做只读统计',
  args: { text: 'string' },
  run: (ctx, args) => {
    const text = String(args.text || '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
    const urls = (text.match(/https?:\/\/[^\s)]+/g) || []).length;
    return { chars: text.length, lines, urls, preview: text.slice(0, 40) };
  },
});

async function execute(name, args, ctx) {
  const tool = registry.get(name);
  if (!tool) throw new Error(`未知工具：${name}`);
  if (tool.level > ctx.config.allowLevel) {
    const err = new Error(`权限不足：${name} 需要 L${tool.level}，当前上限 L${ctx.config.allowLevel}`);
    err.code = 'E_PERMISSION';
    throw err;
  }
  return tool.run(ctx, args || {});
}

module.exports = { register, list, execute, registry };
