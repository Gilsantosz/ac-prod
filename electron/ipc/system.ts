import { ipcMain, app, BrowserWindow, shell } from 'electron';
import os from 'os';

export function registerSystemIpcHandlers() {
  // Informações da aplicação e plataforma
  ipcMain.handle('leo-flow:app:get-version', () => {
    return {
      name: 'Leo Flow — Controle de Produção',
      shortName: 'Leo Flow',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      author: 'Gil Santos',
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      osRelease: os.release(),
      totalMem: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB'
    };
  });

  // Controles de Janela
  ipcMain.handle('leo-flow:window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle('leo-flow:window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    } else {
      win.maximize();
      return true;
    }
  });

  ipcMain.handle('leo-flow:window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle('leo-flow:window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  // Modo Operação (Kiosk/Fullscreen seguro)
  ipcMain.handle('leo-flow:window:toggle-kiosk', (event, enable?: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;

    const targetState = enable !== undefined ? enable : !win.isFullScreen();
    win.setFullScreen(targetState);
    return win.isFullScreen();
  });

  // Abrir pasta de logs do aplicativo no Explorer/Finder
  ipcMain.handle('leo-flow:system:open-logs', async () => {
    const logPath = app.getPath('logs');
    await shell.openPath(logPath);
    return logPath;
  });
}
