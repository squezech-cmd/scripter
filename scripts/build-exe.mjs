// ============================================================
// Сборка EXE-версии игры (Electron packager).
//   node scripts/build-exe.mjs [--platform=win32|linux|darwin] [--arch=x64|arm64]
// По умолчанию: win32 + x64 → release/GUILTY AS SOCK - Scripter Edition-win32-x64/
// На Windows нужен установленный Node.js; интернет нужен один раз (скачать Electron).
// ============================================================
import packager from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));

const platform = args.platform || 'win32';
const arch = args.arch || 'x64';
const name = 'GUILTY AS SOCK - Scripter Edition';
const iconIco = path.join(root, 'build', 'icon.ico');

const options = {
  dir: root,
  out: path.join(root, 'release'),
  name,
  platform,
  arch,
  overwrite: true,
  prune: true,               // убираем devDependencies, оставляем runtime (ws)
  icon: fs.existsSync(iconIco) ? iconIco : undefined,
  appVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  appCopyright: 'GUILTY AS SOCK! — Scripter Edition • squezech-cmd',
  // В EXE не тащим лишнее (тесты, CI, скрипты сборки, сам Electron)
  ignore: [
    /^\/\.git($|\/)/, /^\/\.github($|\/)/, /^\/node_modules\/\.bin($|\/)/,
    /^\/test($|\/)/, /^\/scripts($|\/)/, /^\/release($|\/)/, /^\/build($|\/)/,
    /^\/screenshots?($|\/)/, /\.log$/, /^\/node_modules\/(?!ws($|\/))/,
  ],
};

console.log(`📦 Собираю ${name} под ${platform}/${arch}…`);
const outPaths = await packager(options);
for(const p of outPaths){
  let size = 0;
  const walk = (dir) => { for(const e of fs.readdirSync(dir, { withFileTypes: true })){ const fp = path.join(dir, e.name); if(e.isDirectory()) walk(fp); else size += fs.statSync(fp).size; } };
  try { walk(p); } catch(e){ /* ignore */ }
  console.log(`✅ Готово: ${p} (${(size/1024/1024).toFixed(1)} МБ)`);
}
console.log('\nЗапуск: открой "' + name + '.exe" в папке выше.');
console.log('Друзья в той же Wi-Fi: в игре → 🌐 ИГРАТЬ С ДРУЗЬЯМИ → Создать зал → отправь ссылку и код.');
