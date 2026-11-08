'use strict';
/**
 * 内核冒烟测试：在沙箱目录里验证「监视 → 整理 → 审计」闭环。
 * 运行：node tools/smoke.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const SANDBOX = path.join(ROOT, 'build', 'smoke-downloads');
const PORT = 45872;

function reset() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  fs.mkdirSync(SANDBOX, { recursive: true });
  const files = [
    ['报告.pdf', 1024],
    ['截图.png', 2048],
    ['安装包.exe', 4096],
    ['说明.txt', 512],
  ];
  const old = Date.now() / 1000 - 3600;
  for (const [name, size] of files) {
    const file = path.join(SANDBOX, name);
    fs.writeFileSync(file, Buffer.alloc(size, 1));
    fs.utimesSync(file, old, old);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  reset();
  fs.mkdirSync(path.join(ROOT, 'data', 'logs'), { recursive: true });

  const core = spawn(process.execPath, [path.join(ROOT, 'core', 'index.js')], {
    env: { ...process.env, CORE_DOWNLOADS: SANDBOX, CORE_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  core.stdout.on('data', (d) => process.stdout.write(`[core] ${d}`));
  core.stderr.on('data', (d) => process.stderr.write(`[core!] ${d}`));

  await wait(700);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const inbox = [];
  ws.on('message', (buf) => inbox.push(JSON.parse(buf.toString())));

  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  ws.send(JSON.stringify({ type: 'hello', shell: 'smoke' }));
  await wait(600);
  const status = inbox.find((m) => m.type === 'status');
  console.log('状态回执:', status ? `L${status.allowLevel}, ${status.tools.length} 个工具` : '缺失');

  ws.send(JSON.stringify({ type: 'cmd', cmd: 'scan' }));
  await wait(500);
  const scanAck = inbox.find((m) => m.type === 'ack' && m.cmd === 'scan');
  console.log('扫描:', scanAck?.result ? `${scanAck.result.total} 个文件` : '失败');

  ws.send(JSON.stringify({ type: 'cmd', cmd: 'organize' }));
  await wait(800);
  const ack = inbox.find((m) => m.type === 'ack' && m.cmd === 'organize');
  console.log('整理回执:', JSON.stringify(ack));

  const happyDir = path.join(SANDBOX, '_小肥鱼归档');
  const moved = fs.existsSync(happyDir)
    ? fs.readdirSync(happyDir, { recursive: true }).filter((f) => path.extname(f))
    : [];
  console.log('归档目录内容:', moved.join(', ') || '(空)');

  const say = inbox.filter((m) => m.type === 'say').map((m) => m.text);
  console.log('气泡消息:', say.length ? say.join(' | ') : '(无)');

  const audit = path.join(ROOT, 'data', 'logs', 'audit.jsonl');
  const lines = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  console.log('审计行数:', lines);

  ws.close();
  core.kill();
  await wait(300);
  const ok = moved.length === 4;
  console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});
