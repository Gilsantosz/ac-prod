function normalizePathname(pathname) {
  const rawPath = String(pathname || '/').split(/[?#]/, 1)[0] || '/';
  const withLeadingSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const withoutTrailingSlash = withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, '')
    : withLeadingSlash;
  const normalizedCase = withoutTrailingSlash.toLowerCase();

  if (normalizedCase === '/ac-prod') return '/';
  if (normalizedCase.startsWith('/ac-prod/')) {
    return normalizedCase.slice('/ac-prod'.length) || '/';
  }
  return normalizedCase;
}

/**
 * A estação de coleta já recebe decisões pelo Broadcast privado do dispositivo
 * e da célula, com reconciliação dos recibos. O canal global de todas as tabelas
 * só acrescentaria assinaturas e invalidações duplicadas enquanto ela estiver
 * aberta. As demais páginas continuam com a sincronização global existente.
 */
export function shouldEnableGlobalProductionRealtime(pathname, search = '') {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/coleta'
    || normalizedPath === '/coleta-rastreabilidade'
    || normalizedPath === '/coleta-codigo-rfid') return false;
  if (normalizedPath !== '/entrada') return true;

  // O router fornece search separadamente, inclusive no HashRouter do Electron.
  // Aceita também pathname com query para preservar os chamadores existentes.
  const inlineSearch = String(pathname || '').split('?', 2)[1]?.split('#', 1)[0] || '';
  const mode = new URLSearchParams(search || inlineSearch).get('modo');
  // Espelha Entry.jsx: ausência/vazio, coleta e collection abrem a coleta.
  // Modos manuais (e valores não reconhecidos) mantêm a assinatura global.
  return Boolean(mode) && mode !== 'coleta' && mode !== 'collection';
}
