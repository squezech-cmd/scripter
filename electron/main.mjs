// ============================================================
// GUILTY AS SOCK! — Scripter Edition • EXE (Electron)
// Поднимает локальный сервер игры + зал онлайн и открывает окно.
// Друзья подключаются к залу хоста по ссылке http://<IP>:порт/juror.html
// ============================================================
import { app, BrowserWindow, Menu, shell } from 'electron';
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

async function createWindow(){
  server = await startGameServer();
  const port = server.server.address().port;
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    title: 'GUILTY AS SOCK! — Scripter Edition',
    backgroundColor: '#0a0914',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Внешние ссылки — в системный браузер, не в окно игры
    if(/^https?:\/\//.test(url) && !url.includes(`127.0.0.1:${port}`)) shell.openExternal(url);
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
