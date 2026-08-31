import { describe, it, expect } from 'vitest';
import { resolveOperatorShiftWindow } from '../shiftWindowService';

describe('resolveOperatorShiftWindow — Cálculo de Janelas de Turno', () => {
  it('calcula corretamente o 1º turno diurno (06:00 às 14:00)', () => {
    // 10:30 no fuso de SP -> deve estar dentro do 1º turno
    const refDate = new Date('2026-08-31T13:30:00.000Z'); // 10:30 BRT (UTC-3)
    const result = resolveOperatorShiftWindow({
      operatorId: 'op-001',
      shiftStartTime: '06:00:00',
      shiftEndTime: '14:00:00',
      timezone: 'America/Sao_Paulo',
      referenceTime: refDate,
    });

    expect(result.operatorId).toBe('op-001');
    expect(result.isInsideShift).toBe(true);
    expect(result.shiftWorkDate).toBe('2026-08-31');
  });

  it('detecta fora do turno para horário anterior ao início (05:30)', () => {
    const refDate = new Date('2026-08-31T08:30:00.000Z'); // 05:30 BRT
    const result = resolveOperatorShiftWindow({
      shiftStartTime: '06:00:00',
      shiftEndTime: '14:00:00',
      timezone: 'America/Sao_Paulo',
      referenceTime: refDate,
    });

    expect(result.isInsideShift).toBe(false);
  });

  it('calcula corretamente o 3º turno noturno (22:00 às 06:00) na parte da noite (23:15)', () => {
    const refDate = new Date('2026-08-31T02:15:00.000Z'); // 23:15 BRT no dia 30/08
    const result = resolveOperatorShiftWindow({
      shiftStartTime: '22:00:00',
      shiftEndTime: '06:00:00',
      timezone: 'America/Sao_Paulo',
      referenceTime: refDate,
    });

    expect(result.isInsideShift).toBe(true);
    expect(result.shiftWorkDate).toBe('2026-08-30');
  });

  it('calcula corretamente o 3º turno noturno na parte da madrugada (02:45) atribuindo à data anterior', () => {
    // 02:45 BRT do dia 31/08 pertence à jornada de trabalho que iniciou em 30/08 às 22:00
    const refDate = new Date('2026-08-31T05:45:00.000Z'); // 02:45 BRT no dia 31/08
    const result = resolveOperatorShiftWindow({
      shiftStartTime: '22:00:00',
      shiftEndTime: '06:00:00',
      timezone: 'America/Sao_Paulo',
      referenceTime: refDate,
    });

    expect(result.isInsideShift).toBe(true);
    expect(result.shiftWorkDate).toBe('2026-08-30');
  });

  it('marca fora do turno noturno durante o horário diurno (12:00)', () => {
    const refDate = new Date('2026-08-31T15:00:00.000Z'); // 12:00 BRT
    const result = resolveOperatorShiftWindow({
      shiftStartTime: '22:00:00',
      shiftEndTime: '06:00:00',
      timezone: 'America/Sao_Paulo',
      referenceTime: refDate,
    });

    expect(result.isInsideShift).toBe(false);
  });
});
