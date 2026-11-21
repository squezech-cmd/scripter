// ============================================================
// GUILTY AS SOCK! — Scripter Edition • EXE (Electron)
// HTTPS-сервер игры + окно. Микрофон в окне работает (certificate bypass для localhost).
// Друзья подключаются к залу хоста по ссылке https://<IP>:порт/juror.html
// ============================================================
import { app, BrowserWindow, Menu, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../server/room-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preferredPort = process.env.GAS_PORT ? Number(process.env.GAS_PORT) : 8787;

let server = null;

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

function allowLocalCertificate(){
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const host = request.host || '';
    // Свой самоподписанный сертификат для localhost/127.0.0.1 — принимаем молча
    if(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')){
      callback(0); // success
      return;
    }
    callback(-3); // остальное — поведение Chromium по умолчанию
  });
  // Микрофон для войс-чата: явно разрешаем media для локального окна игры,
  // всё остальное — как решит ОС/пользователь (по умолчанию — запрещаем).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    try {
      const host = new URL(webContents.getURL() || '').hostname;
      const local = host === 'localhost' || host === '127.0.0.1';
      if(local && (permission === 'media' || permission === 'mediaKeySystem' || permission === 'audioCapture' || permission === 'microphone')){
        callback(true);
        return;
      }
    } catch(e) { /* ignore */ }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    try {
      const host = new URL(webContents.getURL() || '').hostname;
      const local = host === 'localhost' || host === '127.0.0.1';
      return local && (permission === 'media' || permission === 'audioCapture' || permission === 'microphone');
    } catch(e) { return false; }
  });
}

async function createWindow(){
  allowLocalCertificate();
  server = await startGameServer();
  const scheme = server.scheme;
  const port = server.server.address().port;
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
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
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('certificate-error', (event, url, error, cert, callback) => {
    try {
      const h = new URL(url).hostname;
      if(h === 'localhost' || h === '127.0.0.1'){ event.preventDefault(); callback(true); return; }
    } catch(e){ /* ignore */ }
    callback(false);
  });
  win.loadURL(`${scheme}://127.0.0.1:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Внешние ссылки — в системный браузер, не в окно игры
    if(/^https?:\/\//.test(url) && !url.includes(`127.0.0.1:${port}`) && !url.includes(`localhost:${port}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
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
