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
    expect(res.content).toContain('não está cadastrado');
    expect(res.content).toContain('não substituí');
  });

  it('blocks a missing exact email even when a similar-name recipient was also resolved', async () => {
    canExecuteAiAction.mockReturnValue(true);
    resolveRecipientsFromPrompt.mockResolvedValue({
      resolved: [{ id: 'profile:1', name: 'Gildemar Pereira', email: 'gilsantos.pereira@empresa.com' }],
      ambiguous: [],
      notFound: ['gildemar.pereira@empresa.com'],
    });

    const result = await executeAiAction({
      action: 'send_report_email',
      rawPrompt: 'Envie para gildemar.pereira@empresa.com',
    }, { user: { id: 'u1', role: 'manager' } });

    expect(sendReportEmailSmart).not.toHaveBeenCalled();
    expect(result.content).toContain('gildemar.pereira@empresa.com');
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
    expect(res.content).toContain('aceito pelo provedor');
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

  it('detalha cada etapa e distingue baixa rastreável de baixa por volume', async () => {
    canExecuteAiAction.mockReturnValue(true);
    resolveAiLotContext.mockResolvedValue({
      matchedAs: 'client',
      batchId: 'batch-1',
      generalLotCode: '26072640',
      clientLotCode: '940004',
      clientLotCodes: ['940004'],
      clientLot: {
        id: 'lot-1',
        lot_code: '940004',
        progress_percent: 64,
        integrity_percent: 90,
        bottleneck_stage: 'Marcenaria',
        stages: [
          { stage_order: 1, stage_label: 'Corte', required_pieces: 10, effective_completed_pieces: 10, traceable_completed_pieces: 10, progress_percent: 100 },
          { stage_order: 2, stage_label: 'Furação', required_pieces: 10, effective_completed_pieces: 10, traceable_completed_pieces: 10, progress_percent: 100 },
          { stage_order: 3, stage_label: 'Embalagem', required_pieces: 10, effective_completed_pieces: 10, traceable_completed_pieces: 1, manual_quantity: 9, progress_percent: 100, traceable_collection_required: false },
        ],
      },
      generalLot: null,
      links: {
        integrity: '/integridade-lote?generalLot=26072640&clientLot=940004',
        tracking: '/acompanhamento-lotes?generalLot=26072640&clientLot=940004',
      },
    });

    const result = await executeAiAction({
      action: 'search_production',
      rawPrompt: 'mostre todas as etapas do lote 940004',
      filters: { lotCode: '940004' },
    }, { user: { id: 'u1', role: 'admin' } });

    expect(result.content).toContain('Furação: 10/10');
    expect(result.content).toContain('1 rastreável(is) + 9 por volume');
    expect(result.content).toContain('Gargalo atual: **Marcenaria**');
  });
});
