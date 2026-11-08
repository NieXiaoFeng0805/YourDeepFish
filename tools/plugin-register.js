'use strict';
/**
 * 只改 DSH profile 的 package.json：登记插件依赖与 bundle。
 * 复制文件由 PowerShell 完成（node 的 cpSync 在本机会崩溃，0xC0000409）。
 * 用法: node tools/plugin-register.js on|off|status
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROFILE = path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const PKG = path.join(PROFILE, 'package.json');
const SRC = path.join(__dirname, '..', 'packages', 'plugin-dsh');
const ID = 'dsh-yourdeepfish';

const read = () => JSON.parse(fs.readFileSync(PKG, 'utf8'));
const write = (pkg) => {
  fs.copyFileSync(PKG, PKG + '.bak-yourdeepfish');
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2), 'utf8');
};

const action = process.argv[2] || 'status';
const pkg = read();
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

if (action === 'on') {
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies[ID] = 'file:' + SRC.replace(/\\/g, '/');
  if (!bundles.includes(ID)) bundles.push(ID);
  pkg.dsh.profile.bundles = bundles;
  write(pkg);
} else if (action === 'off') {
  pkg.dsh.profile.bundles = bundles.filter((b) => b !== ID);
  write(pkg);
}

const now = read();
console.log(
  JSON.stringify(
    {
      installed: fs.existsSync(path.join(PROFILE, 'node_modules', ID, 'package.json')),
      enabled: (now.dsh?.profile?.bundles || []).includes(ID),
      bundles: now.dsh?.profile?.bundles || [],
    },
    null,
    2,
  ),
);
