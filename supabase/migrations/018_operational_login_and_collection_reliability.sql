-- ============================================================
-- AC.Prod — MES Fase 2: Login Operacional + Coleta Confiável
-- Migration 018 — Aditiva, sem drops de dados existentes
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SEÇÃO 1 — Evoluir tabela operators com colunas reais
-- ============================================================

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS registration    text,
  ADD COLUMN IF NOT EXISTS login_name      text,          -- campo de login (padrão = nome)
  ADD COLUMN IF NOT EXISTS primary_cell    text,          -- célula principal do operador
  ADD COLUMN IF NOT EXISTS cells           text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shift           text,
  ADD COLUMN IF NOT EXISTS login_enabled   boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_login_at   timestamptz;

-- Migrar dados do JSON serializado no campo role para colunas reais
DO $$
DECLARE
  op RECORD;
  payload jsonb;
BEGIN
  FOR op IN SELECT id, role, name FROM operators WHERE role ~ '^\{' LOOP
    BEGIN
      payload := op.role::jsonb;
      UPDATE operators SET
        registration = COALESCE(registration, payload->>'registration'),
        shift        = COALESCE(shift,        payload->>'shift'),
        cells        = COALESCE(cells,        CASE
          WHEN payload->'cells' IS NOT NULL AND jsonb_typeof(payload->'cells') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(payload->'cells'))
          ELSE '{}'::text[]
        END),
        login_name   = COALESCE(login_name, op.name),
        role         = COALESCE(NULLIF(payload->>'role', ''), 'operator')
      WHERE id = op.id;
    EXCEPTION WHEN OTHERS THEN
      -- role não é JSON válido — manter como está
      NULL;
    END;
  END LOOP;
END $$;

-- Garantir que todo operador existente tenha login_name preenchido
UPDATE operators SET login_name = name WHERE login_name IS NULL OR login_name = '';

-- Índices para login
CREATE INDEX IF NOT EXISTS idx_operators_login_name ON operators(LOWER(login_name));
CREATE INDEX IF NOT EXISTS idx_operators_registration ON operators(registration);

-- ============================================================
-- SEÇÃO 2 — RPC de login operacional (acessa por anon)
-- ============================================================

CREATE OR REPLACE FUNCTION operator_login(p_name text, p_registration text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_name text := LOWER(TRIM(COALESCE(p_name, '')));
  v_reg  text := TRIM(COALESCE(p_registration, ''));
  op     operators%ROWTYPE;
BEGIN
  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe o nome do operador.');
  END IF;
  IF v_reg = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Informe a matrícula.');
  END IF;

  SELECT * INTO op FROM operators
  WHERE active = true
    AND login_enabled = true
    AND (LOWER(TRIM(login_name)) = v_name OR LOWER(TRIM(name)) = v_name)
    AND TRIM(registration) = v_reg
  LIMIT 1;

  IF op.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador não encontrado ou credenciais inválidas.');
  END IF;

  -- Registrar ultimo login
  UPDATE operators SET last_login_at = now() WHERE id = op.id;

  RETURN jsonb_build_object(
    'success',       true,
    'id',            op.id,
    'name',          op.name,
    'registration',  op.registration,
    'primary_cell',  op.primary_cell,
    'cells',         op.cells,
    'shift',         op.shift,
    'login_enabled', op.login_enabled
  );
END;
$$;

-- Permitir que anon chame a função de login operacional (sem Supabase Auth)
GRANT EXECUTE ON FUNCTION operator_login(text, text) TO anon, authenticated;
COMMENT ON FUNCTION operator_login(text, text) IS
  'Login operacional por nome + matrícula. Retorna dados do operador sem hash de senha. Acesso anon para chão de fábrica.';

-- ============================================================
-- SEÇÃO 3 — client_event_id para idempotência de leituras
-- ============================================================

ALTER TABLE production_stage_readings
  ADD COLUMN IF NOT EXISTS client_event_id text;

ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS client_event_id text,
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES operators(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_readings_client_event
  ON production_stage_readings(client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_production_entries_client_event
  ON production_entries(client_event_id)
  WHERE client_event_id IS NOT NULL;

-- ============================================================
-- SEÇÃO 4 — Ledger de eventos de coleta (auditoria)
-- ============================================================

CREATE TABLE IF NOT EXISTS production_collection_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id    text UNIQUE NOT NULL,            -- UUID gerado no cliente
  raw_value          text NOT NULL,
  normalized_value   text,
  reader_type        text NOT NULL DEFAULT 'keyboard_barcode',
  operator_id        uuid REFERENCES operators(id) ON DELETE SET NULL,
  operator_name      text,
  cell_name          text,
  shift              text,
  date               date NOT NULL DEFAULT current_date,
  hour               text NOT NULL DEFAULT to_char(now(), 'HH24:MI'),
  -- resultado
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','synced','error','ignored')),
  result_status      text,
  reading_id         uuid REFERENCES production_stage_readings(id) ON DELETE SET NULL,
  production_entry_id uuid REFERENCES production_entries(id) ON DELETE SET NULL,
  lot_id             uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  production_order_id uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  error_message      text,
  payload            jsonb DEFAULT '{}'::jsonb,
  -- timestamps
  created_at_client  timestamptz NOT NULL,            -- horário no dispositivo
  created_at         timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_collection_events_date ON production_collection_events(date DESC);
CREATE INDEX IF NOT EXISTS idx_collection_events_status ON production_collection_events(status);
CREATE INDEX IF NOT EXISTS idx_collection_events_operator ON production_collection_events(operator_id);

ALTER TABLE production_collection_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collection_events_select" ON production_collection_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "collection_events_insert" ON production_collection_events
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "collection_events_insert_anon" ON production_collection_events
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "collection_events_update_own" ON production_collection_events
  FOR UPDATE TO authenticated USING (true);
GRANT INSERT ON production_collection_events TO anon;

-- ============================================================
-- SEÇÃO 5 — Evoluir tabela occurrences com vínculos de rastreabilidade
-- ============================================================

ALTER TABLE occurrences
  ADD COLUMN IF NOT EXISTS production_order_id  uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id         uuid REFERENCES production_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_reading_id      uuid REFERENCES production_stage_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tag_value             text,
  ADD COLUMN IF NOT EXISTS lot_id                uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_code              text,
  ADD COLUMN IF NOT EXISTS severity              text NOT NULL DEFAULT 'medium'
                                                 CHECK (severity IN ('low','medium','high','critical')),
  ADD COLUMN IF NOT EXISTS status                text NOT NULL DEFAULT 'open'
                                                 CHECK (status IN ('open','in_progress','resolved','cancelled'));

CREATE INDEX IF NOT EXISTS idx_occurrences_reading ON occurrences(stage_reading_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_lot ON occurrences(lot_id);
CREATE INDEX IF NOT EXISTS idx_occurrences_order ON occurrences(production_order_id);

-- ============================================================
-- SEÇÃO 6 — RPC de contexto de coleta (lote + pedido com contagens)
-- ============================================================

CREATE OR REPLACE FUNCTION get_collection_context_summary(
  p_lot_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_lot   production_lots%ROWTYPE;
  v_order production_orders%ROWTYPE;
  v_approved  numeric;
  v_rejected  numeric;
  v_total     numeric;
  v_progress  numeric;
BEGIN
  -- Resolver lote
  IF p_lot_id IS NOT NULL THEN
    SELECT * INTO v_lot FROM production_lots WHERE id = p_lot_id;
  END IF;

  IF v_lot.id IS NULL AND p_order_id IS NOT NULL THEN
    SELECT * INTO v_lot FROM production_lots
    WHERE COALESCE(production_order_id, order_id) = p_order_id
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  -- Resolver pedido
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM production_orders WHERE id = p_order_id;
  END IF;
  IF v_order.id IS NULL AND v_lot.id IS NOT NULL THEN
    SELECT * INTO v_order FROM production_orders
    WHERE id = COALESCE(v_lot.production_order_id, v_lot.order_id);
  END IF;

  -- Contagens de leituras aprovadas/reprovadas do lote
  IF v_lot.id IS NOT NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN status = 'approved' THEN quantity ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN quantity ELSE 0 END), 0),
      COALESCE(SUM(quantity), 0)
    INTO v_approved, v_rejected, v_total
    FROM production_stage_readings
    WHERE lot_id = v_lot.id;

    v_progress := CASE WHEN COALESCE(v_lot.planned_quantity, 0) > 0
      THEN LEAST(ROUND((v_approved / v_lot.planned_quantity) * 100, 1), 100)
      ELSE 0
    END;
  END IF;

  RETURN jsonb_build_object(
    'lot', CASE WHEN v_lot.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',               v_lot.id,
      'lot_code',         v_lot.lot_code,
      'planned_quantity', v_lot.planned_quantity,
      'current_status',   COALESCE(v_lot.current_status, v_lot.status),
      'product_name',     v_lot.product_name,
      'product_code',     v_lot.product_code,
      'current_step',     v_lot.current_step,
      'current_cell',     v_lot.current_cell,
      'approved_quantity', v_approved,
      'rejected_quantity', v_rejected,
      'total_readings',    v_total,
      'pending_quantity',  GREATEST(COALESCE(v_lot.planned_quantity, 0) - COALESCE(v_approved, 0), 0),
      'progress_percent',  v_progress
    ) END,
    'order', CASE WHEN v_order.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',                    v_order.id,
      'order_number',          COALESCE(v_order.order_number, v_order.order_code),
      'system_order_number',   v_order.system_order_number,
      'customer_order_number', v_order.customer_order_number,
      'load_number',           v_order.load_number,
      'customer_trade_name',   COALESCE(v_order.customer_trade_name, v_order.customer_name),
      'customer_legal_name',   COALESCE(v_order.customer_legal_name, v_order.customer_name),
      'finalization_date',     v_order.finalization_date,
      'status',                v_order.status
    ) END,
    'contextFound', v_lot.id IS NOT NULL OR v_order.id IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_collection_context_summary(uuid, uuid) TO authenticated, anon;

-- ============================================================
-- SEÇÃO 7 — RPC para registrar ocorrência vinculada a leitura
-- ============================================================

CREATE OR REPLACE FUNCTION register_reading_occurrence(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_occ_id uuid;
  v_date   date   := COALESCE((p_payload->>'date')::date, current_date);
  v_shift  text   := COALESCE(p_payload->>'shift', to_char(now(), 'HH24') || 'h');
  v_cell   text   := COALESCE(p_payload->>'cell_name', p_payload->>'cellName', '');
  v_reason text   := COALESCE(p_payload->>'reason', 'Ocorrência operacional');
BEGIN
  INSERT INTO occurrences (
    date, shift, cell, reason, downtime, operator, notes,
    stage_reading_id, tag_value, lot_id, lot_code,
    production_order_id, order_item_id, severity, status
  ) VALUES (
    v_date,
    v_shift,
    v_cell,
    v_reason,
    COALESCE((p_payload->>'downtime')::numeric, 0),
    p_payload->>'operator',
    p_payload->>'notes',
    (p_payload->>'stage_reading_id')::uuid,
    p_payload->>'tag_value',
    (p_payload->>'lot_id')::uuid,
    p_payload->>'lot_code',
    (p_payload->>'production_order_id')::uuid,
    (p_payload->>'order_item_id')::uuid,
    COALESCE(p_payload->>'severity', 'medium'),
    'open'
  )
  RETURNING id INTO v_occ_id;

  -- Vincular a leitura à ocorrência
  IF (p_payload->>'stage_reading_id') IS NOT NULL THEN
    UPDATE production_stage_readings
    SET occurrence_id = v_occ_id
    WHERE id = (p_payload->>'stage_reading_id')::uuid
      AND occurrence_id IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true, 'occurrence_id', v_occ_id);
END;
$$;

GRANT EXECUTE ON FUNCTION register_reading_occurrence(jsonb) TO authenticated;

-- ============================================================
-- SEÇÃO 8 — Grants finais e atualização de triggers
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON production_collection_events TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON operators TO anon;

-- Trigger de updated_at para a nova tabela de eventos
DROP TRIGGER IF EXISTS trg_collection_events_updated_at ON production_collection_events;
CREATE TRIGGER trg_collection_events_updated_at
  BEFORE UPDATE ON production_collection_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
