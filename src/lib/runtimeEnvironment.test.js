import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_PROJECT_REF,
  TEST_ENVIRONMENT_STORAGE_KEY,
  TEST_PROJECT_REF,
  resolveRuntimeEnvironment,
  storageKeyForProject,
} from '@/lib/runtimeEnvironment';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const production = {
  productionUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
  productionAnonKey: 'production-public-key',
};

describe('runtimeEnvironment', () => {
  it('mantém produção como ambiente padrão', () => {
    const selected = resolveRuntimeEnvironment({ ...production, storage: memoryStorage() });

    expect(selected).toMatchObject({
      kind: 'production',
      projectRef: PRODUCTION_PROJECT_REF,
      supabaseAnonKey: 'production-public-key',
    });
  });

  it('seleciona e persiste a branch isolada pela URL de teste', () => {
    const storage = memoryStorage();
    const selected = resolveRuntimeEnvironment({
      ...production,
      search: '?ambiente=teste',
      storage,
    });

    expect(selected).toMatchObject({
      kind: 'test',
      name: 'capacity-test',
      projectRef: TEST_PROJECT_REF,
      isTest: true,
    });
    expect(storage.getItem(TEST_ENVIRONMENT_STORAGE_KEY)).toBe(TEST_PROJECT_REF);
    expect(selected.supabaseAnonKey).toMatch(/^sb_publishable_/);
  });

  it('mantém o teste durante a navegação na mesma aba', () => {
    const storage = memoryStorage();
    storage.setItem(TEST_ENVIRONMENT_STORAGE_KEY, TEST_PROJECT_REF);

    expect(resolveRuntimeEnvironment({ ...production, storage }).isTest).toBe(true);
  });

  it('volta explicitamente para produção e remove a seleção temporária', () => {
    const storage = memoryStorage();
    storage.setItem(TEST_ENVIRONMENT_STORAGE_KEY, TEST_PROJECT_REF);
    const selected = resolveRuntimeEnvironment({
      ...production,
      search: '?ambiente=producao',
      storage,
    });

    expect(selected.kind).toBe('production');
    expect(storage.getItem(TEST_ENVIRONMENT_STORAGE_KEY)).toBeNull();
  });

  it('continua operando quando o armazenamento do navegador está bloqueado', () => {
    const blockedStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };

    expect(resolveRuntimeEnvironment({
      ...production,
      search: '?ambiente=teste',
      storage: blockedStorage,
    }).isTest).toBe(true);
  });

  it('isola sessões e filas do teste sem renomear o armazenamento de produção', () => {
    expect(storageKeyForProject('acprod_collection_queue', PRODUCTION_PROJECT_REF))
      .toBe('acprod_collection_queue');
    expect(storageKeyForProject('acprod_collection_queue', TEST_PROJECT_REF))
      .toBe(`acprod_collection_queue:${TEST_PROJECT_REF}`);
  });
});
