import { describe, it, expect } from 'vitest';
import { detectDuplicateReading } from '../traceabilityService';

describe('Concurrency & Duplicate Detection — Proteção de Coletas Concorrentes', () => {
  it('detecta imediatamente duplicidade quando a mesma peça já possui leitura aprovada na mesma etapa', () => {
    const existingReadings = [
      {
        id: 'reading-1',
        item_id: 'piece-001',
        step_name: 'cut',
        status: 'approved',
        tag_value: 'PCP-001-001',
        created_at: new Date(Date.now() - 5000).toISOString(),
      },
    ];

    const duplicateAttempt = {
      itemId: 'piece-001',
      stepName: 'cut',
      rawValue: 'PCP-001-001',
      readings: existingReadings,
      readerType: 'keyboard_barcode',
      now: Date.now(),
    };

    const check = detectDuplicateReading(duplicateAttempt);
    expect(check.duplicate).toBe(true);
    expect(check.status).toBe('duplicated');
    expect(check.reason).toBe('step_already_approved');
  });

  it('permite a bipagem da mesma peça se for em uma etapa subsequente autorizada', () => {
    const existingReadings = [
      {
        id: 'reading-1',
        item_id: 'piece-001',
        step_name: 'cut',
        status: 'approved',
        tag_value: 'PCP-001-001',
        created_at: new Date(Date.now() - 60000).toISOString(),
      },
    ];

    const nextStepAttempt = {
      itemId: 'piece-001',
      stepName: 'edge', // Borda após corte
      rawValue: 'PCP-001-001',
      readings: existingReadings,
      readerType: 'keyboard_barcode',
      now: Date.now(),
      debounceMs: 2000,
    };

    const check = detectDuplicateReading(nextStepAttempt);
    expect(check.duplicate).toBe(false);
    expect(check.status).toBe('available');
  });

  it('bloqueia leitura rápida em rajada dentro da janela de debounce no mesmo leitor', () => {
    const existingReadings = [
      {
        id: 'reading-2',
        item_id: 'piece-002',
        step_name: 'cnc',
        status: 'in_progress',
        tag_value: 'TAG-RFID-999',
        created_at: new Date(Date.now() - 500).toISOString(), // 500ms atrás
      },
    ];

    const burstAttempt = {
      itemId: 'piece-002',
      stepName: 'cnc',
      rawValue: 'TAG-RFID-999',
      readings: existingReadings,
      readerType: 'rfid_fixed',
      now: Date.now(),
      debounceMs: 2000,
    };

    const check = detectDuplicateReading(burstAttempt);
    expect(check.duplicate).toBe(true);
    expect(check.reason).toBe('rfid_debounce');
  });
});
