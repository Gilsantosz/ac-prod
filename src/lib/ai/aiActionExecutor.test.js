import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeAiAction } from './aiActionExecutor';
import { canExecuteAiAction } from './aiPermissionService';
import { resolveRecipientsFromPrompt } from './aiRecipientResolver';
import { generateOperationalReport } from './aiReportService';
import { sendReportEmailSmart } from './aiEmailService';

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

describe('aiActionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks execution when user lacks permissions', async () => {
    canExecuteAiAction.mockReturnValue(false);
    const user = { id: 'u1', role: 'operator' };
    const res = await executeAiAction({ action: 'send_report_email' }, { user });
    expect(res.content).toContain('Você não possui permissão');
  });

  it('requests confirmation for external domain emails', async () => {
    canExecuteAiAction.mockReturnValue(true);
    resolveRecipientsFromPrompt.mockResolvedValue({
      resolved: [{ name: 'Joao', email: 'joao@externo.com' }],
      ambiguous: [],
      notFound: [],
    });

    const user = { id: 'u1', role: 'manager', email: 'user@empresa.com' };
    const res = await executeAiAction({ action: 'send_report_email', rawPrompt: 'Mande para joao@externo.com' }, { user });
    expect(res.pendingAction.type).toBe('send_report_email');
    expect(res.content).toContain('domínio de e-mail externo');
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
      filters: { startDate: '2026-06-30', endDate: '2026-06-30' },
    }, { user });

    expect(generateOperationalReport).toHaveBeenCalled();
    expect(sendReportEmailSmart).toHaveBeenCalled();
    expect(res.content).toContain('enviado com sucesso');
  });
});
