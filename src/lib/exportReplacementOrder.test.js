import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildReplacementDocumentData,
  createPromobReplacementLabelPdf,
  createReplacementTechnicalPdf,
  PROMOB_LABEL_SIZE_MM,
} from '@/lib/exportReplacementOrder';

const order = {
  id: 'replacement-1',
  replacement_code: 'REP-20260730-7006',
  status: 'requested',
  priority: 'high',
  created_at: '2026-07-30T02:21:40.000Z',
  reason: 'Erro de CNC',
  defect_name: 'Furação fora de posição',
  origin_cell_name: 'Furadeira',
  rejection_stage: 'drill',
  operator_name: 'Gildemar',
  resolved_general_lot: '26072640',
  resolved_client_lot: '940003',
  order_number: '940003',
  customer_name: 'CLIENTE TESTE AC.PROD',
  environment_name: 'Cozinha',
  route_steps: ['cut', 'edge', 'drill', 'cnc', 'joinery'],
  original_piece: {
    id: 'piece-1',
    piece_uid: '09950038',
    traceability_code: '09950038',
    piece_name: 'PEÇA TESTE 38 - CORTE + BORDA + USINAGEM + MARCENARIA - PTA INF ESQ 2D MARANELLO TOPO PRETO ABSOLUTO 672X18X346.5 672X346.5X1',
    material: 'MDF PRETO ABSOLUTO',
    color: 'PRETO ABSOLUTO',
    length: 672,
    width: 346.5,
    thickness: 18,
    grain_direction: 'Longitudinal',
    edge_front: 'ABS 1mm',
    edge_back: 'ABS 1mm',
    edge_left: 'Sem fita',
    edge_right: 'Sem fita',
    completed_steps: ['cut', 'edge'],
  },
  traceability_readings: [
    {
      id: 'reading-1',
      piece_id: 'piece-1',
      tag_value: '09950038',
      step_name: 'cut',
      cell_name: 'Corte',
      machine_name: 'Seccionadora 1',
      operator_name_snapshot: 'Gildemar',
      shift: '1º Turno',
      status: 'approved',
      event_type: 'approved_scan',
      created_at: '2026-07-29T10:00:00.000Z',
    },
  ],
};

describe('exportação da ordem de reposição', () => {
  it('preserva o nome completo em destaque e todos os dados de corte', () => {
    const data = buildReplacementDocumentData(order);

    expect(data.pieceName).toContain('PEÇA TESTE 38');
    expect(data.pieceName).toContain('MARANELLO TOPO PRETO ABSOLUTO');
    expect(data.cuttingDimensions).toBe('672 × 346,5 × 18 mm');
    expect(data.route).toEqual(['Corte', 'Borda', 'Furação', 'Usinagem CNC', 'Marcenaria']);
    expect(data.edges).toEqual({
      front: 'ABS 1mm',
      back: 'ABS 1mm',
      left: 'Sem fita',
      right: 'Sem fita',
    });
    expect(data.traceabilityEvents).toEqual([
      expect.objectContaining({
        pieceType: 'Original',
        tag: '09950038',
        stage: 'Corte',
        cell: 'Corte',
        status: 'approved',
      }),
    ]);
  });

  it('gera o relatório técnico em A4', async () => {
    const doc = await createReplacementTechnicalPdf(order);
    const bytes = doc.output('arraybuffer');

    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0);
    expect(bytes.byteLength).toBeGreaterThan(5000);

    if (process.env.WRITE_REPLACEMENT_PDF_PREVIEWS === '1') {
      mkdirSync('/tmp/acprod-replacement-pdf', { recursive: true });
      writeFileSync('/tmp/acprod-replacement-pdf/relatorio-reposicao.pdf', Buffer.from(bytes));
    }
  });

  it('gera a etiqueta Promob no formato de 100 por 70 mm', () => {
    const doc = createPromobReplacementLabelPdf(order);
    const bytes = doc.output('arraybuffer');

    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(PROMOB_LABEL_SIZE_MM.width, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(PROMOB_LABEL_SIZE_MM.height, 0);
    expect(bytes.byteLength).toBeGreaterThan(3000);

    if (process.env.WRITE_REPLACEMENT_PDF_PREVIEWS === '1') {
      mkdirSync('/tmp/acprod-replacement-pdf', { recursive: true });
      writeFileSync('/tmp/acprod-replacement-pdf/etiqueta-promob.pdf', Buffer.from(bytes));
    }
  });
});
