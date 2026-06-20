import { describe, expect, it } from 'vitest';
import {
  buildOccurrenceFromRejectedReading,
  buildProductionKpiUpdate,
  detectDuplicateReading,
  detectReaderType,
  normalizeTagValue,
  processProductionReading,
} from '@/lib/traceabilityService';
import {
  productionItemsFixture,
  productionLotFixture,
  productionRouteFixture,
  validReadingFixture,
} from '@/test/fixtures/traceabilityFixtures';
import { createTraceabilityTestRepository } from '@/test/utils/createTraceabilityTestRepository';

const testNow = new Date('2026-06-19T11:00:00.000Z');

describe('traceabilityService', () => {
  it('normaliza barcode removendo espaços e quebras', () => {
    expect(normalizeTagValue('  LSM-TEST-001- P001\n').tagValue).toBe('LSM-TEST-001-P001');
  });

  it('identifica QR, barcode, manual e RFID', () => {
    expect(detectReaderType({ rawValue: 'QR:LSM-TEST-001-P001', mode: 'camera' })).toBe('camera_qrcode');
    expect(detectReaderType({ rawValue: '7891234567890' })).toBe('keyboard_barcode');
    expect(detectReaderType({ rawValue: 'LSM-TEST-001-P001', mode: 'manual' })).toBe('manual');
    expect(detectReaderType({ rawValue: 'EPC-TEST-000000000001' })).toBe('rfid_fixed');
    expect(detectReaderType({ rawValue: 'EPC-TEST-000000000001', readerType: 'rfid_handheld' })).toBe('rfid_handheld');
  });

  it('aprova leitura válida e avança a peça', async () => {
    const repository = createTraceabilityTestRepository();
    const result = await processProductionReading(validReadingFixture, { repository, now: testNow });

    expect(result).toMatchObject({ success: true, status: 'approved' });
    expect(result.item.current_step).toBe('Marcenaria');
    expect(result.nextStep.step_name).toBe('Marcenaria');
    expect(result.reading.reader_type).toBe('keyboard_barcode');
    expect(repository.readings).toHaveLength(1);
  });

  it('bloqueia uma leitura repetida', async () => {
    const repository = createTraceabilityTestRepository();
    await processProductionReading(validReadingFixture, { repository, now: testNow });
    const duplicate = await processProductionReading(validReadingFixture, { repository, now: testNow });

    expect(duplicate).toMatchObject({ success: false, status: 'duplicated' });
    expect(repository.readings).toHaveLength(1);
  });

  it('bloqueia etapa diferente da etapa esperada', async () => {
    const repository = createTraceabilityTestRepository();
    const result = await processProductionReading(
      { ...validReadingFixture, stepName: 'Montagem' },
      { repository, now: testNow },
    );
    expect(result.status).toBe('wrong_step');
    expect(repository.readings).toHaveLength(0);
  });

  it('bloqueia a leitura em célula errada', async () => {
    const repository = createTraceabilityTestRepository();
    const result = await processProductionReading(
      { ...validReadingFixture, cellName: 'Expedição' },
      { repository, now: testNow },
    );
    expect(result.status).toBe('wrong_cell');
    expect(result.message).toContain('Corte');
  });

  it('não permite avanço de peça reprovada', async () => {
    const items = structuredClone(productionItemsFixture);
    items[0].status = 'rejected';
    const repository = createTraceabilityTestRepository({ items });
    const result = await processProductionReading(validReadingFixture, { repository, now: testNow });
    expect(result.status).toBe('blocked');
  });

  it('não baixa novamente uma peça finalizada', async () => {
    const items = structuredClone(productionItemsFixture);
    items[0].status = 'completed';
    const repository = createTraceabilityTestRepository({ items });
    const result = await processProductionReading(validReadingFixture, { repository, now: testNow });
    expect(result.status).toBe('completed');
  });

  it('gera o payload de ocorrência de uma reprovação', () => {
    const occurrence = buildOccurrenceFromRejectedReading({
      lot: productionLotFixture,
      item: productionItemsFixture[0],
      rawValue: productionItemsFixture[0].barcode,
      reason: 'Avaria no acabamento',
      cellName: 'Qualidade',
      operator: 'Operador Teste',
      createdAt: testNow.toISOString(),
    });
    expect(occurrence).toMatchObject({
      type: 'traceability_rejection',
      lotCode: 'LSM-TEST-001',
      pieceCode: 'P001',
      reason: 'Avaria no acabamento',
    });
  });

  it('gera atualização de KPI para leitura aprovada', () => {
    expect(buildProductionKpiUpdate({
      ...validReadingFixture,
      status: 'approved',
      stepName: productionRouteFixture[0].step_name,
    })).toMatchObject({ total: 1, approved: 1, rejected: 0, blocked: 0, cellName: 'Corte' });
  });

  it('aplica debounce em EPC RFID repetido', () => {
    const createdAt = new Date(testNow.getTime() - 500).toISOString();
    const duplicate = detectDuplicateReading({
      rawValue: productionItemsFixture[0].rfidEpc,
      readerType: 'rfid_fixed',
      item: productionItemsFixture[0],
      readings: [{
        item_id: productionItemsFixture[0].id,
        tag_value: productionItemsFixture[0].rfidEpc,
        step_name: 'Corte',
        status: 'blocked',
        created_at: createdAt,
      }],
      now: testNow,
      debounceMs: 2000,
    });
    expect(duplicate).toMatchObject({ duplicate: true, reason: 'rfid_debounce' });
  });

  it('retorna erro claro para código inexistente', async () => {
    const repository = createTraceabilityTestRepository();
    const result = await processProductionReading(
      { ...validReadingFixture, rawValue: 'CODIGO-INEXISTENTE' },
      { repository, now: testNow },
    );
    expect(result.status).toBe('not_found');
    expect(result.message).toContain('não localizado');
  });

  it('exige confirmação e justificativa manual quando configurada', async () => {
    const repository = createTraceabilityTestRepository();
    const withoutConfirmation = await processProductionReading({
      ...validReadingFixture,
      mode: 'manual',
      readerType: 'manual',
    }, { repository, now: testNow });
    expect(withoutConfirmation.status).toBe('manual_confirmation_required');

    const withoutReason = await processProductionReading({
      ...validReadingFixture,
      mode: 'manual',
      readerType: 'manual',
      confirmed: true,
      requiresJustification: true,
    }, { repository, now: testNow });
    expect(withoutReason.status).toBe('manual_justification_required');
  });

  it('mantém o formato padrão mesmo quando a leitura é recusada', async () => {
    const repository = createTraceabilityTestRepository();
    const result = await processProductionReading(
      { ...validReadingFixture, rawValue: '' },
      { repository, now: testNow },
    );
    expect(result).toEqual(expect.objectContaining({
      success: false,
      lot: null,
      item: null,
      route: null,
      reading: null,
      nextStep: null,
      occurrence: null,
      kpiUpdate: null,
    }));
  });
});
