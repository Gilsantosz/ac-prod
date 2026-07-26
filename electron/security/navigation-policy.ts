import { WebContents, shell } from 'electron';

export function setupNavigationSecurity(contents: WebContents, isDev: boolean, devUrl?: string) {
  // Bloquear abertura de novas janelas/popups e redirecionar links externos para o navegador padrão
  contents.setWindowOpenHandler(({ url }: { url: string }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch (err) {
      console.warn('[Security] Tentativa de abrir URL externa inválida bloqueada:', url);
    }
    return { action: 'deny' };
  });

  // Impedir navegação não autorizada na própria janela principal
  contents.on('will-navigate', (event: any, url: string) => {
    const isAllowedDev = isDev && devUrl && url.startsWith(devUrl);
    const isAllowedLocalFile = url.startsWith('file://');

    if (!isAllowedDev && !isAllowedLocalFile) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          shell.openExternal(url);
        }
      } catch (err) {
        console.warn('[Security] Navegação não autorizada bloqueada:', url);
      }
    }
  });

  // Bloquear atalhos indesejados em produção (DevTools, F12)
  contents.on('before-input-event', (event: any, input: any) => {
    if (!isDev) {
      if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
      }
      if (input.key === 'F12') {
        event.preventDefault();
      }
    }
  });
}
