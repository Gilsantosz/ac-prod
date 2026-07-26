import { contextBridge, ipcRenderer } from 'electron';

// Exposição segura de API para o frontend através de contextBridge
const leoFlowApi = {
  isElectron: true,
  app: {
    getVersion: () => ipcRenderer.invoke('leo-flow:app:get-version')
  },
  window: {
    minimize: () => ipcRenderer.invoke('leo-flow:window:minimize'),
    maximize: () => ipcRenderer.invoke('leo-flow:window:maximize'),
    close: () => ipcRenderer.invoke('leo-flow:window:close'),
    isMaximized: () => ipcRenderer.invoke('leo-flow:window:is-maximized'),
    toggleKiosk: (enable?: boolean) => ipcRenderer.invoke('leo-flow:window:toggle-kiosk', enable)
  },
  files: {
    selectImportFile: (options?: any) => ipcRenderer.invoke('leo-flow:files:select-import-file', options),
    selectExportLocation: (options?: any) => ipcRenderer.invoke('leo-flow:files:select-export-location', options)
  },
  printing: {
    printCurrentPage: (options?: any) => ipcRenderer.invoke('leo-flow:printing:print-current-page', options)
  },
  system: {
    openLogs: () => ipcRenderer.invoke('leo-flow:system:open-logs')
  }
};

export type LeoFlowApi = typeof leoFlowApi;

contextBridge.exposeInMainWorld('leoFlow', leoFlowApi);
