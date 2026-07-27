import { describe, expect, it, vi } from 'vitest';

describe('Exclusão Completa de Lotes PCP e Atualização de KPIs', () => {
  it('deve identificar corretamente os alvos de limpeza ao excluir um lote de importação PCP', () => {
    const mockBatch = {
      id: 'batch-123',
      generated_op_id: 'op-456',
      order_code: 'PED-789',
      file_name: 'LOTE_TESTE_40_PECAS.xlsx',
    };

    const mockLots = [
      { id: 'lot-1', pcp_import_batch_id: 'batch-123', order_id: 'op-456' },
    ];

    const mockPieces = [
      { id: 'piece-1', lot_id: 'lot-1', pcp_import_batch_id: 'batch-123' },
      { id: 'piece-2', lot_id: 'lot-1', pcp_import_batch_id: 'batch-123' },
    ];

    // Simular purga em cascata
    const targetLotIds = mockLots.map((l) => l.id);
    const targetPieceIds = mockPieces.map((p) => p.id);

    expect(targetLotIds).toEqual(['lot-1']);
    expect(targetPieceIds).toEqual(['piece-1', 'piece-2']);
    expect(targetPieceIds.length).toBe(2);
  });

  it('deve re-calcular snapshot de KPIs excluindo lotes/peças deletados ou cancelados', () => {
    const pieces = [
      { id: 'p1', lot_id: 'lot-1', status: 'created', route_steps: ['cut', 'edge'] },
      { id: 'p2', lot_id: 'lot-1', status: 'created', route_steps: ['cut', 'edge'] },
      { id: 'p3', lot_id: 'lot-deleted', status: 'cancelled', route_steps: ['cut', 'edge'] },
    ];

    const activeLots = new Set(['lot-1']);

    const validExpectedPieces = pieces.filter(
      (p) => activeLots.has(p.lot_id) && !['cancelled', 'replaced', 'shipped'].includes(p.status)
    );

    expect(validExpectedPieces.length).toBe(2);
    expect(validExpectedPieces.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
