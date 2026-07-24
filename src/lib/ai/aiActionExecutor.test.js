import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeAiAction } from './aiActionExecutor';
import { canExecuteAiAction } from './aiPermissionService';
import { resolveRecipientsFromPrompt } from './aiRecipientResolver';
import { generateOperationalReport } from './aiReportService';
import { sendReportEmailSmart } from './aiEmailService';
import { resolveAiLotContext } from './aiLotContextService';

vi.mock('./aiPermissionService', () => ({
  canExecuteAiAction: vi.fn(),
}));

vi.mock('./aiRecipientResolver', () => ({
  resolveRecipientsFromPrompt: vi.fn(),
}));

vi.mock('./aiReportService', () => ({
  generateOperationalReport: vi.fn(),
}));

vi.mock('./aiEmailService', () => ({
  sendReportEmailSmart: vi.fn(),
  listEmailLogs: vi.fn(),
}));

vi.mock('./aiLotContextService', () => ({
  resolveAiLotContext: vi.fn(),
}));

vi.mock('./aiCapabilityService', () => ({
  recordAiActionRun: vi.fn(),
}));

describe('aiActionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAiLotContext.mockResolvedValue({ matchedAs: null });
  });

  it('blocks execution when user lacks permissions', async () => {
    canExecuteAiAction.mockReturnValue(false);
    const user = { id: 'u1', role: 'operator' };
    const res = await executeAiAction({ action: 'send_report_email' }, { user });
    expect(res.content).toContain('Você não possui permissão');
  });

  it('rejects email recipients that are not registered users', async () => {
    canExecuteAiAction.mockReturnValue(true);
    resolveRecipientsFromPrompt.mockResolvedValue({
      resolved: [],
      ambiguous: [],
      notFound: ['joao@externo.com'],
    });

    const user = { id: 'u1', role: 'manager', email: 'user@empresa.com' };
    const res = await executeAiAction({ action: 'send_report_email', rawPrompt: 'Mande para joao@externo.com' }, { user });
    expect(res.pendingAction).toBeUndefined();
    expect(res.content).toContain('nome ou e-mail do gestor');
  });

  it('runs generation and email sending when fully confirmed', async () => {
    canExecuteAiAction.mockReturnValue(true);
    resolveRecipientsFromPrompt.mockResolvedValue({
      resolved: [{ id: 'r1', name: 'Carlos', email: 'carlos@empresa.com' }],
      ambiguous: [],
      notFound: [],
    });
    generateOperationalReport.mockResolvedValue({
      jobId: 'job-1',
      title: 'Relatório OEE',
      context: { entries: [{ produced: 10 }] },
    });
    sendReportEmailSmart.mockResolvedValue({ success: true });

    const user = { id: 'u1', role: 'admin', email: 'admin@empresa.com' };
    const res = await executeAiAction({
      action: 'send_report_email',
      reportType: 'oee',
      rawPrompt: 'Envie o relatório OEE',
      recipients: ['carlos@empresa.com'],
      filters: { startDate: '2026-06-30', endDate: '2026-06-30' },
    }, { user });

    expect(resolveRecipientsFromPrompt).toHaveBeenCalledWith('Envie o relatório OEE', user, { explicitRecipients: ['carlos@empresa.com'] });
    expect(generateOperationalReport).toHaveBeenCalled();
    expect(sendReportEmailSmart).toHaveBeenCalled();
    expect(res.content).toContain('enviado com sucesso');
  });

  it('abre lote geral e lote do cliente já selecionados', async () => {
    canExecuteAiAction.mockReturnValue(true);
    resolveAiLotContext.mockResolvedValue({
      matchedAs: 'client',
      batchId: 'batch-1',
      generalLotCode: '15587',
      clientLotCode: '143345',
      clientLotCodes: ['143345'],
      clientLot: { id: 'lot-1', lot_code: '143345', customer_name: 'Cliente Teste', progress_percent: 42 },
      generalLot: null,
      links: {
        integrity: '/integridade-lote?generalLot=15587&clientLot=143345',
        tracking: '/acompanhamento-lotes?generalLot=15587&clientLot=143345',
      },
    });

    const result = await executeAiAction({
      action: 'search_production',
      rawPrompt: 'rastreie o lote do cliente 143345',
      filters: { clientLotCode: '143345', lotCode: '143345' },
    }, { user: { id: 'u1', role: 'admin' } });

    expect(result.content).toContain('Lote geral PCP: **15587**');
    expect(result.actions[0].path).toBe('/integridade-lote?generalLot=15587&clientLot=143345');
  });
});
