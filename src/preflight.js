// Rotinas que precisam acontecer antes da montagem do React.
const MANIFEST_VERSION = '1.4.3-security-hardening';
const storedVersion = localStorage.getItem('lf_manifest_version');

if (storedVersion !== MANIFEST_VERSION) {
  localStorage.setItem('lf_manifest_version', MANIFEST_VERSION);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => {
        if ('caches' in window) {
          return caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name))));
        }
        return undefined;
      })
      .then(() => {
        if (storedVersion) window.location.reload();
      })
      .catch((error) => console.warn('[Leo Flow] Não foi possível limpar o cache antigo.', error));
  }
}

// SPA Routing: decodifica o redirecionamento produzido pelo 404.html do GitHub Pages.
const locationRef = window.location;
if (locationRef.search[1] === '/') {
  const decoded = locationRef.search.slice(1).split('&')
    .map((part) => part.replace(/~and~/g, '&'))
    .join('?');
  window.history.replaceState(
    null,
    '',
    locationRef.pathname.slice(0, -1) + decoded + locationRef.hash,
  );
}

const redirect = sessionStorage.getItem('redirect');
sessionStorage.removeItem('redirect');
if (redirect && redirect !== window.location.href) {
  try {
    const redirectUrl = new URL(redirect, window.location.origin);
    if (redirectUrl.origin === window.location.origin) {
      window.history.replaceState(null, '', redirectUrl.href);
    }
  } catch {
    // Redirecionamentos inválidos são ignorados.
  }
}
