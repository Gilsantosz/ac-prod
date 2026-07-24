import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendReportEmail } from './aiEmailService';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  scheduleInsert: vi.fn(),
  reportFilters: {},
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
            filters: {
              startDate: '2026-07-07',
              endDate: '2026-07-07',
              ...mocks.reportFilters,
            },
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
    mocks.reportFilters = {};
    mocks.from.mockImplementation((table) => {
      if (table === 'report_jobs') return reportJobQuery();
      if (table === 'report_schedules') return reportSchedulesQuery();
      throw new Error(`Tabela não mockada: ${table}`);
    });
  });

  it('usa diretamente o renderizador completo para resumo de produção e OEE', async () => {
    mocks.invoke.mockImplementation(async (name) => {
      if (name === 'send-scheduled-reports') {
        return {
          data: { success: true, processed: [{ scheduleId: 'schedule-1', success: true, providerMessageId: 'smtp-1' }] },
          error: null,
        };
      }
      throw new Error(`Função não mockada: ${name}`);
    });

    const result = await sendReportEmail({
      reportJobId: 'job-1',
      recipientProfileIds: ['profile-1'],
      subject: '[Leo Flow] Resumo de Produção - 07/07/2026',
    });

    expect(result.success).toBe(true);
    expect(result.fallback).toBe('send-scheduled-reports');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith('send-scheduled-reports', {
      body: { scheduleId: 'schedule-1', test: true },
    });
    expect(mocks.scheduleInsert).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      report_type: 'daily_production',
      report_types: ['daily_production', 'oee'],
      format: 'email_html',
      recipient_profile_ids: ['profile-1'],
      extra_emails: [],
      report_date: '2026-07-07',
      report_start_date: '2026-07-07',
      report_end_date: '2026-07-07',
      filter_snapshot: expect.objectContaining({
        startDate: '2026-07-07',
        endDate: '2026-07-07',
      }),
    }));
    expect(result.providerMessageId).toBe('smtp-1');
  });

  it('preserva intervalo e filtros completos no relatório rico', async () => {
    mocks.reportFilters = {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      cells: ['Corte'],
      shifts: ['1º Turno'],
      lots: ['143332'],
      generalLotCode: '15587',
      client: 'MARINA',
      onlyWithScrap: true,
    };
    mocks.invoke.mockResolvedValue({
      data: { success: true, processed: [{ scheduleId: 'schedule-1', success: true }] },
      error: null,
    });

    await sendReportEmail({
      reportJobId: 'job-1',
      recipientProfileIds: ['profile-supervisor'],
      subject: 'Fechamento semanal',
    });

    expect(mocks.scheduleInsert).toHaveBeenCalledWith(expect.objectContaining({
      created_by: 'user-1',
      report_date: null,
      report_start_date: '2026-07-01',
      report_end_date: '2026-07-07',
      cell_filter: ['Corte'],
      shift_filter: ['1º Turno'],
      filter_snapshot: expect.objectContaining({
        startDate: '2026-07-01',
        endDate: '2026-07-07',
        cells: ['Corte'],
        shifts: ['1º Turno'],
        lots: ['143332'],
        generalLotCode: '15587',
        client: 'MARINA',
        onlyWithScrap: true,
      }),
    }));
  });
});
