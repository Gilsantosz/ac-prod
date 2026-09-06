import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { withCollectionQueueLock } from '@/hooks/useCollectionQueue';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 collection fast8 v8.5 contract', () => {
  it('dispara a leitura no oitavo dígito sem debounce', () => {
    const scanner = repoFile('src/components/traceability/TraceabilityScannerPanel.jsx');

    expect(scanner).toContain("if (mode === 'scanner' && parsed.valid)");
    expect(scanner).toContain("setValue('')");
    expect(scanner).toContain('Promise.resolve(onRead');
    expect(scanner).toContain('fastPath: true');
    expect(scanner).toContain('exactDigitCapture: true');
    expect(scanner).not.toContain('autoSubmitTimer');
    expect(scanner).not.toContain('setTimeout(() => submitInput(), 160)');
  });

  it('limita o código produtivo a exatamente 8 dígitos e preserva zeros', () => {
    const rules = repoFile('src/lib/productionScanCode.js');
    const input = repoFile('src/components/traceability/ProductionTagInput.jsx');

    expect(rules).toContain('PRODUCTION_SCAN_LENGTH = 8');
    expect(rules).toContain('PRODUCTION_SCAN_PATTERN = /^\\d{8}$/');
    expect(rules).toContain('preservando zeros à esquerda');
    expect(input).toContain('09950001');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('disparada automaticamente');
  });

  it('usa uma única RPC no caminho rápido e não faz pré-consulta de contexto', () => {
    const service = repoFile('src/lib/fastProductionReadingService.js');
    const dispatcher = repoFile('src/lib/collectionEventDispatcher.js');

    expect(service).toContain("supabase.rpc('process_production_reading'");
    expect(service).not.toContain('resolveProductionContext');
    expect(service).not.toContain('productionContextToEntryFields');
    expect(dispatcher).toContain('processFastProductionReading');
    expect(dispatcher).toContain('event.fastPath === true');
  });

  it('mantém captura durável e exclusão sem fila de promises entre ambientes', async () => {
    const queue = repoFile('src/hooks/useCollectionQueue.js');

    expect(queue).toContain('refreshStatsSafely');
    expect(queue).toContain('const id = await enqueueCollectionEvent(payload)');
    expect(queue).toContain('operator_session_id');
    expect(queue).not.toContain('operatorSessionToken = payload');
    expect(queue).toContain('não bloqueia o próximo código');

    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    let release;
    let duplicateRan = false;
    const held = withCollectionQueueLock(() => new Promise((resolve) => { release = resolve; }), 'sync', 'contract-test');
    try {
      expect(await withCollectionQueueLock(() => { duplicateRan = true; }, 'sync', 'contract-test')).toBeNull();
      expect(duplicateRan).toBe(false);
      expect(await withCollectionQueueLock(() => 'production-free', 'sync', 'contract-production')).toBe('production-free');
      release('test-finished');
      expect(await held).toBe('test-finished');
      expect(await withCollectionQueueLock(() => 'next-flush', 'sync', 'contract-test')).toBe('next-flush');
    } finally {
      release();
      await held;
      Object.defineProperty(navigator, 'locks', { configurable: true, value: originalLocks });
    }
  });

  it('versiona o contrato do banco e impede deploy incompatível', () => {
    const migration = 'supabase/migrations/20260831150725_collection_exact_8_digit_fast_capture_v8_5.sql';
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(existsSync(resolve(process.cwd(), migration))).toBe(true);
    expect(repoFile(migration)).toContain('normalize_collection_scan_code');
    expect(repoFile(migration)).toContain('INVALID_CODE_LENGTH');
    expect(repoFile(migration)).toContain('20260831_acprod_collection_fast8_v8_5');
    expect(workflow).toContain('REQUIRED_MIGRATION_VERSION: "20260831150725"');
    expect(workflow).toContain('REQUIRED_RELEASE_VERSION: "20260831_acprod_collection_fast8_v8_5"');
    expect(workflow).toContain('collection_exact_8_digit_scan');
    expect(workflow).toContain('collection_active_tags_8_digits');
  });

  it('autoriza a captura de câmera/RFID antes de enfileirar sem renovar sessão por resposta do servidor', () => {
    const page = repoFile('src/pages/TraceabilityCollection.jsx');
    const capture = page.slice(page.indexOf('const handleRead = useCallback'), page.indexOf('// Aberturas de modais operacionais'));
    expect(capture).toContain('if (!requestSessionActivity())');
    expect(capture.indexOf('if (!requestSessionActivity())')).toBeLessThan(capture.indexOf('await enqueue('));
    expect(capture).toContain("status: 'session_expired'");
    expect(page).not.toContain('recordSessionActivity');
  });
});
