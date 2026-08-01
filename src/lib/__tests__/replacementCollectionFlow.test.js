import { describe, it, expect, vi } from 'vitest';
import {
  collectReplacementStage,
  forceCompleteReplacement,
  getEnabledWorkstations,
  getOperatorWorkstationAuthorizations
} from '../replacementService';
import { supabase } from '@/lib/supabaseClient';

describe('replacementCollectionFlow', () => {
  it('deve chamar a RPC collect_replacement_stage com parâmetros corretos', async () => {
    const mockResponse = {
      success: true,
      result_status: 'approved',
      completed_stage: 'Borda',
      next_stage: 'Usinagem CNC',
      order_status: 'in_production',
      replacement_completed: false,
      message: 'Borda concluída. Peça liberada para Usinagem CNC.'
    };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockResponse,
      error: null
    });

    const res = await collectReplacementStage({
      barcode: 'SUBST-1002',
      replacementOrderId: 'ord-123',
      workstationId: 'ws-456',
      operatorId: 'op-789',
      shift: '1',
      clientEventId: 'evt-001'
    });

    expect(rpcSpy).toHaveBeenCalledWith('collect_replacement_stage', {
      p_barcode: 'SUBST-1002',
      p_replacement_order_id: 'ord-123',
      p_cell_id: null,
      p_workstation_id: 'ws-456',
      p_machine_id: 'ws-456',
      p_operator_id: 'op-789',
      p_shift: '1',
      p_client_event_id: 'evt-001',
      p_payload: {}
    });

    expect(res.success).toBe(true);
    expect(res.completed_stage).toBe('Borda');
    expect(res.next_stage).toBe('Usinagem CNC');
  });

  it('deve rejeitar se o código de barras for vazio', async () => {
    await expect(collectReplacementStage({ barcode: '   ' }))
      .rejects.toThrow('Código de barras é obrigatório para a baixa produtiva.');
  });

  it('deve executar a conclusão forçada via RPC e registrar auditoria', async () => {
    const mockForceResponse = {
      success: true,
      message: 'Conclusão forçada registrada com sucesso e auditada.'
    };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockForceResponse,
      error: null
    });

    const res = await forceCompleteReplacement('ord-999', {
      reason: 'Perda física da etiqueta na marcenaria'
    });

    expect(rpcSpy).toHaveBeenCalledWith('force_complete_piece_replacement', {
      p_order_id: 'ord-999',
      p_reason: 'Perda física da etiqueta na marcenaria'
    });
    expect(res.success).toBe(true);
  });

  it('deve aceitar o código original da peça (ex: 09950020) para dar baixas na reposição', async () => {
    const mockResponse = {
      success: true,
      result_status: 'approved',
      completed_stage: 'Corte',
      next_stage: 'Borda',
      order_status: 'in_production',
      replacement_completed: false,
      message: 'Corte concluída. Peça liberada para Borda.'
    };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockResponse,
      error: null
    });

    const res = await collectReplacementStage({
      barcode: '09950020',
      workstationId: 'ws-corte',
      operatorId: 'op-1001',
      shift: '1'
    });

    expect(rpcSpy).toHaveBeenCalledWith('collect_replacement_stage', expect.objectContaining({
      p_barcode: '09950020'
    }));

    expect(res.success).toBe(true);
    expect(res.completed_stage).toBe('Corte');
  });

  it('deve dar entrada automática e liberar a peça bipejada sem aprovação administrativa prévia', async () => {
    const mockResponse = {
      success: true,
      result_status: 'approved',
      completed_stage: 'Furação',
      next_stage: 'Embalagem',
      order_status: 'in_production',
      replacement_completed: false,
      message: 'Entrada automática registrada em Furação! Próxima etapa: Embalagem.'
    };

    const rpcSpy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: mockResponse,
      error: null
    });

    const res = await collectReplacementStage({
      barcode: '09950020',
      workstationId: 'ws-furacao',
      operatorId: 'op-1001',
      shift: '1'
    });

    expect(res.success).toBe(true);
    expect(res.completed_stage).toBe('Furação');
    expect(res.order_status).toBe('in_production');
    expect(res.message).toContain('Entrada automática registrada em Furação');
  });

  it('deve exigir justificativa na conclusão forçada', async () => {
    await expect(forceCompleteReplacement('ord-999', { reason: '' }))
      .rejects.toThrow('Justificativa é obrigatória para a conclusão forçada.');
  });
});


