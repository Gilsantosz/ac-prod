import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendReportEmail } from './aiEmailService';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  scheduleInsert: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: mocks.from,
  },
}));

function reportJobQuery() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'job-1',
            title: 'Resumo de Produção - 07/07/2026',
            report_type: 'production_summary',
            format: 'pdf',
            filters: { startDate: '2026-07-07', endDate: '2026-07-07' },
            requested_by: 'user-1',
          },
          error: null,
        }),
      })),
    })),
  };
}

function reportSchedulesQuery() {
  return {
    insert: mocks.scheduleInsert.mockImplementation(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'schedule-1' }, error: null }),
      })),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  };
}

describe('aiEmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation((table) => {
      if (table === 'report_jobs') return reportJobQuery();
      if (table === 'report_schedules') return reportSchedulesQuery();
      throw new Error(`Tabela não mockada: ${table}`);
    });
  });

  it('usa o canal SMTP/Gmail agendado quando a Edge Function antiga exige Resend', async () => {
    mocks.invoke.mockImplementation(async (name) => {
      if (name === 'send-report-email') {
        return {
          data: {
            success: false,
            error: 'Provedor de e-mail não configurado. Defina RESEND_API_KEY e REPORT_FROM_EMAIL.',
          },
          error: null,
        };
      }
      if (name === 'send-scheduled-reports') {
        return {
          data: { success: true, processed: [{ scheduleId: 'schedule-1', success: true }] },
          error: null,
        };
      }
      throw new Error(`Função não mockada: ${name}`);
    });

    const result = await sendReportEmail({
      reportJobId: 'job-1',
      recipientEmails: ['gildemar.pereira@leomadeiras.com.br'],
      subject: '[Leo Flow] Resumo de Produção - 07/07/2026',
    });

    expect(result.success).toBe(true);
    expect(result.fallback).toBe('send-scheduled-reports');
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'send-scheduled-reports', {
      body: { scheduleId: 'schedule-1', test: true },
    });
    expect(mocks.scheduleInsert).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      report_type: 'daily_production',
      format: 'email_html',
      extra_emails: ['gildemar.pereira@leomadeiras.com.br'],
    }));
  });
});
