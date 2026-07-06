-- ============================================================
-- AC.Prod MES — Fase 3: Entidade Canônica de Peça
-- Migration 026 — Nova, sem alteração em tabelas existentes
-- Cria: production_pieces, production_events
-- RPCs: create_production_piece, advance_piece_stage, block_piece
-- ============================================================
-- REGRA FUNDAMENTAL:
--   piece_uid     = identidade imutável gerada pelo AC.Prod
--   cut_plan_id   = SEMPRE nullable, nunca obrigatório
--   source_origin = como a peça entrou no sistema (auditável)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- TABELA: production_pieces
-- Entidade canônica da peça individual rastreável
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production_pieces (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identidade imutável (gerada pelo sistema, nunca pelo otimizador)
  piece_uid            text NOT NULL UNIQUE,
  traceability_code    text NOT NULL UNIQUE,

  -- Vínculo com pedido e lote
  production_order_id  uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  lot_id               uuid REFERENCES production_lots(id) ON DELETE SET NULL,

  -- Dados da peça (espelho dos dados de importação)
  module_name          text,
  environment          text,
  piece_name           text NOT NULL DEFAULT '',
  description          text,
  material             text,
  color                text,
  thickness            numeric(8,2),
  width                numeric(8,2),
  height               numeric(8,2),
  length               numeric(8,2),
  grain_direction      text,

  -- Bordas (compatível com Promob)
  edge_front           text,
  edge_back            text,
  edge_left            text,
  edge_right           text,

  -- Flags de processo (vindas de lot_items quando disponível)
  requires_cut         boolean DEFAULT true,
  requires_edge        boolean DEFAULT false,
  requires_cnc         boolean DEFAULT false,
  requires_joinery     boolean DEFAULT false,
  requires_separation  boolean DEFAULT true,
  requires_packaging   boolean DEFAULT true,

  -- Estado na rota
  current_stage        text NOT NULL DEFAULT 'created',
  status               text NOT NULL DEFAULT 'created'
                       CHECK (status IN (
                         'created','planned','in_progress','completed',
                         'blocked','rejected','rework','shipped','cancelled'
                       )),

  -- Origem (NUNCA depende de plano de corte para ser preenchida)
  source_origin        text NOT NULL DEFAULT 'manual'
                       CHECK (source_origin IN (
                         'manual','promob_xml','csv','xlsx','api',
                         'rework','cut_plan','duplicate'
                       )),

  -- Plano de corte (OPCIONAL — sempre nullable por design)
  cut_plan_id          uuid,         -- FK futura para cut_plans
  cut_plan_item_id     uuid,         -- FK futura para cut_plan_items
  optimizer_reference  text,         -- referência do otimizador (Corte Certo, etc.)

  -- Rastreabilidade de retrabalho
  original_piece_id    uuid REFERENCES production_pieces(id) ON DELETE SET NULL,
  is_replacement       boolean DEFAULT false,

  -- Bloqueio
  is_blocked           boolean DEFAULT false,
  block_reason         text,
  blocked_at           timestamptz,
  blocked_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Referências a tabelas legadas (para migração gradual)
  legacy_lot_item_id            uuid REFERENCES lot_items(id) ON DELETE SET NULL,
  legacy_production_lot_item_id uuid REFERENCES production_lot_items(id) ON DELETE SET NULL,

  -- Auditoria
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_production_pieces_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_production_pieces_updated_at ON production_pieces;
CREATE TRIGGER trg_production_pieces_updated_at
  BEFORE UPDATE ON production_pieces
  FOR EACH ROW EXECUTE FUNCTION update_production_pieces_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_production_pieces_piece_uid          ON production_pieces(piece_uid);
CREATE INDEX IF NOT EXISTS idx_production_pieces_traceability_code  ON production_pieces(traceability_code);
CREATE INDEX IF NOT EXISTS idx_production_pieces_production_order_id ON production_pieces(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_pieces_lot_id             ON production_pieces(lot_id);
CREATE INDEX IF NOT EXISTS idx_production_pieces_status             ON production_pieces(status);
CREATE INDEX IF NOT EXISTS idx_production_pieces_current_stage      ON production_pieces(current_stage);
CREATE INDEX IF NOT EXISTS idx_production_pieces_legacy_lot_item_id ON production_pieces(legacy_lot_item_id);
CREATE INDEX IF NOT EXISTS idx_production_pieces_source_origin      ON production_pieces(source_origin);

COMMENT ON TABLE production_pieces IS
  'Entidade canônica da peça individual rastreável. Fase 3 / AC.Prod MES (2025-07). piece_uid é imutável e gerado pelo sistema. cut_plan_id é SEMPRE nullable por design.';

-- ─────────────────────────────────────────────────────────────
-- TABELA: production_events
-- Log canônico de eventos por peça (coexiste com production_stage_readings)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS production_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rastreabilidade
  piece_id             uuid REFERENCES production_pieces(id) ON DELETE SET NULL,
  traceability_code    text NOT NULL,
  production_order_id  uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  lot_id               uuid REFERENCES production_lots(id) ON DELETE SET NULL,

  -- Evento
  event_type           text NOT NULL
                       CHECK (event_type IN (
                         'reading','stage_advance','block','unblock','cancel',
                         'rework_start','rework_complete','pack','unpack',
                         'ship','correction','note'
                       )),
  from_stage           text,
  to_stage             text,
  cell_name            text,
  machine_id           text,
  device_id            text,
  operator_id          uuid REFERENCES operators(id) ON DELETE SET NULL,

  -- Resultado
  event_status         text NOT NULL DEFAULT 'accepted'
                       CHECK (event_status IN (
                         'accepted','rejected','blocked','duplicated','warning'
                       )),
  rejection_reason     text,
  reading_source       text,
  barcode_raw_value    text,
  notes                text,
  metadata             jsonb NOT NULL DEFAULT '{}',

  -- Referência ao sistema legado (para rastreabilidade cruzada)
  legacy_stage_reading_id uuid REFERENCES production_stage_readings(id) ON DELETE SET NULL,

  -- Auditoria
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_production_events_piece_id           ON production_events(piece_id);
CREATE INDEX IF NOT EXISTS idx_production_events_traceability_code  ON production_events(traceability_code);
CREATE INDEX IF NOT EXISTS idx_production_events_lot_id             ON production_events(lot_id);
CREATE INDEX IF NOT EXISTS idx_production_events_event_type         ON production_events(event_type);
CREATE INDEX IF NOT EXISTS idx_production_events_event_status       ON production_events(event_status);
CREATE INDEX IF NOT EXISTS idx_production_events_created_at         ON production_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_events_cell_name          ON production_events(cell_name);

COMMENT ON TABLE production_events IS
  'Log canônico de eventos por peça. Fase 3 / AC.Prod MES (2025-07). Coexiste com production_stage_readings durante a migração gradual.';

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────

ALTER TABLE production_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_events  ENABLE ROW LEVEL SECURITY;

-- Qualquer autenticado pode ler peças
CREATE POLICY "pieces_select" ON production_pieces
  FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE/DELETE apenas via RPCs (SECURITY DEFINER)
-- Política restritiva: bloqueia acesso direto de escrita do client
CREATE POLICY "pieces_insert_rpc_only" ON production_pieces
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY "pieces_update_rpc_only" ON production_pieces
  FOR UPDATE TO authenticated USING (false);

CREATE POLICY "pieces_delete_rpc_only" ON production_pieces
  FOR DELETE TO authenticated USING (false);

-- Eventos: leitura para todos autenticados, escrita somente via RPC
CREATE POLICY "events_select" ON production_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "events_insert_rpc_only" ON production_events
  FOR INSERT TO authenticated WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────
-- FUNÇÃO AUXILIAR: Geração de piece_uid
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_piece_uid()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_date  text := to_char(now(), 'YYYYMMDD');
  v_rand  text := upper(substring(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 6));
  v_uid   text;
BEGIN
  v_uid := 'PC-' || v_date || '-' || v_rand;
  -- Garantir unicidade (colisão extremamente improvável, mas protegida)
  WHILE EXISTS (SELECT 1 FROM production_pieces WHERE piece_uid = v_uid) LOOP
    v_rand := upper(substring(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 6));
    v_uid  := 'PC-' || v_date || '-' || v_rand;
  END LOOP;
  RETURN v_uid;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: create_production_piece
-- Cria uma peça canônica com piece_uid e traceability_code imutáveis
-- NUNCA exige cut_plan_id
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_production_piece(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid          text := generate_piece_uid();
  v_tcode        text;
  v_piece        production_pieces%ROWTYPE;
  v_user_id      uuid;
  v_role         text;
BEGIN
  -- Autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Autenticação necessária.');
  END IF;

  v_role := get_my_role();
  IF v_role NOT IN ('admin', 'manager', 'operator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão insuficiente para criar peças.');
  END IF;

  -- Gerar traceability_code = piece_uid sem prefixo (para barcode compacto)
  v_tcode := replace(v_uid, 'PC-', '');

  INSERT INTO production_pieces (
    piece_uid,
    traceability_code,
    production_order_id,
    lot_id,
    module_name,
    environment,
    piece_name,
    description,
    material,
    color,
    thickness,
    width,
    height,
    length,
    grain_direction,
    edge_front,
    edge_back,
    edge_left,
    edge_right,
    requires_cut,
    requires_edge,
    requires_cnc,
    requires_joinery,
    requires_separation,
    requires_packaging,
    current_stage,
    status,
    source_origin,
    cut_plan_id,
    cut_plan_item_id,
    optimizer_reference,
    original_piece_id,
    is_replacement,
    legacy_lot_item_id,
    legacy_production_lot_item_id,
    created_by
  ) VALUES (
    v_uid,
    v_tcode,
    (p_payload->>'production_order_id')::uuid,
    (p_payload->>'lot_id')::uuid,
    p_payload->>'module_name',
    p_payload->>'environment',
    COALESCE(NULLIF(p_payload->>'piece_name', ''), 'Peça sem nome'),
    p_payload->>'description',
    p_payload->>'material',
    p_payload->>'color',
    (p_payload->>'thickness')::numeric,
    (p_payload->>'width')::numeric,
    (p_payload->>'height')::numeric,
    (p_payload->>'length')::numeric,
    p_payload->>'grain_direction',
    p_payload->>'edge_front',
    p_payload->>'edge_back',
    p_payload->>'edge_left',
    p_payload->>'edge_right',
    COALESCE((p_payload->>'requires_cut')::boolean, true),
    COALESCE((p_payload->>'requires_edge')::boolean, false),
    COALESCE((p_payload->>'requires_cnc')::boolean, false),
    COALESCE((p_payload->>'requires_joinery')::boolean, false),
    COALESCE((p_payload->>'requires_separation')::boolean, true),
    COALESCE((p_payload->>'requires_packaging')::boolean, true),
    COALESCE(NULLIF(p_payload->>'current_stage', ''), 'created'),
    'created',
    COALESCE(NULLIF(p_payload->>'source_origin', ''), 'manual'),
    (p_payload->>'cut_plan_id')::uuid,       -- NULLABLE por design
    (p_payload->>'cut_plan_item_id')::uuid,  -- NULLABLE por design
    p_payload->>'optimizer_reference',
    (p_payload->>'original_piece_id')::uuid,
    COALESCE((p_payload->>'is_replacement')::boolean, false),
    (p_payload->>'legacy_lot_item_id')::uuid,
    (p_payload->>'legacy_production_lot_item_id')::uuid,
    v_user_id
  )
  RETURNING * INTO v_piece;

  -- Registrar evento de criação
  INSERT INTO production_events (
    piece_id,
    traceability_code,
    production_order_id,
    lot_id,
    event_type,
    from_stage,
    to_stage,
    event_status,
    metadata
  ) VALUES (
    v_piece.id,
    v_tcode,
    v_piece.production_order_id,
    v_piece.lot_id,
    'reading',
    NULL,
    'created',
    'accepted',
    jsonb_build_object(
      'source_origin', v_piece.source_origin,
      'created_by_role', v_role
    )
  );

  RETURN jsonb_build_object(
    'success',           true,
    'piece_id',          v_piece.id,
    'piece_uid',         v_piece.piece_uid,
    'traceability_code', v_piece.traceability_code,
    'status',            v_piece.status,
    'current_stage',     v_piece.current_stage,
    'source_origin',     v_piece.source_origin
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: advance_piece_stage
-- Avança a peça para a próxima etapa da rota produtiva
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION advance_piece_stage(p_piece_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_piece       production_pieces%ROWTYPE;
  v_user_id     uuid;
  v_role        text;
  v_to_stage    text;
  v_from_stage  text;
  v_operator_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Autenticação necessária.');
  END IF;

  v_role := get_my_role();
  IF v_role NOT IN ('admin', 'manager', 'operator') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Permissão insuficiente.');
  END IF;

  SELECT * INTO v_piece FROM production_pieces WHERE id = p_piece_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça não encontrada.');
  END IF;

  IF v_piece.is_blocked THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça bloqueada: ' || COALESCE(v_piece.block_reason, 'sem motivo informado'));
  END IF;

  IF v_piece.status IN ('cancelled', 'shipped') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça com status ' || v_piece.status || ' não pode avançar etapas.');
  END IF;

  v_from_stage := v_piece.current_stage;
  v_to_stage   := COALESCE(NULLIF(p_payload->>'to_stage', ''), v_from_stage);
  v_operator_id := (p_payload->>'operator_id')::uuid;

  UPDATE production_pieces SET
    current_stage = v_to_stage,
    status = CASE
      WHEN v_to_stage = 'shipped'   THEN 'shipped'
      WHEN v_to_stage = 'completed' THEN 'completed'
      ELSE 'in_progress'
    END,
    updated_at = now()
  WHERE id = p_piece_id;

  INSERT INTO production_events (
    piece_id,
    traceability_code,
    production_order_id,
    lot_id,
    event_type,
    from_stage,
    to_stage,
    cell_name,
    device_id,
    operator_id,
    event_status,
    notes,
    metadata
  ) VALUES (
    v_piece.id,
    v_piece.traceability_code,
    v_piece.production_order_id,
    v_piece.lot_id,
    'stage_advance',
    v_from_stage,
    v_to_stage,
    p_payload->>'cell_name',
    p_payload->>'device_id',
    v_operator_id,
    'accepted',
    p_payload->>'notes',
    COALESCE(p_payload->'metadata', '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'success',       true,
    'piece_id',      v_piece.id,
    'from_stage',    v_from_stage,
    'to_stage',      v_to_stage,
    'new_status',    CASE
      WHEN v_to_stage = 'shipped'   THEN 'shipped'
      WHEN v_to_stage = 'completed' THEN 'completed'
      ELSE 'in_progress'
    END
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: block_piece
-- Bloqueia uma peça com motivo obrigatório (admin/manager)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION block_piece(p_piece_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_piece    production_pieces%ROWTYPE;
  v_user_id  uuid;
  v_role     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Autenticação necessária.');
  END IF;

  v_role := get_my_role();
  IF v_role NOT IN ('admin', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apenas admin ou manager podem bloquear peças.');
  END IF;

  IF TRIM(COALESCE(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Motivo de bloqueio é obrigatório.');
  END IF;

  SELECT * INTO v_piece FROM production_pieces WHERE id = p_piece_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça não encontrada.');
  END IF;

  UPDATE production_pieces SET
    is_blocked   = true,
    block_reason = p_reason,
    blocked_at   = now(),
    blocked_by   = v_user_id,
    status       = 'blocked',
    updated_at   = now()
  WHERE id = p_piece_id;

  INSERT INTO production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status, notes
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'block', v_piece.current_stage, v_piece.current_stage, 'accepted', p_reason
  );

  RETURN jsonb_build_object(
    'success',      true,
    'piece_id',     v_piece.id,
    'piece_uid',    v_piece.piece_uid,
    'block_reason', p_reason
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: cancel_piece
-- Cancela uma peça (não pode reverter — estado final)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cancel_piece(p_piece_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_piece   production_pieces%ROWTYPE;
  v_user_id uuid;
  v_role    text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Autenticação necessária.');
  END IF;

  v_role := get_my_role();
  IF v_role NOT IN ('admin', 'manager') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apenas admin ou manager podem cancelar peças.');
  END IF;

  IF TRIM(COALESCE(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Motivo de cancelamento é obrigatório.');
  END IF;

  SELECT * INTO v_piece FROM production_pieces WHERE id = p_piece_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça não encontrada.');
  END IF;

  IF v_piece.status = 'shipped' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Peça já expedida não pode ser cancelada.');
  END IF;

  UPDATE production_pieces SET
    status     = 'cancelled',
    is_blocked = true,
    block_reason = 'CANCELADA: ' || p_reason,
    updated_at = now()
  WHERE id = p_piece_id;

  INSERT INTO production_events (
    piece_id, traceability_code, production_order_id, lot_id,
    event_type, from_stage, to_stage, event_status, notes
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'cancel', v_piece.current_stage, 'cancelled', 'accepted', p_reason
  );

  RETURN jsonb_build_object(
    'success',  true,
    'piece_id', v_piece.id,
    'piece_uid', v_piece.piece_uid,
    'reason',   p_reason
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- GRANTS para RPCs (acessíveis pelo cliente anon autenticado)
-- ─────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION create_production_piece(jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION advance_piece_stage(uuid, jsonb)        TO authenticated;
GRANT EXECUTE ON FUNCTION block_piece(uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_piece(uuid, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION generate_piece_uid()                    TO authenticated;
