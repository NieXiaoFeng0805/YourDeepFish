'use strict';
const { WebSocketServer } = require('ws');

class Hub {
  constructor(port) {
    this.clients = new Set();
    this.handlers = new Map();
    this.wss = new WebSocketServer({ host: '127.0.0.1', port });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.wss.on('error', (err) => console.error('[hub] 服务异常:', err.message));
  }

  onConnection(ws) {
    this.clients.add(ws);
    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      const handler = this.handlers.get(msg.type);
      if (!handler) return;
      Promise.resolve(handler(msg, ws)).catch((err) => {
        console.error('[hub] 处理失败:', msg.type, err.message);
      });
    });
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
    this.safeSend(ws, { type: 'welcome', ts: Date.now() });
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  safeSend(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  get size() {
    return this.clients.size;
  }

  close() {
    for (const client of this.clients) client.terminate();
    this.wss.close();
  }
}

module.exports = { Hub };
