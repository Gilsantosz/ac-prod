import { ipcMain, BrowserWindow } from 'electron';

export function registerPrintingIpcHandlers() {
  // Impressão da página/etiqueta atual com diálogo controlado
  ipcMain.handle('leo-flow:printing:print-current-page', async (event, options?: { silent?: boolean; printBackground?: boolean; deviceName?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;

    return new Promise((resolve) => {
      win.webContents.print(
        {
          silent: options?.silent || false,
          printBackground: options?.printBackground ?? true,
          deviceName: options?.deviceName || ''
        },
        (success, failureReason) => {
          if (!success) {
            console.warn('[Printing] Falha ao imprimir:', failureReason);
          }
          resolve(success);
        }
      );
    });
  });
}
