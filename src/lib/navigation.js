/**
 * Leo Flow — Navigation Helpers
 *
 * Centraliza redirecionamentos para garantir que o basename /ac-prod/ seja
 * sempre incluído, tanto no dev local (http://localhost:5173/ac-prod/) quanto
 * no GitHub Pages (https://gilsantosz.github.io/ac-prod/).
 *
 * REGRA: Nunca use window.location.href = '/rota' diretamente.
 * Use navigate('/rota') do React Router (preferência) ou navTo('/rota') aqui.
 */

const getBase = () => {
  const base = import.meta.env.BASE_URL || '/ac-prod/';
  return base.replace(/\/$/, ''); // Remove trailing slash
};

/**
 * Redireciona para um caminho dentro do app, incluindo o basename.
 * Equivalente ao window.location.replace() mas com o prefix correto.
 *
 * @param {string} path - ex: '/login', '/', '/dashboard'
 */
export const navTo = (path) => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  window.location.replace(`${getBase()}${cleanPath}`);
};

/**
 * Retorna a URL completa de uma rota do app (útil para redirectTo em OAuth).
 *
 * @param {string} path - ex: '/reset-password'
 * @returns {string} - ex: 'http://localhost:5173/ac-prod/reset-password'
 */
export const appUrl = (path) => {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${window.location.origin}${getBase()}${cleanPath}`;
};
