-- ============================================================================
-- Migration: 20260725120000_quality_replacement_downtime.sql
-- Descrição: Implantação dos módulos de Reposição, Qualidade e Paradas na Coleta.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. CATÁLOGO DE DEFEITOS DE QUALIDADE (6M)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quality_defect_catalog (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  description        text,
  category           text NOT NULL DEFAULT 'Geral',
  six_m_category     text NOT NULL CHECK (six_m_category IN ('Máquina', 'Método', 'Material', 'Mão de obra', 'Medição', 'Meio ambiente')),
  default_severity   text NOT NULL DEFAULT 'medium' CHECK (default_severity IN ('low', 'medium', 'high', 'critical')),
  applicable_cells   text[] DEFAULT ARRAY[]::text[],
  active             boolean NOT NULL DEFAULT true,
  display_order      integer DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_defect_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_defect_catalog_read"
  ON public.quality_defect_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "quality_defect_catalog_manage"
  ON public.quality_defect_catalog FOR ALL TO authenticated
  USING (public.has_permission('manage_quality') OR public.is_admin_or_manager())
  WITH CHECK (public.has_permission('manage_quality') OR public.is_admin_or_manager());

-- Seeds de defeitos padrão
INSERT INTO public.quality_defect_catalog (code, name, category, six_m_category, default_severity, display_order) VALUES
  ('DEF-001', 'MDF riscado', 'Superfície', 'Material', 'low', 1),
  ('DEF-002', 'Peça lascada', 'Bordas e Cantos', 'Material', 'medium', 2),
  ('DEF-003', 'Erro de corte', 'Dimensionamento', 'Máquina', 'high', 3),
  ('DEF-004', 'Erro de medida', 'Dimensionamento', 'Medição', 'high', 4),
  ('DEF-005', 'Erro de furação', 'Usinagem', 'Máquina', 'medium', 5),
  ('DEF-006', 'Erro de CNC', 'Usinagem', 'Método', 'high', 6),
  ('DEF-007', 'Borda errada', 'Fita de Borda', 'Material', 'medium', 7),
  ('DEF-008', 'Borda descolada', 'Fita de Borda', 'Máquina', 'medium', 8),
  ('DEF-009', 'Peça quebrada', 'Estrutura', 'Mão de obra', 'critical', 9),
  ('DEF-010', 'Peça perdida', 'Logística Interna', 'Mão de obra', 'high', 10),
  ('DEF-011', 'Falha de acabamento', 'Acabamento', 'Mão de obra', 'medium', 11),
  ('DEF-012', 'Umidade / Empenamento', 'Armazenamento', 'Meio ambiente', 'high', 12),
  ('DEF-099', 'Outro', 'Geral', 'Método', 'medium', 99)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  six_m_category = EXCLUDED.six_m_category,
  default_severity = EXCLUDED.default_severity;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. TABELA DE NÃO CONFORMIDADES DE QUALIDADE
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quality_nonconformities (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nc_code                 text NOT NULL UNIQUE,
  piece_id                uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  reading_id              uuid REFERENCES public.production_stage_readings(id) ON DELETE SET NULL,
  occurrence_id           uuid REFERENCES public.occurrences(id) ON DELETE SET NULL,
  defect_id               uuid REFERENCES public.quality_defect_catalog(id) ON DELETE SET NULL,
  defect_code             text,
  defect_name             text NOT NULL,
  quantity                integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  severity                text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  disposition             text NOT NULL CHECK (disposition IN ('scrap', 'rework', 'replacement', 'use_as_is', 'hold')),
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contained', 'analysis', 'action_plan', 'verification', 'closed', 'cancelled')),
  lot_id                  uuid REFERENCES public.production_lots(id) ON DELETE SET NULL,
  lot_code                text,
  production_order_id     uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  order_number            text,
  customer_name           text,
  environment_name        text,
  cell_id                 uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  cell_name               text,
  stage_name              text,
  machine_id              uuid REFERENCES public.workstations(id) ON DELETE SET NULL,
  operator_id             uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  operator_name           text,
  detected_at             timestamptz NOT NULL DEFAULT now(),
  owner_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deadline                timestamptz,
  notes                   text,
  related_replacement_id  uuid, -- FK adicionada após ajustar replacement_orders
  related_rework_id       uuid REFERENCES public.rework_orders(id) ON DELETE SET NULL,
  opened_at               timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz,
  closed_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_event_id         uuid UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_nonconformities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_nonconformities_read"
  ON public.quality_nonconformities FOR SELECT TO authenticated
  USING (
    public.has_permission('view_quality') OR public.has_permission('manage_quality')
  );

CREATE POLICY "quality_nonconformities_write"
  ON public.quality_nonconformities FOR ALL TO authenticated
  USING (
    public.has_permission('manage_quality') OR public.is_admin_or_manager()
  )
  WITH CHECK (
    public.has_permission('manage_quality') OR public.is_admin_or_manager()
  );

CREATE INDEX IF NOT EXISTS idx_nc_detected_at ON public.quality_nonconformities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_nc_defect_id ON public.quality_nonconformities(defect_id);
CREATE INDEX IF NOT EXISTS idx_nc_cell_id ON public.quality_nonconformities(cell_id);
CREATE INDEX IF NOT EXISTS idx_nc_machine_id ON public.quality_nonconformities(machine_id);
CREATE INDEX IF NOT EXISTS idx_nc_lot_id ON public.quality_nonconformities(lot_id);
CREATE INDEX IF NOT EXISTS idx_nc_order_id ON public.quality_nonconformities(production_order_id);
CREATE INDEX IF NOT EXISTS idx_nc_status ON public.quality_nonconformities(status);
CREATE INDEX IF NOT EXISTS idx_nc_disposition ON public.quality_nonconformities(disposition);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. PLANOS DE AÇÃO DA QUALIDADE (5W2H)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quality_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonconformity_id      uuid NOT NULL REFERENCES public.quality_nonconformities(id) ON DELETE CASCADE,
  action_type           text NOT NULL CHECK (action_type IN ('containment', 'corrective', 'preventive')),
  what                  text NOT NULL,
  why                   text,
  where_location        text,
  when_deadline         timestamptz,
  who_owner_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  who_owner_name        text,
  how                   text,
  how_much              numeric DEFAULT 0,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'verified', 'cancelled')),
  evidence_url          text,
  result_notes          text,
  efficacy_verified     boolean NOT NULL DEFAULT false,
  efficacy_verified_at  timestamptz,
  efficacy_verified_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quality_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_actions_read"
  ON public.quality_actions FOR SELECT TO authenticated
  USING (public.has_permission('view_quality') OR public.has_permission('manage_quality'));

CREATE POLICY "quality_actions_write"
  ON public.quality_actions FOR ALL TO authenticated
  USING (public.has_permission('manage_quality') OR public.is_admin_or_manager())
  WITH CHECK (public.has_permission('manage_quality') OR public.is_admin_or_manager());

CREATE INDEX IF NOT EXISTS idx_quality_actions_nc ON public.quality_actions(nonconformity_id);
CREATE INDEX IF NOT EXISTS idx_quality_actions_owner ON public.quality_actions(who_owner_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 4. CATÁLOGO DE MOTIVOS DE PARADA (DOWNTIME)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.downtime_reason_catalog (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  description          text,
  category             text NOT NULL DEFAULT 'Operacional',
  is_planned           boolean NOT NULL DEFAULT false,
  counts_for_oee       boolean NOT NULL DEFAULT true,
  default_severity     text NOT NULL DEFAULT 'medium' CHECK (default_severity IN ('low', 'medium', 'high', 'critical')),
  applicable_cells     text[] DEFAULT ARRAY[]::text[],
  applicable_machines  text[] DEFAULT ARRAY[]::text[],
  active               boolean NOT NULL DEFAULT true,
  display_order        integer DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.downtime_reason_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "downtime_reason_catalog_read"
  ON public.downtime_reason_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "downtime_reason_catalog_manage"
  ON public.downtime_reason_catalog FOR ALL TO authenticated
  USING (public.has_permission('manage_downtime_reasons') OR public.is_admin_or_manager())
  WITH CHECK (public.has_permission('manage_downtime_reasons') OR public.is_admin_or_manager());

-- Seeds de motivos de parada
INSERT INTO public.downtime_reason_catalog (code, name, category, is_planned, counts_for_oee, display_order) VALUES
  ('DOWN-001', 'Falha de máquina', 'Manutenção Corretiva', false, true, 1),
  ('DOWN-002', 'Setup', 'Setup e Troca', true, false, 2),
  ('DOWN-003', 'Falta de material', 'Logística e Suprimentos', false, true, 3),
  ('DOWN-004', 'Falta de operador', 'Recursos Humanos', false, true, 4),
  ('DOWN-005', 'Falta de ferramenta', 'Ferramental', false, true, 5),
  ('DOWN-006', 'Ajuste de qualidade', 'Qualidade', false, true, 6),
  ('DOWN-007', 'Manutenção preventiva', 'Manutenção Preventiva', true, false, 7),
  ('DOWN-008', 'Manutenção corretiva', 'Manutenção Corretiva', false, true, 8),
  ('DOWN-009', 'Limpeza', 'Organização 5S', true, false, 9),
  ('DOWN-010', 'Reunião', 'Administrativo', true, false, 10),
  ('DOWN-011', 'Falta de energia', 'Utilidades', false, true, 11),
  ('DOWN-012', 'Falta de programação', 'PCP', false, true, 12),
  ('DOWN-013', 'Bloqueio de lote', 'Qualidade', false, true, 13),
  ('DOWN-014', 'Aguardando engenharia', 'Engenharia', false, true, 14),
  ('DOWN-099', 'Outro', 'Operacional', false, true, 99)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  counts_for_oee = EXCLUDED.counts_for_oee;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. EVOLUÇÃO DA TABELA REPLACEMENT_ORDERS
-- ────────────────────────────────────────────────────────────────────────────
-- Atualizar o Check Constraint de status para suportar a máquina de estados padronizada
ALTER TABLE public.replacement_orders DROP CONSTRAINT IF EXISTS replacement_orders_status_check;

-- Migrar textos antigos em português para os códigos técnicos padronizados
UPDATE public.replacement_orders SET status = 'requested' WHERE status = 'Reposição solicitada';
UPDATE public.replacement_orders SET status = 'in_production' WHERE status = 'Reposição em produção';
UPDATE public.replacement_orders SET status = 'completed' WHERE status = 'Finalizada';
UPDATE public.replacement_orders SET status = 'cancelled' WHERE status = 'Cancelada';

ALTER TABLE public.replacement_orders
  ADD CONSTRAINT replacement_orders_status_check
  CHECK (status IN ('requested', 'under_review', 'approved', 'released', 'in_production', 'completed', 'cancelled'));

ALTER TABLE public.replacement_orders
  ALTER COLUMN status SET DEFAULT 'requested';

-- Adicionar colunas faltantes de contexto e rastreabilidade
ALTER TABLE public.replacement_orders
  ADD COLUMN IF NOT EXISTS replacement_code   text UNIQUE,
  ADD COLUMN IF NOT EXISTS defect_id          uuid REFERENCES public.quality_defect_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS defect_name        text,
  ADD COLUMN IF NOT EXISTS origin_cell_id     uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_cell_name   text,
  ADD COLUMN IF NOT EXISTS rejection_stage    text,
  ADD COLUMN IF NOT EXISTS lot_code           text,
  ADD COLUMN IF NOT EXISTS order_number       text,
  ADD COLUMN IF NOT EXISTS customer_name      text,
  ADD COLUMN IF NOT EXISTS environment_name   text,
  ADD COLUMN IF NOT EXISTS operator_id        uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_name      text,
  ADD COLUMN IF NOT EXISTS requester_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS released_at        timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS notes              text,
  ADD COLUMN IF NOT EXISTS deadline           timestamptz,
  ADD COLUMN IF NOT EXISTS history            jsonb DEFAULT '[]'::jsonb;

-- Vincular FK em quality_nonconformities agora que replacement_orders está pronto
ALTER TABLE public.quality_nonconformities
  DROP CONSTRAINT IF EXISTS fk_quality_nc_replacement,
  ADD CONSTRAINT fk_quality_nc_replacement
  FOREIGN KEY (related_replacement_id) REFERENCES public.replacement_orders(id) ON DELETE SET NULL;

-- Restrição parcial: Impede 2 ordens de reposição ativas para a mesma peça original
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_replacement_per_piece
  ON public.replacement_orders (original_piece_id)
  WHERE status NOT IN ('completed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_repl_original_piece ON public.replacement_orders(original_piece_id);
CREATE INDEX IF NOT EXISTS idx_repl_substitute_piece ON public.replacement_orders(replacement_piece_id);
CREATE INDEX IF NOT EXISTS idx_repl_lot_id ON public.replacement_orders(lot_id);
CREATE INDEX IF NOT EXISTS idx_repl_order_id ON public.replacement_orders(production_order_id);
CREATE INDEX IF NOT EXISTS idx_repl_created_by ON public.replacement_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_repl_status ON public.replacement_orders(status);
CREATE INDEX IF NOT EXISTS idx_repl_priority ON public.replacement_orders(priority);
CREATE INDEX IF NOT EXISTS idx_repl_created_at ON public.replacement_orders(created_at DESC);


-- ────────────────────────────────────────────────────────────────────────────
-- 6. EVOLUÇÃO DA TABELA OCCURRENCES (PARADAS E DEFEITOS)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.occurrences
  ADD COLUMN IF NOT EXISTS occurrence_type       text DEFAULT 'quality' CHECK (occurrence_type IN ('quality', 'downtime', 'productivity', 'other')),
  ADD COLUMN IF NOT EXISTS downtime_reason_id    uuid REFERENCES public.downtime_reason_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS downtime_reason_code  text,
  ADD COLUMN IF NOT EXISTS started_at            timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at              timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cell_id               uuid REFERENCES public.cells(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS machine_id            uuid REFERENCES public.workstations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_id           uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operator_session_id   uuid REFERENCES public.operator_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source                text DEFAULT 'collection_app',
  ADD COLUMN IF NOT EXISTS client_event_id       uuid UNIQUE;

-- Índices parciais para evitar 2 paradas simultâneas abertas no mesmo equipamento / célula
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_downtime_machine
  ON public.occurrences (machine_id)
  WHERE status = 'open' AND occurrence_type = 'downtime' AND machine_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_open_downtime_cell_session
  ON public.occurrences (cell_id, operator_session_id)
  WHERE status = 'open' AND occurrence_type = 'downtime' AND machine_id IS NULL AND operator_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_occ_started_at ON public.occurrences(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_occ_ended_at ON public.occurrences(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_occ_cell_id ON public.occurrences(cell_id);
CREATE INDEX IF NOT EXISTS idx_occ_machine_id ON public.occurrences(machine_id);
CREATE INDEX IF NOT EXISTS idx_occ_downtime_reason ON public.occurrences(downtime_reason_id);
CREATE INDEX IF NOT EXISTS idx_occ_client_event ON public.occurrences(client_event_id);


-- ────────────────────────────────────────────────────────────────────────────
-- 7. RPCs TRANSACIONAIS DE REPOSIÇÃO E QUALIDADE
-- ────────────────────────────────────────────────────────────────────────────

-- 7.1. RPC para transação atômica de Reprovação de Qualidade
CREATE OR REPLACE FUNCTION public.register_quality_rejection(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_piece_id uuid;
  v_piece record;
  v_traceability_code text;
  v_reason text;
  v_notes text;
  v_disposition text;
  v_defect_id uuid;
  v_defect record;
  v_severity text;
  v_cell_name text;
  v_cell_id uuid;
  v_machine_id uuid;
  v_operator_id uuid;
  v_operator_name text;
  v_client_event_id uuid;
  v_reading_id uuid;
  v_occurrence_id uuid;
  v_nc_id uuid;
  v_nc_code text;
  v_replacement_order_id uuid := NULL;
  v_rework_order_id uuid := NULL;
  v_substitute_piece_id uuid := NULL;
BEGIN
  -- Extrair parâmetros
  v_traceability_code := p_payload->>'traceability_code';
  v_reason            := COALESCE(p_payload->>'reason', 'Defeito detectado na coleta');
  v_notes             := p_payload->>'notes';
  v_disposition       := COALESCE(p_payload->>'disposition', 'scrap');
  v_cell_name         := p_payload->>'cell_name';
  v_operator_name     := p_payload->>'operator_name';
  
  IF p_payload->>'defect_id' IS NOT NULL AND p_payload->>'defect_id' != '' THEN
    v_defect_id := (p_payload->>'defect_id')::uuid;
  END IF;
  IF p_payload->>'cell_id' IS NOT NULL AND p_payload->>'cell_id' != '' THEN
    v_cell_id := (p_payload->>'cell_id')::uuid;
  END IF;
  IF p_payload->>'machine_id' IS NOT NULL AND p_payload->>'machine_id' != '' THEN
    v_machine_id := (p_payload->>'machine_id')::uuid;
  END IF;
  IF p_payload->>'operator_id' IS NOT NULL AND p_payload->>'operator_id' != '' THEN
    v_operator_id := (p_payload->>'operator_id')::uuid;
  END IF;
  IF p_payload->>'client_event_id' IS NOT NULL AND p_payload->>'client_event_id' != '' THEN
    v_client_event_id := (p_payload->>'client_event_id')::uuid;
    -- Verificação de Idempotência
    SELECT id INTO v_nc_id FROM public.quality_nonconformities WHERE client_event_id = v_client_event_id;
    IF v_nc_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'nonconformity_id', v_nc_id);
    END IF;
  END IF;

  -- Localizar peça
  IF p_payload->>'piece_id' IS NOT NULL AND p_payload->>'piece_id' != '' THEN
    v_piece_id := (p_payload->>'piece_id')::uuid;
    SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece_id;
  ELSE
    SELECT * INTO v_piece FROM public.production_pieces WHERE piece_uid = v_traceability_code LIMIT 1;
    IF v_piece IS NOT NULL THEN
      v_piece_id := v_piece.id;
    END IF;
  END IF;

  -- Obter severidade do catálogo se disponível
  IF v_defect_id IS NOT NULL THEN
    SELECT * INTO v_defect FROM public.quality_defect_catalog WHERE id = v_defect_id;
    v_severity := COALESCE(p_payload->>'severity', v_defect.default_severity, 'medium');
  ELSE
    v_severity := COALESCE(p_payload->>'severity', 'medium');
  END IF;

  -- 1. Registrar leitura de reprovação em production_stage_readings
  INSERT INTO public.production_stage_readings (
    piece_id, piece_code, tag_value, raw_value, cell_name, machine_id,
    operator_id, operator_name, status, rejection_reason, notes,
    lot_id, production_order_id, step_name, created_by
  ) VALUES (
    v_piece_id,
    COALESCE(v_piece.piece_code, v_traceability_code),
    v_traceability_code,
    v_traceability_code,
    v_cell_name,
    v_machine_id,
    v_operator_id,
    v_operator_name,
    'rejected',
    v_reason,
    v_notes,
    v_piece.lot_id,
    v_piece.production_order_id,
    COALESCE(v_piece.current_stage, 'Coleta'),
    v_user_id
  ) RETURNING id INTO v_reading_id;

  -- 2. Criar registro em occurrences
  INSERT INTO public.occurrences (
    date, shift, cell, reason, downtime, operator, notes,
    created_by, lot_id, production_order_id, stage_reading_id,
    severity, status, occurrence_type, cell_id, machine_id, operator_id, client_event_id
  ) VALUES (
    CURRENT_DATE,
    COALESCE(p_payload->>'shift', '1'),
    COALESCE(v_cell_name, 'Geral'),
    v_reason,
    0,
    v_operator_name,
    v_notes,
    v_user_id,
    v_piece.lot_id,
    v_piece.production_order_id,
    v_reading_id,
    v_severity,
    'open',
    'quality',
    v_cell_id,
    v_machine_id,
    v_operator_id,
    v_client_event_id
  ) RETURNING id INTO v_occurrence_id;

  -- 3. Atualizar estado da peça original para reprovada ou bloqueada (não marcaremos como 'replaced' aqui!)
  IF v_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = CASE WHEN v_disposition = 'hold' THEN 'blocked' ELSE 'rejected' END,
        updated_at = now()
    WHERE id = v_piece_id;
  END IF;

  -- 4. Gerar código único para Não Conformidade (NC-AAAA-0000X)
  v_nc_code := 'NC-' || to_char(now(), 'YYYY') || '-' || lpad(floor(random() * 89999 + 10000)::text, 5, '0');

  -- 5. Criar registro em quality_nonconformities
  INSERT INTO public.quality_nonconformities (
    nc_code, piece_id, reading_id, occurrence_id, defect_id, defect_code,
    defect_name, quantity, severity, disposition, status, lot_id, lot_code,
    production_order_id, order_number, customer_name, environment_name,
    cell_id, cell_name, stage_name, machine_id, operator_id, operator_name,
    notes, client_event_id, created_by
  ) VALUES (
    v_nc_code,
    v_piece_id,
    v_reading_id,
    v_occurrence_id,
    v_defect_id,
    COALESCE(v_defect.code, 'DEF-GEN'),
    COALESCE(v_defect.name, v_reason),
    1,
    v_severity,
    v_disposition,
    'open',
    v_piece.lot_id,
    v_piece.lot_code,
    v_piece.production_order_id,
    v_piece.order_number,
    v_piece.customer_name,
    v_piece.environment_name,
    v_cell_id,
    v_cell_name,
    v_piece.current_stage,
    v_machine_id,
    v_operator_id,
    v_operator_name,
    v_notes,
    v_client_event_id,
    v_user_id
  ) RETURNING id INTO v_nc_id;

  -- 6. Processar disposição escolhida
  IF v_disposition = 'replacement' AND v_piece_id IS NOT NULL THEN
    -- Criar Ordem de Reposição no estado 'requested'
    INSERT INTO public.replacement_orders (
      original_piece_id,
      reason,
      priority,
      lot_id,
      production_order_id,
      status,
      created_by,
      defect_id,
      defect_name,
      origin_cell_id,
      origin_cell_name,
      rejection_stage,
      lot_code,
      order_number,
      customer_name,
      environment_name,
      operator_id,
      operator_name,
      requester_id,
      notes
    ) VALUES (
      v_piece_id,
      v_reason,
      CASE WHEN v_severity = 'critical' THEN 'critical' WHEN v_severity = 'high' THEN 'high' ELSE 'normal' END,
      v_piece.lot_id,
      v_piece.production_order_id,
      'requested',
      v_user_id,
      v_defect_id,
      COALESCE(v_defect.name, v_reason),
      v_cell_id,
      v_cell_name,
      v_piece.current_stage,
      v_piece.lot_code,
      v_piece.order_number,
      v_piece.customer_name,
      v_piece.environment_name,
      v_operator_id,
      v_operator_name,
      v_user_id,
      v_notes
    ) RETURNING id INTO v_replacement_order_id;

    -- Vincular a ordem de reposição à NC
    UPDATE public.quality_nonconformities
    SET related_replacement_id = v_replacement_order_id
    WHERE id = v_nc_id;

  ELSIF v_disposition = 'rework' AND v_piece_id IS NOT NULL THEN
    -- Criar Ordem de Retrabalho se a tabela existir
    BEGIN
      INSERT INTO public.rework_orders (
        piece_id, rework_reason_code, operator_id, notes, status, created_by
      ) VALUES (
        v_piece_id,
        COALESCE(v_defect.code, 'REWORK'),
        v_operator_id,
        v_notes,
        'open',
        v_user_id
      ) RETURNING id INTO v_rework_order_id;

      UPDATE public.quality_nonconformities
      SET related_rework_id = v_rework_order_id
      WHERE id = v_nc_id;
    EXCEPTION WHEN OTHERS THEN
      -- Fallback gracioso se a tabela rework_orders não existir
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reading_id', v_reading_id,
    'occurrence_id', v_occurrence_id,
    'nonconformity_id', v_nc_id,
    'nc_code', v_nc_code,
    'replacement_order_id', v_replacement_order_id,
    'rework_order_id', v_rework_order_id
  );
END;
$$;


-- 7.2. RPC para Solicitar Reposição de Peça
CREATE OR REPLACE FUNCTION public.request_piece_replacement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_piece_id uuid := (p_payload->>'original_piece_id')::uuid;
  v_piece record;
  v_reason text := COALESCE(p_payload->>'reason', 'Solicitação de reposição');
  v_priority text := COALESCE(p_payload->>'priority', 'high');
  v_notes text := p_payload->>'notes';
  v_existing_order_id uuid;
  v_order_id uuid;
  v_code text;
BEGIN
  IF v_piece_id IS NULL THEN
    RAISE EXCEPTION 'ID da peça original é obrigatório.';
  END IF;

  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece_id;
  IF v_piece IS NULL THEN
    RAISE EXCEPTION 'Peça original não encontrada.';
  END IF;

  -- Impedir 2 ordens ativas para a mesma peça original
  SELECT id INTO v_existing_order_id
  FROM public.replacement_orders
  WHERE original_piece_id = v_piece_id AND status NOT IN ('completed', 'cancelled');

  IF v_existing_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe uma ordem de reposição ativa (ID: %) para esta peça.', v_existing_order_id;
  END IF;

  v_code := 'REP-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(floor(random() * 8999 + 1000)::text, 4, '0');

  INSERT INTO public.replacement_orders (
    replacement_code, original_piece_id, reason, priority, lot_id,
    production_order_id, status, created_by, requester_id, notes,
    lot_code, order_number, customer_name, environment_name
  ) VALUES (
    v_code, v_piece_id, v_reason, v_priority, v_piece.lot_id,
    v_piece.production_order_id, 'requested', v_user_id, v_user_id, v_notes,
    v_piece.lot_code, v_piece.order_number, v_piece.customer_name, v_piece.environment_name
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'replacement_order_id', v_order_id,
    'replacement_code', v_code,
    'status', 'requested'
  );
END;
$$;


-- 7.3. RPC para Aprovar Reposição e Criar Peça Substituta
CREATE OR REPLACE FUNCTION public.approve_piece_replacement(p_order_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order record;
  v_original record;
  v_sub_piece_id uuid;
  v_sub_uid text;
  v_sub_code text;
  v_priority text := p_payload->>'priority';
  v_notes text := p_payload->>'notes';
BEGIN
  SELECT * INTO v_order FROM public.replacement_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Ordem de reposição não encontrada.';
  END IF;

  IF v_order.status NOT IN ('requested', 'under_review') THEN
    RAISE EXCEPTION 'Apenas ordens solicitadas ou em análise podem ser aprovadas. Status atual: %', v_order.status;
  END IF;

  SELECT * INTO v_original FROM public.production_pieces WHERE id = v_order.original_piece_id;
  IF v_original IS NULL THEN
    RAISE EXCEPTION 'Peça original não encontrada.';
  END IF;

  -- Gerar UID e Código para a peça substituta (preservando sufixo .REP)
  v_sub_uid  := v_original.piece_uid || '.REP' || lpad(floor(random() * 899 + 100)::text, 3, '0');
  v_sub_code := v_original.piece_code || '-REP';

  -- Criar a peça substituta copiando atributos da peça original
  INSERT INTO public.production_pieces (
    piece_uid, piece_code, traceability_code, piece_name,
    production_order_id, lot_id, lot_item_id, item_id,
    sequence_number, total_in_lot, is_active,
    material, thickness, color, width, length, grain_direction,
    edge_front, edge_back, edge_left, edge_right,
    requires_cut, requires_edge, requires_cnc, requires_joinery,
    requires_separation, requires_packaging,
    current_stage, status, is_rework, original_piece_id,
    is_replacement, production_status, route_template_id, route_steps, created_by
  ) VALUES (
    v_sub_uid, v_sub_code, v_sub_uid, v_original.piece_name,
    v_original.production_order_id, v_original.lot_id, v_original.lot_item_id, v_original.item_id,
    v_original.sequence_number, v_original.total_in_lot, true,
    v_original.material, v_original.thickness, v_original.color, v_original.width, v_original.length, v_original.grain_direction,
    v_original.edge_front, v_original.edge_back, v_original.edge_left, v_original.edge_right,
    v_original.requires_cut, v_original.requires_edge, v_original.requires_cnc, v_original.requires_joinery,
    v_original.requires_separation, v_original.requires_packaging,
    COALESCE(v_original.route_steps[1], 'corte'), 'replacement_approved', true, v_original.id,
    true, 'in_production', v_original.route_template_id, v_original.route_steps, v_user_id
  ) RETURNING id INTO v_sub_piece_id;

  -- Atualizar ordem de reposição para aprovada
  UPDATE public.replacement_orders
  SET status = 'approved',
      replacement_piece_id = v_sub_piece_id,
      approver_id = v_user_id,
      approved_at = now(),
      priority = COALESCE(v_priority, priority),
      notes = COALESCE(v_notes, notes),
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'status', 'approved',
    'replacement_piece_id', v_sub_piece_id,
    'replacement_uid', v_sub_uid
  );
END;
$$;


-- 7.4. RPC para Liberar / Iniciar Reposição
CREATE OR REPLACE FUNCTION public.release_piece_replacement(p_order_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
BEGIN
  SELECT * INTO v_order FROM public.replacement_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Ordem de reposição não encontrada.';
  END IF;

  UPDATE public.replacement_orders
  SET status = 'in_production',
      released_at = COALESCE(released_at, now()),
      updated_at = now()
  WHERE id = p_order_id;

  IF v_order.replacement_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = 'in_production', updated_at = now()
    WHERE id = v_order.replacement_piece_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'in_production');
END;
$$;


-- 7.5. RPC para Concluir Ordem de Reposição
CREATE OR REPLACE FUNCTION public.complete_piece_replacement(p_order_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
  v_user_id uuid := auth.uid();
BEGIN
  SELECT * INTO v_order FROM public.replacement_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Ordem de reposição não encontrada.';
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'already_completed', true);
  END IF;

  -- 1. Marcar a Ordem de Reposição como concluída
  UPDATE public.replacement_orders
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  WHERE id = p_order_id;

  -- 2. SOMENTE NESSE MOMENTO marcar a peça original como 'replaced'
  IF v_order.original_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = 'replaced',
        updated_at = now()
    WHERE id = v_order.original_piece_id;
  END IF;

  -- 3. Marcar a peça substituta como concluída se aplicável
  IF v_order.replacement_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces
    SET status = 'completed',
        updated_at = now()
    WHERE id = v_order.replacement_piece_id;
  END IF;

  -- 4. Se existir NC vinculada, fechar a NC
  UPDATE public.quality_nonconformities
  SET status = 'closed',
      closed_at = now(),
      closed_by = v_user_id
  WHERE related_replacement_id = p_order_id AND status != 'closed';

  RETURN jsonb_build_object('success', true, 'status', 'completed');
END;
$$;


-- 7.6. RPC para Cancelar Ordem de Reposição
CREATE OR REPLACE FUNCTION public.cancel_piece_replacement(p_order_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason text := p_payload->>'reason';
BEGIN
  UPDATE public.replacement_orders
  SET status = 'cancelled',
      cancelled_at = now(),
      notes = COALESCE(notes, '') || ' | Cancelado: ' || COALESCE(v_reason, 'Sem motivo informado'),
      updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('success', true, 'status', 'cancelled');
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. RPCs TRANSACIONAIS DE PARADAS NA COLETA (DOWNTIME)
-- ────────────────────────────────────────────────────────────────────────────

-- 8.1. Iniciar Parada na Coleta
CREATE OR REPLACE FUNCTION public.start_production_downtime(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason_id uuid;
  v_reason record;
  v_cell_id uuid;
  v_cell_name text := p_payload->>'cell_name';
  v_machine_id uuid;
  v_operator_id uuid;
  v_operator_name text := p_payload->>'operator_name';
  v_shift text := COALESCE(p_payload->>'shift', '1');
  v_notes text := p_payload->>'notes';
  v_client_event_id uuid;
  v_existing_id uuid;
  v_occurrence_id uuid;
BEGIN
  IF p_payload->>'downtime_reason_id' IS NOT NULL AND p_payload->>'downtime_reason_id' != '' THEN
    v_reason_id := (p_payload->>'downtime_reason_id')::uuid;
    SELECT * INTO v_reason FROM public.downtime_reason_catalog WHERE id = v_reason_id;
  END IF;

  IF p_payload->>'cell_id' IS NOT NULL AND p_payload->>'cell_id' != '' THEN
    v_cell_id := (p_payload->>'cell_id')::uuid;
  END IF;
  IF p_payload->>'machine_id' IS NOT NULL AND p_payload->>'machine_id' != '' THEN
    v_machine_id := (p_payload->>'machine_id')::uuid;
  END IF;
  IF p_payload->>'operator_id' IS NOT NULL AND p_payload->>'operator_id' != '' THEN
    v_operator_id := (p_payload->>'operator_id')::uuid;
  END IF;

  IF p_payload->>'client_event_id' IS NOT NULL AND p_payload->>'client_event_id' != '' THEN
    v_client_event_id := (p_payload->>'client_event_id')::uuid;
    SELECT id INTO v_existing_id FROM public.occurrences WHERE client_event_id = v_client_event_id;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'occurrence_id', v_existing_id);
    END IF;
  END IF;

  -- Checar sobreposição de paradas abertas
  IF v_machine_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.occurrences
    WHERE machine_id = v_machine_id AND status = 'open' AND occurrence_type = 'downtime';
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Já existe uma parada ativa para esta máquina (ID: %). Encerre a parada anterior primeiro.', v_existing_id;
    END IF;
  ELSIF v_cell_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.occurrences
    WHERE cell_id = v_cell_id AND status = 'open' AND occurrence_type = 'downtime';
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Já existe uma parada ativa nesta célula (ID: %). Encerre a parada anterior primeiro.', v_existing_id;
    END IF;
  END IF;

  INSERT INTO public.occurrences (
    date, shift, cell, reason, downtime, operator, notes,
    created_by, severity, status, occurrence_type,
    downtime_reason_id, downtime_reason_code, started_at,
    cell_id, machine_id, operator_id, source, client_event_id
  ) VALUES (
    CURRENT_DATE, v_shift, COALESCE(v_cell_name, 'Geral'),
    COALESCE(v_reason.name, p_payload->>'reason', 'Parada Operacional'),
    0, v_operator_name, v_notes, v_user_id,
    COALESCE(v_reason.default_severity, 'medium'), 'open', 'downtime',
    v_reason_id, v_reason.code, now(),
    v_cell_id, v_machine_id, v_operator_id, 'collection_app', v_client_event_id
  ) RETURNING id INTO v_occurrence_id;

  RETURN jsonb_build_object(
    'success', true,
    'occurrence_id', v_occurrence_id,
    'status', 'open',
    'started_at', now()
  );
END;
$$;


-- 8.2. Encerrar Parada Ativa
CREATE OR REPLACE FUNCTION public.finish_production_downtime(p_occurrence_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_occ record;
  v_ended_at timestamptz := COALESCE((p_payload->>'ended_at')::timestamptz, now());
  v_duration numeric;
  v_notes text := p_payload->>'notes';
BEGIN
  SELECT * INTO v_occ FROM public.occurrences WHERE id = p_occurrence_id;
  IF v_occ IS NULL THEN
    RAISE EXCEPTION 'Ocorrência de parada não encontrada.';
  END IF;

  IF v_occ.status = 'resolved' AND v_occ.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_finished', true, 'duration_minutes', v_occ.duration_minutes);
  END IF;

  -- Calcular duração em minutos no banco de dados
  v_duration := ROUND(EXTRACT(EPOCH FROM (v_ended_at - COALESCE(v_occ.started_at, v_occ.created_at))) / 60.0, 2);
  IF v_duration < 0 THEN
    v_duration := 0;
  END IF;

  UPDATE public.occurrences
  SET ended_at = v_ended_at,
      duration_minutes = v_duration,
      downtime = v_duration, -- Manter campo legado sincronizado
      status = 'resolved',
      notes = CASE WHEN v_notes IS NOT NULL THEN COALESCE(notes, '') || ' | Encerramento: ' || v_notes ELSE notes END,
      updated_at = now()
  WHERE id = p_occurrence_id;

  RETURN jsonb_build_object(
    'success', true,
    'occurrence_id', p_occurrence_id,
    'status', 'resolved',
    'duration_minutes', v_duration,
    'ended_at', v_ended_at
  );
END;
$$;


-- 8.3. Registrar Parada Passada
CREATE OR REPLACE FUNCTION public.register_production_downtime(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_started_at timestamptz := (p_payload->>'started_at')::timestamptz;
  v_ended_at timestamptz := (p_payload->>'ended_at')::timestamptz;
  v_duration numeric;
  v_reason_id uuid;
  v_reason record;
  v_client_event_id uuid;
  v_existing_id uuid;
  v_occurrence_id uuid;
BEGIN
  IF v_started_at IS NULL OR v_ended_at IS NULL THEN
    RAISE EXCEPTION 'Início e fim da parada são obrigatórios para lançamentos passados.';
  END IF;

  IF v_ended_at <= v_started_at THEN
    RAISE EXCEPTION 'O horário final da parada deve ser maior que o horário inicial.';
  END IF;

  v_duration := ROUND(EXTRACT(EPOCH FROM (v_ended_at - v_started_at)) / 60.0, 2);

  IF p_payload->>'downtime_reason_id' IS NOT NULL AND p_payload->>'downtime_reason_id' != '' THEN
    v_reason_id := (p_payload->>'downtime_reason_id')::uuid;
    SELECT * INTO v_reason FROM public.downtime_reason_catalog WHERE id = v_reason_id;
  END IF;

  IF p_payload->>'client_event_id' IS NOT NULL AND p_payload->>'client_event_id' != '' THEN
    v_client_event_id := (p_payload->>'client_event_id')::uuid;
    SELECT id INTO v_existing_id FROM public.occurrences WHERE client_event_id = v_client_event_id;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'occurrence_id', v_existing_id);
    END IF;
  END IF;

  INSERT INTO public.occurrences (
    date, shift, cell, reason, downtime, operator, notes,
    created_by, severity, status, occurrence_type,
    downtime_reason_id, downtime_reason_code, started_at, ended_at,
    duration_minutes, cell_id, machine_id, operator_id, source, client_event_id
  ) VALUES (
    v_started_at::date,
    COALESCE(p_payload->>'shift', '1'),
    COALESCE(p_payload->>'cell_name', 'Geral'),
    COALESCE(v_reason.name, p_payload->>'reason', 'Parada Registrada'),
    v_duration,
    p_payload->>'operator_name',
    p_payload->>'notes',
    v_user_id,
    COALESCE(v_reason.default_severity, 'medium'),
    'resolved',
    'downtime',
    v_reason_id,
    v_reason.code,
    v_started_at,
    v_ended_at,
    v_duration,
    (p_payload->>'cell_id')::uuid,
    (p_payload->>'machine_id')::uuid,
    (p_payload->>'operator_id')::uuid,
    'collection_app',
    v_client_event_id
  ) RETURNING id INTO v_occurrence_id;

  RETURN jsonb_build_object(
    'success', true,
    'occurrence_id', v_occurrence_id,
    'duration_minutes', v_duration
  );
END;
$$;


-- 8.4. Corrigir Parada (Supervisores / Gestores)
CREATE OR REPLACE FUNCTION public.correct_production_downtime(p_occurrence_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started_at timestamptz := (p_payload->>'started_at')::timestamptz;
  v_ended_at timestamptz := (p_payload->>'ended_at')::timestamptz;
  v_duration numeric;
BEGIN
  IF v_started_at IS NOT NULL AND v_ended_at IS NOT NULL THEN
    IF v_ended_at <= v_started_at THEN
      RAISE EXCEPTION 'Horário final deve ser maior que o horário inicial.';
    END IF;
    v_duration := ROUND(EXTRACT(EPOCH FROM (v_ended_at - v_started_at)) / 60.0, 2);
  ELSE
    v_duration := (p_payload->>'duration_minutes')::numeric;
  END IF;

  UPDATE public.occurrences
  SET started_at = COALESCE(v_started_at, started_at),
      ended_at = COALESCE(v_ended_at, ended_at),
      duration_minutes = COALESCE(v_duration, duration_minutes),
      downtime = COALESCE(v_duration, downtime),
      reason = COALESCE(p_payload->>'reason', reason),
      notes = COALESCE(p_payload->>'notes', notes),
      updated_at = now()
  WHERE id = p_occurrence_id;

  RETURN jsonb_build_object('success', true, 'occurrence_id', p_occurrence_id);
END;
$$;

-- Conceder permissão de EXECUTE aos perfis autenticados
GRANT EXECUTE ON FUNCTION public.register_quality_rejection(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_piece_replacement(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_piece_replacement(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_piece_replacement(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_piece_replacement(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_piece_replacement(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_production_downtime(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_production_downtime(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_production_downtime(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.correct_production_downtime(uuid, jsonb) TO authenticated;
