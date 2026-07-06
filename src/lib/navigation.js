/**
 * Leo Flow — Navigation Helpers
 *
 * Centraliza redirecionamentos para garantir que o basename seja
 * dinâmico, tanto no dev local (/) quanto em produção/GitHub Pages (/ac-prod/).
 */

export const getAppBase = () => {
  const base = import.meta.env.BASE_URL || '/';
  return base === '/' ? '' : base.replace(/\/$/, '');
};

export const appPath = (path = '/') => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${getAppBase()}${cleanPath}`;
};

export const appUrl = (path = '/') => {
  return `${window.location.origin}${appPath(path)}`;
};

export const navTo = (path = '/') => {
  window.location.replace(appPath(path));
};

