import { describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { fetchJoineryLotPieces, joineryPieceState, summarizeJoinery } from './joineryMonitoring';

describe('monitoramento somente leitura da Marcenaria', () => {
  it('não considera chegada na célula nem etapa seguinte como comprovação de conclusão', () => {
    expect(joineryPieceState({ current_stage: 'joinery', status: 'in_progress' }).key).toBe('pending');
    expect(joineryPieceState({ current_stage: 'joinery', status: 'rejected' }).key).toBe('issue');
    expect(joineryPieceState({ current_stage: 'separation', completed_steps: ['joinery'] }).key).toBe('released');
    expect(joineryPieceState({ current_stage: 'separation', completed_steps: [] }).key).toBe('upstream');
    expect(summarizeJoinery([
      { current_stage: 'joinery' }, { completed_steps: ['Marcenaria'] }, { status: 'cancelled' },
    ])).toMatchObject({ pending: 1, released: 1, excluded: 1, total: 2, percent: 50 });
  });

  it('pagina o lote inteiro, filtra apenas peças do roteiro e propaga falhas', async () => {
    const pages = [{ data: Array.from({ length: 500 }, (_, id) => ({ id, route_steps: ['joinery'] })), error: null }, { data: [{ id: 'last', completed_steps: ['joinery'] }, { id: 'other', route_steps: ['cut'] }], error: null }];
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockImplementation(() => Promise.resolve(pages.shift())) };
    vi.spyOn(supabase, 'from').mockReturnValue(query);
    expect(await fetchJoineryLotPieces({ lotId: 'lot-1' })).toHaveLength(501);
    expect(query.eq).toHaveBeenCalledWith('lot_id', 'lot-1');
    expect(query.range).toHaveBeenLastCalledWith(500, 999);
    query.range.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(fetchJoineryLotPieces({ lotId: 'lot-1' })).rejects.toThrow('offline');
  });
});
