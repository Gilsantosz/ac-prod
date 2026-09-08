import { describe, expect, it } from 'vitest';
import { mergeCollectionFeedback, normalizeCollectionFeedback, resolveCollectionLotContext } from '@/lib/collectionFeedback';

const identified = {
  client_event_id: 'event-1', collection_state: 'APPROVED', message: 'Leitura aprovada.',
  lot: { id: 'client-lot-1', lot_code: 'CLI-001', pcp_import_batch_id: 'batch-1', general_lot_code: 'GER-001' },
  order: { customer_name: 'Cliente A' },
};

describe('apresentação de recibos e lotes da coleta', () => {
  it('preserva o lote do envelope quando a decisão interna é compacta', () => {
    const result = normalizeCollectionFeedback({
      client_event_id: 'event-1', general_lot_code: 'GER-001', pcp_import_batch_id: 'batch-1',
      lot: { id: 'client-lot-1', lot_code: 'CLI-001' },
      resultado: { status: 'approved', lot: { progress_percent: 21 }, message: 'Liberada.' },
    });
    expect(result).toMatchObject({
      client_event_id: 'event-1', status: 'approved',
      lot: { id: 'client-lot-1', lot_code: 'CLI-001', general_lot_code: 'GER-001', pcp_import_batch_id: 'batch-1', progress_percent: 21 },
    });
  });

  it('não aprova um ACK que carregue success legado', () => {
    expect(mergeCollectionFeedback(null, {
      client_event_id: 'event-1', status: 'database_acknowledged', success: true,
      result: { status: 'approved', success: true },
    })).toMatchObject({ collection_state: 'DATABASE_ACKNOWLEDGED', success: false });
  });

  it('substitui a mensagem de espera quando a decisão aprovada chega sem mensagem', () => {
    const pending = mergeCollectionFeedback(null, {
      client_event_id: 'event-1', collection_state: 'PROCESSING', pending: true, message: 'Leitura preservada e aguardando processamento.',
      lot: identified.lot,
    });
    expect(mergeCollectionFeedback(pending, {
      client_event_id: 'event-1', collection_state: 'APPROVED',
    })).toMatchObject({ collection_state: 'APPROVED', success: true, pending: false, message: 'Leitura aprovada.', lot: identified.lot });
  });

  it('um ACK atrasado não apaga a aprovação nem o lote da mesma leitura', () => {
    expect(mergeCollectionFeedback(identified, {
      client_event_id: 'event-1', collection_state: 'DATABASE_ACKNOWLEDGED', message: 'Aguardando processamento.',
    })).toMatchObject(identified);
  });

  it('a próxima peça começa pendente e não herda aprovação ou identificação da anterior', () => {
    const next = mergeCollectionFeedback(identified, { client_event_id: 'event-2', collection_state: 'CAPTURED_LOCAL' });
    expect(next).toMatchObject({ success: false, collection_state: 'CAPTURED_LOCAL' });
    expect(next.lot).toBeUndefined();
  });

  it('mantém os lotes identificados no banner enquanto a próxima leitura aguarda decisão', () => {
    const context = resolveCollectionLotContext({
      feedback: { client_event_id: 'event-2', collection_state: 'PENDING_DATABASE' },
      lastIdentifiedFeedback: identified, activeGeneralLots: [],
    });
    expect(context).toMatchObject({ generalLot: { general_lot_code: 'GER-001', progress_percent: null }, clientLotCode: 'CLI-001', customerName: 'Cliente A' });
  });

  it('usa lote geral e cliente da projeção quando o recibo não trouxe dados completos', () => {
    expect(resolveCollectionLotContext({ activeGeneralLots: [{
      id: 'batch-1', general_lot_code: 'GER-001', lot_id: 'client-lot-1', lot_code: 'CLI-001', progress_percent: 0,
    }] })).toMatchObject({ generalLot: { general_lot_code: 'GER-001', progress_percent: 0 }, clientLotCode: 'CLI-001' });
    expect(resolveCollectionLotContext({ activeContext: {
      active_pcp_import_batch_id: 'batch-2', active_general_lot_code: 'GER-002', active_lot_code: 'CLI-002',
    } })).toMatchObject({ generalLot: { general_lot_code: 'GER-002', progress_percent: null }, clientLotCode: 'CLI-002' });
  });

  it('não associa o novo lote à primeira projeção ou peça selecionada de outro lote', () => {
    expect(resolveCollectionLotContext({
      feedback: { lot: { id: 'new-client', lot_code: 'NEW', pcp_import_batch_id: 'new-batch' } },
      activeGeneralLots: [{ id: 'old-batch', general_lot_code: 'OLD', lot_code: 'OLD-CLI', progress_percent: 80 }],
      selectedPiece: { lot_code: 'OLD-CLI', general_lot_code: 'OLD' },
    })).toMatchObject({ generalLot: { general_lot_code: null, progress_percent: null }, clientLotCode: 'NEW' });
  });

  it('preserva a última leitura aprovada quando ela conclui o lote', () => {
    expect(mergeCollectionFeedback(null, { ...identified, lot: { ...identified.lot, status: 'completed', progress_percent: 100 } })).toMatchObject({
      collection_state: 'APPROVED', lot: { lot_code: 'CLI-001', status: 'completed' },
    });
  });
});
