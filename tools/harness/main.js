'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const OUT = path.join(__dirname, '..', 'build', 'plugin_harness.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420,
    height: 360,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: false, nodeIntegration: false },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[page]', message);
  });
  await win.loadFile(path.join(__dirname, 'harness.html'));
  await new Promise((r) => setTimeout(r, 1800));
  const info = await win.webContents.executeJavaScript(
    'JSON.stringify({ hasComp: !!window.__petComponent, rootHtml: document.getElementById("root").innerHTML.length })',
  );
  console.log('[harness] page state', info);
  const img = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, img.toPNG());
  console.log('[harness] saved', OUT, img.getSize());
  app.quit();
});
