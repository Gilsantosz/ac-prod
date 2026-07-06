import { describe, expect, it, vi } from 'vitest';
import { executeOperationalCommand, parseOperationalCommand } from './aiOperationalCommandService';
import { calculateOeeSummary } from './aiReportService';

const admin = { id: 'user-1', name: 'Administrador', role: 'admin', permissions: {} };

describe('comandos operacionais por linguagem natural', () => {
  it('entende o envio de relatório OEE para um gestor', () => {
    const command = parseOperationalCommand('Envie um relatório OEE para o gestor Gildemar.', {
      now: new Date(2026, 5, 21, 10, 0, 0),
    });
    expect(command).toMatchObject({
      action: 'send_report_email',
      reportType: 'oee',
      recipientName: 'Gildemar',
      filters: { startDate: '2026-06-21', endDate: '2026-06-21' },
    });
  });

  it('entende período explícito e variações do verbo enviar', () => {
    const command = parseOperationalCommand('Mande o relatório de produção de 01/06/2026 a 20/06/2026 para a gestora Maria por email.');
    expect(command).toMatchObject({
      reportType: 'production_summary',
      recipientName: 'Maria',
      filters: { startDate: '2026-06-01', endDate: '2026-06-20' },
    });
  });

  it('não executa envio quando a frase apenas consulta relatórios', () => {
    expect(parseOperationalCommand('Mostre o relatório OEE de hoje')).toBeNull();
  });

  it('calcula OEE por disponibilidade, performance e qualidade', () => {
    const summary = calculateOeeSummary([
      { date: '2026-06-21', cell: 'Célula A', shift: '1', hours: 8, produced: 90, target: 100, scrap: 9, downtime: 60 },
    ]);
    expect(summary.availability).toBeCloseTo(87.5);
    expect(summary.performance).toBeCloseTo(90);
    expect(summary.quality).toBeCloseTo(90);
    expect(summary.oee).toBeCloseTo(70.875);
  });

  it('gera, registra e envia o relatório para o destinatário resolvido', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const generateReport = vi.fn().mockResolvedValue({
      jobId: 'job-1',
      title: 'Relatório OEE - 21/06/2026',
      context: { entries: [{ produced: 10 }] },
      analysis: { oee: { oee: 90, availability: 95, performance: 96, quality: 98 } },
    });
    const result = await executeOperationalCommand('Envie um relatório OEE para o gestor Gildemar.', {
      user: admin,
      dependencies: {
        clock: () => new Date(2026, 5, 21, 10, 0, 0),
        findManager: vi.fn().mockResolvedValue({ name: 'Gildemar', email: 'gildemar@empresa.com', profileId: 'profile-1' }),
        generateReport,
        sendEmail,
      },
    });
    expect(generateReport).toHaveBeenCalledWith(expect.objectContaining({ reportType: 'oee', format: 'csv' }));
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ reportJobId: 'job-1', recipientProfileIds: ['profile-1'] }));
    expect(result.content).toContain('enviado para Gildemar');
  });

  it('não envia relatório vazio', async () => {
    const sendEmail = vi.fn();
    await expect(executeOperationalCommand('Envie um relatório OEE para o gestor Gildemar.', {
      user: admin,
      dependencies: {
        findManager: vi.fn().mockResolvedValue({ name: 'Gildemar', email: 'gildemar@empresa.com' }),
        generateReport: vi.fn().mockResolvedValue({ jobId: 'job-1', context: { entries: [] }, analysis: {} }),
        sendEmail,
      },
    })).rejects.toThrow('Não há apontamentos');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('bloqueia envio por usuário sem permissão administrativa', async () => {
    await expect(executeOperationalCommand('Envie um relatório OEE para o gestor Gildemar.', {
      user: { role: 'operator', permissions: { view_reports: true } },
    })).rejects.toThrow('não possui permissão');
  });
});
