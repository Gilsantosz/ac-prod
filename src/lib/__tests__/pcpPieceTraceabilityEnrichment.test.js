import { describe, it, expect, vi } from 'vitest';
import { supabase } from '@/lib/supabaseClient';
import { getPieceTraceability } from '../collectionService';

describe('pcpPieceTraceabilityEnrichment', () => {
  it('deve extrair e resolver dados físicos completos e rota produtiva para uma peça', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'production_pieces') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'pc-001',
                  piece_uid: '09908481',
                  traceability_code: '09908481',
                  piece_name: 'Lateral Direita',
                  material: 'MDF 18mm',
                  color: 'Branco Supremo',
                  thickness: 18,
                  width: 450,
                  height: 720,
                  length: 720,
                  environment: 'Cozinha',
                  module_name: 'Balcão 2P',
                  status: 'approved',
                  current_stage: 'Borda',
                  route_steps: ['cut', 'edge', 'cnc', 'separation', 'packaging']
                },
                error: null
              })
            }),
            or: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'pc-001',
                  piece_uid: '09908481',
                  traceability_code: '09908481',
                  piece_name: 'Lateral Direita',
                  material: 'MDF 18mm',
                  color: 'Branco Supremo',
                  thickness: 18,
                  width: 450,
                  height: 720,
                  length: 720,
                  environment: 'Cozinha',
                  module_name: 'Balcão 2P',
                  status: 'approved',
                  current_stage: 'Borda',
                  route_steps: ['cut', 'edge', 'cnc', 'separation', 'packaging']
                },
                error: null
              })
            })
          })
        };
      }
      if (table === 'pcp_import_rows') {
        return {
          select: () => ({
            or: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null })
              })
            })
          })
        };
      }
      if (table === 'production_stage_readings') {
        return {
          select: () => ({
            or: () => ({
              order: async () => ({ data: [], error: null })
            })
          })
        };
      }
      if (table === 'production_routes') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [], error: null })
            })
          })
        };
      }
      return {
        select: () => ({
          maybeSingle: async () => ({ data: null, error: null })
        })
      };
    });

    const res = await getPieceTraceability('09908481');

    expect(res).toBeDefined();
    expect(res.piece).toBeDefined();
    expect(res.piece.piece_name).toBe('Lateral Direita');
    expect(res.piece.material).toBe('MDF 18mm');
    expect(res.piece.color).toBe('Branco Supremo');
    expect(res.piece.thickness).toBe(18);
    expect(res.piece.width).toBe(450);
    expect(res.piece.length).toBe(720);

    expect(res.route).toBeDefined();
    expect(Array.isArray(res.route)).toBe(true);
    expect(res.route.length).toBe(5);
    expect(res.route[0].step_name).toBe('Corte');
    expect(res.route[1].step_name).toBe('Borda');
    expect(res.route[2].step_name).toBe('Usinagem CNC');

    vi.restoreAllMocks();
  });
});
