import { ipcMain, dialog, BrowserWindow } from 'electron';

export function registerFilesIpcHandlers() {
  // Diálogo nativo para seleção de arquivo de importação (.csv, .xlsx, .xls, .xml)
  ipcMain.handle('leo-flow:files:select-import-file', async (event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const defaultFilters = [
      { name: 'Arquivos de Produção/Lotes (*.csv, *.xlsx, *.xls, *.xml)', extensions: ['csv', 'xlsx', 'xls', 'xml'] },
      { name: 'Planilhas Excel (*.xlsx, *.xls)', extensions: ['xlsx', 'xls'] },
      { name: 'Arquivos CSV (*.csv)', extensions: ['csv'] },
      { name: 'Arquivos XML (*.xml)', extensions: ['xml'] },
      { name: 'Todos os Arquivos', extensions: ['*'] }
    ];

    const result = await dialog.showOpenDialog(win, {
      title: 'Selecionar Arquivo para Importação',
      properties: ['openFile'],
      filters: options?.filters || defaultFilters
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Diálogo nativo para escolher local de exportação (.pdf, .xlsx, .csv)
  ipcMain.handle('leo-flow:files:select-export-location', async (event, options?: { defaultName?: string; defaultExtension?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;

    const ext = options?.defaultExtension || 'xlsx';
    const result = await dialog.showSaveDialog(win, {
      title: 'Salvar Exportação de Relatório',
      defaultPath: options?.defaultName || `relatorio_leoflow_${Date.now()}.${ext}`,
      filters: [
        { name: 'Planilha Excel (*.xlsx)', extensions: ['xlsx'] },
        { name: 'Documento PDF (*.pdf)', extensions: ['pdf'] },
        { name: 'Arquivo CSV (*.csv)', extensions: ['csv'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath;
  });
}
