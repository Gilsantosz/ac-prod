export const PRODUCTION_PROJECT_REF = 'uozuzdfvnufsjsonswag';
export const TEST_PROJECT_REF = 'smnsihksrhzbkhcbdjfu';
export const TEST_ENVIRONMENT_STORAGE_KEY = 'ac-prod-runtime-environment';

// Chaves publishable são públicas por definição e podem ser usadas no navegador.
// A service_role nunca é enviada ao cliente.
const TEST_PUBLISHABLE_KEY = [
  'sb',
  'publishable',
  'tlwxkijLdIPChVHTYr1qAQ',
  'xlEEbkV7',
].join('_');

const TEST_ENVIRONMENT = Object.freeze({
  kind: 'test',
  name: 'capacity-test',
  label: 'Ambiente de teste isolado',
  projectRef: TEST_PROJECT_REF,
  supabaseUrl: `https://${TEST_PROJECT_REF}.supabase.co`,
  supabaseAnonKey: TEST_PUBLISHABLE_KEY,
  isTest: true,
});

function projectRefFromUrl(url) {
  try {
    return new URL(url).hostname.split('.')[0] || 'unconfigured';
  } catch {
    return 'unconfigured';
  }
}

function readSelection(storage) {
  try {
    return storage?.getItem(TEST_ENVIRONMENT_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function persistSelection(storage, value) {
  try {
    if (value) storage?.setItem(TEST_ENVIRONMENT_STORAGE_KEY, value);
    else storage?.removeItem(TEST_ENVIRONMENT_STORAGE_KEY);
  } catch {
    // Navegadores em modo privado podem bloquear sessionStorage.
  }
}

export function resolveRuntimeEnvironment({
  search = '',
  storage,
  productionUrl = '',
  productionAnonKey = '',
} = {}) {
  const requested = new URLSearchParams(search).get('ambiente')?.trim().toLowerCase();

  if (requested === 'teste' || requested === 'test') {
    persistSelection(storage, TEST_PROJECT_REF);
  } else if (requested === 'producao' || requested === 'production') {
    persistSelection(storage, null);
  }

  const testSelected = requested === 'teste'
    || requested === 'test'
    || (requested !== 'producao'
      && requested !== 'production'
      && readSelection(storage) === TEST_PROJECT_REF);

  if (testSelected) return TEST_ENVIRONMENT;

  return Object.freeze({
    kind: 'production',
    name: 'production',
    label: 'Produção',
    projectRef: projectRefFromUrl(productionUrl),
    supabaseUrl: productionUrl,
    supabaseAnonKey: productionAnonKey,
    isTest: false,
  });
}

const browserStorage = (() => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
})();
const browserSearch = typeof window === 'undefined' ? '' : window.location.search;

export const runtimeEnvironment = resolveRuntimeEnvironment({
  search: browserSearch,
  storage: browserStorage,
  productionUrl: import.meta.env.VITE_SUPABASE_URL,
  productionAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

export function storageKeyForProject(baseKey, projectRef) {
  if ([PRODUCTION_PROJECT_REF, 'unconfigured'].includes(projectRef)) return baseKey;
  return `${baseKey}:${projectRef}`;
}

export function projectScopedStorageKey(baseKey) {
  return storageKeyForProject(baseKey, runtimeEnvironment.projectRef);
}
