import { describe, it, expect, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { requestReplacement, completeReplacement } from '../replacementService';
import { rejectPieceFromCollection } from '../collectionService';

describe('rejectedPieceReplacementFlow', () => {
  it('deve registrar reprovação mantendo o histórico de reprovada', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fnName, params) => {
      if (fnName === 'register_quality_rejection') {
        return {
          data: {
            success: true,
            nonconformity_id: 'nc-123',
            nc_code: 'NC-2026-00001',
            occurrence_id: 'occ-123',
            reading_id: 'read-123',
            replacement_order_id: 'repl-123'
          },
          error: null
        };
      }
      return { data: null, error: null };
    });

    const res = await rejectPieceFromCollection({
      traceabilityCode: '09908481',
      pieceId: 'pc-123',
      reason: 'Borda descascada',
      disposition: 'scrap',
      operatorName: 'Aelio'
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.replacement_order_id).toBe('repl-123');

    vi.restoreAllMocks();
  });


  it('deve reutilizar o mesmo client_event_id em novas tentativas da mesma reprovação', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, piece_id: 'pc-123', status: 'rejected' },
      error: null
    });

    await rejectPieceFromCollection({
      traceabilityCode: '09907352',
      pieceId: 'pc-123',
      reason: 'Falha de acabamento',
      disposition: 'replacement',
      operatorName: 'Aelio',
      clientEventId: 'af577ac1-0394-4ba1-9708-a71668d769b9'
    });

    expect(rpc).toHaveBeenCalledWith('register_quality_rejection', {
      p_payload: expect.objectContaining({
        piece_id: 'pc-123',
        traceability_code: '09907352',
        client_event_id: 'af577ac1-0394-4ba1-9708-a71668d769b9'
      })
    });

    vi.restoreAllMocks();
  });

  it('deve solicitar reposição e gerar ordem em requested', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fnName, params) => {
      if (fnName === 'request_piece_replacement') {
        return {
          data: {
            success: true,
            replacement_order_id: 'repl-456',
            replacement_code: 'REP-20260725-1001',
            status: 'requested'
          },
          error: null
        };
      }
      return { data: null, error: null };
    });

    const res = await requestReplacement({
      originalPieceId: 'pc-123',
      reason: 'Solicitação manual de reposição',
      priority: 'high'
    });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.status).toBe('requested');

    vi.restoreAllMocks();
  });

  it('deve dar baixa na reposição atualizando peça original para replaced', async () => {
    vi.spyOn(supabase, 'rpc').mockImplementation(async (fnName, params) => {
      if (fnName === 'complete_piece_replacement') {
        return {
          data: {
            success: true,
            status: 'completed'
          },
          error: null
        };
      }
      return { data: null, error: null };
    });

    const res = await completeReplacement('repl-456', { notes: 'Baixa concluída' });

    expect(res).toBeDefined();
    expect(res.success).toBe(true);
    expect(res.status).toBe('completed');

    vi.restoreAllMocks();
  });

  it('deve resolver o piece_id canônico a partir do traceabilityCode quando o pieceId não for informado', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'production_pieces') {
        return {
          select: () => ({
            or: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id: 'real-piece-uuid-999' } })
              })
            })
          })
        };
      }
      return {};
    });

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { success: true, nonconformity_id: 'nc-999' },
      error: null
    });

    await rejectPieceFromCollection({
      traceabilityCode: '09950037',
      pieceId: null,
      reason: 'Defeito no acabamento',
      operatorName: 'Ederson'
    });

    expect(rpcSpy).toHaveBeenCalledWith('register_quality_rejection', {
      p_payload: expect.objectContaining({
        piece_id: 'real-piece-uuid-999',
        traceability_code: '09950037'
      })
    });

    vi.restoreAllMocks();
  });
});
