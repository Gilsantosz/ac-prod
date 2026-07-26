import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { setupNavigationSecurity } from './security/navigation-policy';
import { registerSystemIpcHandlers } from './ipc/system';
import { registerFilesIpcHandlers } from './ipc/files';
import { registerPrintingIpcHandlers } from './ipc/printing';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

// Garantir instância única do aplicativo
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Registrar manipuladores IPC nativos
    registerSystemIpcHandlers();
    registerFilesIpcHandlers();
    registerPrintingIpcHandlers();

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

function getAppIconPath() {
  const buildDir = path.join(app.getAppPath(), 'build');
  if (process.platform === 'win32') {
    return path.join(buildDir, 'icon.ico');
  } else if (process.platform === 'darwin') {
    return path.join(buildDir, 'icon.icns');
  }
  return path.join(buildDir, 'icon.png');
}

function createMainWindow() {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Leo Flow — Controle de Produção',
    icon: iconPath,
    backgroundColor: '#043820', // Verde escuro da marca Leo Flow
    show: false,
    frame: process.platform === 'darwin', // Frame nativo em macOS, sem barra padrão em Win32 se custom titlebar for ativada
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  // Remover menu superior padrão em produção
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  // Configurar políticas de segurança e abertura de links
  setupNavigationSecurity(mainWindow.webContents, isDev, devServerUrl);

  // Carregar aplicação de acordo com o ambiente
  if (isDev) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Em produção, carregar o dist/index.html empacotado
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.maximize();
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Fechar todas as janelas no Windows/Linux
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
