import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { rpc, from, select, selectPieces } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), select: vi.fn(), selectPieces: vi.fn(),
}));
vi.mock('@/lib/supabaseClient', () => ({ supabase: { rpc, from } }));
vi.mock('@/lib/auditLog', () => ({ auditLog: vi.fn(), AUDIT_ACTIONS: {} }));

import { getCollectionHistory } from '@/lib/collectionService';
import CollectionReadItem from '@/components/collection/CollectionReadItem';

const reading = (overrides = {}) => ({
  id: 'reading-1', piece_id: 'piece-original', created_at: '2026-09-08T12:00:00Z',
  traceability_code: '09890701', raw_value: '09890701',
  result_status: 'approved', event_status: 'approved', operation_name: 'cut',
  current_stage_name: 'cut', cell_name: 'Corte', result_payload: { status: 'approved', route: { step_name: 'cut' } },
  ...overrides,
});
const piece = (overrides = {}) => ({
  id: 'piece-original', status: 'active', replacement_status: 'none', current_stage: 'edge',
  traceability_code: '09890701', route_steps: ['cut', 'edge'], completed_steps: ['cut'],
  ...overrides,
});

describe('histórico preserva o snapshot da leitura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ select });
    select.mockReturnValue({ in: selectPieces });
    rpc.mockResolvedValue({ data: [reading()], error: null });
    selectPieces.mockResolvedValue({ data: [piece()], error: null });
  });

  it('mantém Corte na leitura enquanto a peça já está em Bordo', async () => {
    const [read] = await getCollectionHistory({ cellName: 'Corte' });
    expect(read).toMatchObject({
      event_status: 'approved', reading_status: 'approved', current_stage_name: 'cut',
      reading_stage_name: 'cut', piece_current_stage: 'edge', piece_status: 'active',
    });
    render(<CollectionReadItem read={read} onSelect={vi.fn()} />);
    expect(screen.getByText('Etapa da leitura:')).toHaveTextContent('Corte');
    expect(screen.getByText('Etapa atual da peça:')).toHaveTextContent('Bordo');
    expect(screen.getByText('APROVADA')).toBeInTheDocument();
  });

  it.each([
    ['duplicated', 'DUPLICADA'], ['blocked', 'BLOQUEADA'], ['rejected', 'REPROVADA'],
  ])('não transforma decisão %s em aprovada pelo estado atual da peça', async (status, badge) => {
    rpc.mockResolvedValue({ data: [reading({ result_status: status, event_status: 'approved' })], error: null });
    const [read] = await getCollectionHistory({ status });
    expect(read.event_status).toBe(status);
    render(<CollectionReadItem read={read} onSelect={vi.fn()} />);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.queryByText('APROVADA')).not.toBeInTheDocument();
  });

  it('reposicionar ou substituir a peça não altera reprovação, código ou lote da leitura original', async () => {
    rpc.mockResolvedValue({ data: [reading({
      result_status: 'rejected', event_status: 'approved_via_replacement', lot_code: 'LOTE-ORIGINAL',
    })], error: null });
    selectPieces.mockResolvedValue({ data: [piece({
      status: 'replaced', replacement_status: 'replaced', traceability_code: 'NOVO-CODIGO', lot_code: 'OUTRO-LOTE',
    })], error: null });

    const [read] = await getCollectionHistory({ status: 'rejected' });
    expect(read).toMatchObject({
      event_status: 'rejected', traceability_code: '09890701', lot_code: 'LOTE-ORIGINAL',
      piece_status: 'replaced', replacement_status: 'replaced',
    });
    render(<CollectionReadItem read={read} onSelect={vi.fn()} />);
    expect(screen.getByText('REPROVADA')).toBeInTheDocument();
    expect(screen.getByText('Peça atual: resolvida por reposição')).toBeInTheDocument();
    expect(screen.getByText('🔍 Coleta Física')).toBeInTheDocument();
    expect(screen.queryByText('↻ APROVADA VIA REPOSIÇÃO')).not.toBeInTheDocument();
    expect(screen.queryByText('↻ Baixa por reposição')).not.toBeInTheDocument();
  });

  it('mantém a baixa real de reposição como evento próprio nos filtros de aprovação', async () => {
    rpc.mockResolvedValue({ data: [reading({
      raw_value: 'REP-001', result_payload: { status: 'approved', entry_type: 'baixa_reposicao' },
    })], error: null });

    for (const status of ['approved', 'approved_via_replacement']) {
      const [read] = await getCollectionHistory({ status });
      expect(read.event_status).toBe('approved_via_replacement');
    }
    const [read] = await getCollectionHistory({});
    render(<CollectionReadItem read={read} onSelect={vi.fn()} />);
    expect(screen.getByText('REP-001')).toBeInTheDocument();
    expect(screen.getByText('↻ APROVADA VIA REPOSIÇÃO')).toBeInTheDocument();
    expect(screen.getByText('↻ Baixa por reposição')).toBeInTheDocument();
  });

  it('mantém aprovação antiga sem oferecer nova reprovação da peça já substituída', async () => {
    selectPieces.mockResolvedValue({ data: [piece({ status: 'replaced', replacement_status: 'replaced' })], error: null });
    const [read] = await getCollectionHistory({});
    render(<CollectionReadItem read={read} onSelect={vi.fn()} canReject onReject={vi.fn()} />);
    expect(screen.getByText('APROVADA')).toBeInTheDocument();
    expect(screen.getByText('Peça atual: resolvida por reposição')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprovar' })).not.toBeInTheDocument();
  });

  it('prioriza a etapa do resultado sobre o fallback antigo da RPC', async () => {
    rpc.mockResolvedValue({ data: [reading({ operation_name: null, current_stage_name: 'edge' })], error: null });
    const [read] = await getCollectionHistory({});
    expect(read.current_stage_name).toBe('cut');
    expect(read.piece_current_stage).toBe('edge');
  });

  it('conserva a decisão do evento sem acesso ao enriquecimento das peças', async () => {
    rpc.mockResolvedValue({ data: [reading({ result_status: 'duplicated', event_status: 'approved' })], error: null });
    selectPieces.mockResolvedValue({ data: null, error: { message: 'temporary failure' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [read] = await getCollectionHistory({ status: 'duplicated' });
      expect(read.event_status).toBe('duplicated');
      expect(read.current_stage_name).toBe('cut');
    } finally {
      warn.mockRestore();
    }
  });
});
