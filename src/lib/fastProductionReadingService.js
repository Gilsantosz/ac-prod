import { supabase } from '@/lib/supabaseClient';
import { getOperatorSession } from '@/lib/operatorSessionService';
import {
  getProductionScanCodeError,
  normalizeProductionScanCode,
  PRODUCTION_SCAN_LENGTH,
} from '@/lib/productionScanCode';

const FAST_READER_TYPES = new Set([
  'keyboard_barcode',
  'camera_qrcode',
  'camera_barcode',
  'manual',
]);

/**
 * Caminho crítico da coleta física: usa uma única chamada RPC e deixa toda a
 * resolução de peça, lote, rota, concorrência e auditoria no PostgreSQL.
 */
export async function processFastProductionReading(payload = {}) {
  const readerType = payload.readerType || payload.reader_type || 'keyboard_barcode';
  if (!FAST_READER_TYPES.has(readerType)) {
    throw new Error(`Leitor ${readerType} não é compatível com o caminho rápido de 8 dígitos.`);
  }

  const rawValue = payload.rawValue ?? payload.raw_value ?? payload.tagValue ?? '';
  const code = normalizeProductionScanCode(rawValue);
  if (!code) {
    return {
      success: false,
      status: 'invalid',
      reason_code: 'INVALID_CODE_LENGTH',
      alert_level: 'red',
      message: getProductionScanCodeError(rawValue),
      expected_code_length: PRODUCTION_SCAN_LENGTH,
    };
  }

  const operatorSession = getOperatorSession();
  const sessionToken = payload.operatorSessionToken
    || payload.operator_session_token
    || operatorSession?.token
    || null;

  const cleanPayload = {
    ...payload,
    rawValue: code,
    raw_value: code,
    readerType,
    operatorSessionToken: sessionToken,
    client_event_id: payload.client_event_id,
    createdAtClient: payload.createdAtClient || payload.created_at_client || new Date().toISOString(),
    deviceId: payload.deviceId || payload.device_id || null,
    quantity: Math.max(1, Number(payload.quantity) || 1),
    exactDigitCapture: true,
    expectedCodeLength: PRODUCTION_SCAN_LENGTH,
    fastPath: true,
  };

  const { data, error } = await supabase.rpc('process_production_reading', {
    p_payload: cleanPayload,
  });

  if (error) {
    const unavailable = error.code === 'PGRST202'
      || /could not find.+process_production_reading|schema cache/i.test(error.message || '');
    const wrapped = new Error(unavailable
      ? 'A estrutura de coleta ainda não foi aplicada no Supabase.'
      : `Falha ao processar leitura${error.code ? ` (${error.code})` : ''}: ${error.message}`);
    wrapped.code = error.code;
    throw wrapped;
  }

  return data || {
    success: false,
    status: 'error',
    message: 'O servidor não retornou o resultado da coleta.',
  };
}
