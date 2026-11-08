'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LOG_DIR } = require('./config');

const FILE = path.join(LOG_DIR, 'audit.jsonl');

function record(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    fs.appendFileSync(FILE, line + '\n', 'utf8');
  } catch (err) {
    console.error('[audit] 写入失败:', err.message);
  }
  return entry;
}

module.exports = { record, FILE };
