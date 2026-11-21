// ============================================================
// GUILTY AS SOCK! — Scripter Edition • EXE (Electron)
// HTTPS-сервер игры для друзей по LAN + HTTP-зеркало для локального окна.
// Локальное окно грузится с http://127.0.0.1:<mirrorPort>/ — localhost и так
// secure context (микрофон работает), а TLS-цепочке для своего же окна нечему падать.
// ============================================================
import { app, BrowserWindow, Menu, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/room-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preferredPort = process.env.GAS_PORT ? Number(process.env.GAS_PORT) : 8787;

let server = null;
let win = null;

async function startGameServer(){
  try {
    const s = createGameServer({ root, port: preferredPort, host: '0.0.0.0' });
    await s.start();
    return s;
  } catch (err) {
    if(err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')){
      console.warn(`Порт ${preferredPort} занят — беру свободный…`);
      const s = createGameServer({ root, port: 0, host: '0.0.0.0' });
      await s.start();
      return s;
    }
    throw err;
  }
}

// localhost/127.0.0.1/[::1] — наши самоподписанные сертификаты принимаем молча
const isLocalHost = (s) => {
  const h = String(s || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local');
};

function trustLocalCertificates(){
  // ВНИМАНИЕ: у verify-proc нет поля `host` — только `hostname`.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    try {
      if(isLocalHost(request && request.hostname)) { callback(0); return; }
    } catch(e) { /* ignore */ }
    callback(-3); // остальное — штатная проверка Chromium
  });
  // Страховочная сеть: если главная страница всё же словит ошибку сертификата — доверяем ей.
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    try {
      if(isLocalHost(new URL(url).hostname)) {
        event.preventDefault();
        callback(true);
        return;
      }
    } catch(e) { /* ignore */ }
    callback(false);
  });
  // Микрофон для войс-чата: явно разрешаем media для локального окна игры,
  // остальное — deny (по умолчанию не палим лишнего).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    try {
      const host = new URL(webContents.getURL() || '').hostname;
      if(isLocalHost(host) && (permission === 'media' || permission === 'audioCapture' || permission === 'microphone' || permission === 'mediaKeySystem')){
        callback(true);
        return;
      }
    } catch(e) { /* ignore */ }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    try {
      const host = new URL(webContents.getURL() || '').hostname;
      return isLocalHost(host) && (permission === 'media' || permission === 'audioCapture' || permission === 'microphone');
    } catch(e) { return false; }
  });
}

async function createWindow(){
  trustLocalCertificates();
  server = await startGameServer();
  // Локальному окну нужен только localhost: если сервер с HTTPS — берём HTTP-зеркало;
  // иначе (HTTP-режим) — основной порт. HTTPS друзьям остаётся как был.
  const localPort = server.httpPort || (server.server && server.server.address() ? server.server.address().port : preferredPort);
  const useHttp = !!server.mirrorServer || server.scheme === 'http';
  const gameUrl = `${useHttp ? 'http' : 'https'}://127.0.0.1:${localPort}/`;
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    title: 'GUILTY AS SOCK! — Scripter Edition',
    backgroundColor: '#0a0914',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(root, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', // скрытые <audio> для голосового чата
    },
  });
  // Окно показываем, даже если ready-to-show не дождался (косяк рендерера/драйвера)
  const showTimer = setTimeout(() => { if(win && !win.isDestroyed()){ win.show(); win.focus(); } }, 4000);
  win.once('ready-to-show', () => { clearTimeout(showTimer); win.show(); win.focus(); });
  win.on('closed', () => { win = null; });

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const showFatal = (title, detail) => {
    try {
      if(!win || win.isDestroyed()) return;
      const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Ошибка</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0914;color:#ffd9a0;font-family:system-ui,Segoe UI,Arial,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:34px;margin:0 0 12px}p{color:#b9b3d9;line-height:1.6}code{background:#1c1930;border:1px solid #332f52;border-radius:8px;padding:2px 8px;color:#ffd166}
button{margin-top:18px;font-size:18px;padding:12px 26px;border:0;border-radius:12px;background:#f5c542;color:#231a00;font-weight:800;cursor:pointer}</style></head>
<body><div><div style="font-size:64px">🧦💥</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>
<button onclick="location.reload()">↻ Попробовать снова</button></div></body></html>`;
      win.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    } catch(e) { /* ignore */ }
  };

  // Если игра не загрузилась — никогда не оставляем чёрный экран, показываем причину
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if(!isMainFrame) return;
    if(errorCode === -3) return; // ERR_ABORTED — обычно штатная навигация, не считаем ошибкой
    console.error('[exe] did-fail-load', errorCode, errorDescription, validatedURL);
    showFatal('Игра не открылась', `Код ${errorCode}: ${errorDescription}. Перезапусти приложение или нажми «Попробовать снова».`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[exe] render-process-gone', details && details.reason);
    showFatal('Игра упала', `Рендерер завершился (${details && details.reason || 'unknown'}). Попробуй «Попробовать снова».`);
  });
  win.webContents.on('unresponsive', () => console.error('[exe] renderer unresponsive'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Внешние ссылки — в системный браузер, не в окно игры
    if(/^https?:\/\//.test(url) && !url.includes(`127.0.0.1:${localPort}`) && !url.includes(`localhost:${localPort}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(gameUrl);
}

app.setAppUserModelId('com.squezech.guilty-as-sock');
app.whenReady().then(createWindow).catch(err => {
  console.error('Не удалось запустить игру:', err);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', async () => {
  try { await server?.close(); } catch(e) { /* ignore */ }
});
