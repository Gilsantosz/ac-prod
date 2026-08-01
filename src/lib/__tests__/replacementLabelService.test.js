import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const { rpcMock, auditLogMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  auditLogMock: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock('@/lib/auditLog', () => ({
  auditLog: auditLogMock,
  AUDIT_ACTIONS: { LABEL_PRINT: 'LABEL_PRINT' },
}));

import {
  buildReplacementTraceCode,
  recordReplacementLabelPrint,
  validateReplacementLabelData,
} from '@/lib/replacementLabelService';

describe('replacementLabelService — Validações Promob e Rastreabilidade', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    rpcMock.mockReset();
    auditLogMock.mockReset();
    auditLogMock.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('constrói o código de rastreio de reposição no padrão oficial [código original]-REP-R[sequência]', () => {
    const origPiece = {
      promob_barcode: '09950020',
      piece_code: 'PÇA-09950020'
    };

    const traceCode = buildReplacementTraceCode(origPiece, 1);
    expect(traceCode).toBe('09950020-REP-R01');

    const traceCode2 = buildReplacementTraceCode(origPiece, 2);
    expect(traceCode2).toBe('09950020-REP-R02');
  });

  it('permite a impressão de etiquetas para reposições abertas/solicitadas para identificação opcional', () => {
    const requestedOrder = {
      id: 'ord-123',
      status: 'requested',
      replacement_code: 'REP-20260730-7006',
      lot_code: '26072640',
      order_number: '940002',
      original_piece: {
        piece_code: '09950020',
        piece_name: 'TRAVESSA 952,5 × 80 × 15 MM — BRANCO TX'
      }
    };

    const val = validateReplacementLabelData(requestedOrder);
    expect(val.isValid).toBe(true);
  });

  it('bloqueia a impressão de etiquetas APENAS para reposições canceladas', () => {
    const cancelledOrder = {
      id: 'ord-999',
      status: 'cancelled',
      replacement_code: 'REP-20260730-9999'
    };

    const val = validateReplacementLabelData(cancelledOrder);
    expect(val.isValid).toBe(false);
    expect(val.issues.some(i => i.toLowerCase().includes('cancelada'))).toBe(true);
  });

  it('registra a impressão com identificador idempotente e os seis parâmetros do RPC', async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        copy_number: 1,
        is_reprint: false,
        replacement_trace_code: '09950020-REP-R01',
      },
      error: null,
    });

    const result = await recordReplacementLabelPrint({
      replacementOrderId: '96d44a0d-cd5d-44ce-89fd-7f4042e77417',
      printerName: 'Zebra ZT230',
      userName: 'Operador Teste',
      clientEventId: 'f53cc1e8-7743-48cd-8193-d2e0c5b7d9d1',
    });

    expect(rpcMock).toHaveBeenCalledWith('register_replacement_label_print', {
      p_replacement_request_id: '96d44a0d-cd5d-44ce-89fd-7f4042e77417',
      p_reprint_reason: null,
      p_reprint_reason_details: null,
      p_printer_name: 'Zebra ZT230',
      p_user_name: 'Operador Teste',
      p_client_event_id: 'f53cc1e8-7743-48cd-8193-d2e0c5b7d9d1',
    });
    expect(auditLogMock).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it('traduz o erro de cache de schema para uma mensagem operacional', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Function not found in schema cache' },
    });

    await expect(recordReplacementLabelPrint({
      replacementOrderId: '96d44a0d-cd5d-44ce-89fd-7f4042e77417',
      clientEventId: 'f53cc1e8-7743-48cd-8193-d2e0c5b7d9d1',
    })).rejects.toThrow('O serviço de impressão ainda não foi carregado pelo banco');
  });
});
