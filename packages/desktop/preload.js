'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  hit: (opaque) => ipcRenderer.send('hit:set', opaque),
  dragStart: (p) => ipcRenderer.send('drag:start', p),
  dragMove: (p) => ipcRenderer.send('drag:move', p),
  dragEnd: (v) => ipcRenderer.send('drag:end', v),
  menu: () => ipcRenderer.send('menu:show'),
  pat: () => ipcRenderer.send('pet:pat'),
  line: (category) => ipcRenderer.invoke('persona:line', category),
  onSay: (cb) => ipcRenderer.on('pet:say', (_e, d) => cb(d)),
  onLand: (cb) => ipcRenderer.on('pet:land', (_e, d) => cb(d)),
  onDrag: (cb) => ipcRenderer.on('pet:drag', (_e, d) => cb(d)),
  onMood: (cb) => ipcRenderer.on('pet:mood', (_e, d) => cb(d)),
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, d) => cb(d)),
});

contextBridge.exposeInMainWorld('consoleAPI', {
  get: () => ipcRenderer.invoke('console:get'),
  save: (cfg) => ipcRenderer.invoke('console:save', cfg),
  plugin: (enable) => ipcRenderer.invoke('console:plugin', enable),
  pickDir: () => ipcRenderer.invoke('console:pickDir'),
  petVisible: (visible) => ipcRenderer.send('pet:visible', visible),
});
