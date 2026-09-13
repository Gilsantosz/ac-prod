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
export function shouldEnableGlobalProductionRealtime(pathname) {
  return normalizePathname(pathname) !== '/coleta';
}
