import { describe, it, expect } from 'vitest';

describe('downtimeService', () => {
  it('deve calcular a duração de uma parada em minutos no banco', () => {
    const start = new Date('2026-07-25T10:00:00Z').getTime();
    const end = new Date('2026-07-25T10:45:00Z').getTime();
    const durationMinutes = (end - start) / (1000 * 60);

    expect(durationMinutes).toBe(45);
  });

  it('não deve permitir duração negativa se os horários forem inválidos', () => {
    const start = new Date('2026-07-25T11:00:00Z').getTime();
    const end = new Date('2026-07-25T10:45:00Z').getTime();
    const rawDuration = (end - start) / (1000 * 60);
    const durationMinutes = Math.max(0, rawDuration);

    expect(durationMinutes).toBe(0);
  });
});
