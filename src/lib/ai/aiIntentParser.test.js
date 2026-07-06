import { describe, expect, it } from 'vitest';
import { parseIntent } from './aiIntentParser';

describe('aiIntentParser', () => {
  const clock = new Date(2026, 5, 30, 10, 0, 0); // 30/06/2026

  it('detects send OEE report immediately', () => {
    const res = parseIntent('Envie o relatório OEE de ontem para o Carlos', { now: clock });
    expect(res).toMatchObject({
      action: 'send_report_email',
      reportType: 'oee',
      recipients: ['Carlos'],
      filters: { startDate: '2026-06-29', endDate: '2026-06-29' },
      format: 'pdf',
    });
  });

  it('detects direct email and format in prompt', () => {
    const res = parseIntent('Envie o resumo de produção de hoje para joao@empresa.com em formato Excel', { now: clock });
    expect(res).toMatchObject({
      action: 'send_report_email',
      reportType: 'production_summary',
      recipients: ['joao@empresa.com'],
      filters: { startDate: '2026-06-30', endDate: '2026-06-30' },
      format: 'xlsx',
    });
  });

  it('detects current user as recipient for self-send prompts', () => {
    const res = parseIntent('Me envie o relatório OEE de hoje no meu e-mail', { now: clock });
    expect(res).toMatchObject({
      action: 'send_report_email',
      reportType: 'oee',
      recipients: ['remetente'],
      filters: { startDate: '2026-06-30', endDate: '2026-06-30' },
    });
  });

  it('detects daily schedule', () => {
    const res = parseIntent('Agende o resumo diário de produção para todos os gestores às 7h', { now: clock });
    expect(res).toMatchObject({
      action: 'schedule_report_email',
      reportType: 'daily_production',
      recipients: ['todos os gestores'],
      schedule: {
        frequency: 'daily',
        timeLocal: '07:00',
      },
    });
  });

  it('detects weekly schedule with cell and shift filters', () => {
    const res = parseIntent('Toda segunda às 8h envie o relatório de ocorrências da célula corte para Maria', { now: clock });
    expect(res).toMatchObject({
      action: 'schedule_report_email',
      reportType: 'occurrences',
      recipients: ['Maria'],
      filters: {
        cell: 'corte',
      },
      schedule: {
        frequency: 'weekly',
        timeLocal: '08:00',
      },
    });
  });

  it('detects list schedules intent', () => {
    const res = parseIntent('Quais relatórios estão agendados?');
    expect(res.action).toBe('list_schedules');
  });

  it('detects cancel schedule intent', () => {
    const res = parseIntent('Cancele o agendamento do resumo da diretoria');
    expect(res.action).toBe('cancel_schedule');
  });
});
