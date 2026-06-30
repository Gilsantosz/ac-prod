-- Migration: 023_realtime_machine_fast_collection.sql
-- Adiciona suporte a múltiplas máquinas concorrentes e contadores em tempo real de alta velocidade.

-- 1. Tabela de Máquinas / Postos de Trabalho
CREATE TABLE IF NOT EXISTS public.production_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cell_name text NOT NULL,
  station_name text,
  metric_unit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name, cell_name)
);

-- Ativar RLS
ALTER TABLE public.production_machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_machines_select ON public.production_machines;
CREATE POLICY production_machines_select ON public.production_machines
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS production_machines_write ON public.production_machines;
CREATE POLICY production_machines_write ON public.production_machines
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

DROP TRIGGER IF EXISTS trg_production_machines_updated_at ON public.production_machines;
CREATE TRIGGER trg_production_machines_updated_at
  BEFORE UPDATE ON public.production_machines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Colunas de máquina e performance nas tabelas existentes
ALTER TABLE public.production_collection_events
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS machine_name text,
  ADD COLUMN IF NOT EXISTS station_name text,
  ADD COLUMN IF NOT EXISTS enqueue_duration_ms numeric,
  ADD COLUMN IF NOT EXISTS sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_duration_ms numeric;

ALTER TABLE public.production_stage_readings
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS machine_name text,
  ADD COLUMN IF NOT EXISTS is_rework boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rework_of_reading_id uuid REFERENCES public.production_stage_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rework_reason text;

ALTER TABLE public.production_entries
  ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS machine_name text,
  ADD COLUMN IF NOT EXISTS is_rework boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rework_of_reading_id uuid REFERENCES public.production_stage_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rework_reason text;

ALTER TABLE public.production_lot_items
  ADD COLUMN IF NOT EXISTS rework_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_rejection_reading_id uuid REFERENCES public.production_stage_readings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_rejection_reason text;

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_collection_events_machine
  ON public.production_collection_events(machine_id);

CREATE INDEX IF NOT EXISTS idx_stage_readings_machine
  ON public.production_stage_readings(machine_id);

CREATE INDEX IF NOT EXISTS idx_entries_machine
  ON public.production_entries(machine_id);

CREATE INDEX IF NOT EXISTS idx_entries_rework
  ON public.production_entries(is_rework, created_at DESC)
  WHERE is_rework = true;

CREATE INDEX IF NOT EXISTS idx_stage_readings_lot_cell_machine
  ON public.production_stage_readings(lot_id, cell_name, machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stage_readings_rework
  ON public.production_stage_readings(is_rework, created_at DESC)
  WHERE is_rework = true;

CREATE INDEX IF NOT EXISTS idx_collection_events_lot_cell_machine
  ON public.production_collection_events(lot_id, cell_name, machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_lot_items_lot_status
  ON public.production_lot_items(lot_id, status);

-- 3. Restrição de peça única na mesma etapa (Evita aprovação concorrente em duplicidade)
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_readings_item_step_approved
  ON public.production_stage_readings(item_id, step_name)
  WHERE status = 'approved';

-- 4. Tabela de Contadores Rápidos em Tempo Real
CREATE TABLE IF NOT EXISTS public.production_realtime_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  lot_id uuid REFERENCES public.production_lots(id) ON DELETE CASCADE,
  lot_code text,
  load_number text,
  order_number text,
  customer_name text,
  environment_name text,
  cell_name text NOT NULL,
  machine_id uuid REFERENCES public.production_machines(id) ON DELETE SET NULL,
  machine_name text,
  metric_unit text,
  metric_unit_label text,
  planned_quantity numeric DEFAULT 0,
  approved_quantity numeric DEFAULT 0,
  rejected_quantity numeric DEFAULT 0,
  blocked_quantity numeric DEFAULT 0,
  pending_quantity numeric DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS uq_production_realtime_counters;
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_realtime_counters
  ON public.production_realtime_counters(
    date,
    (COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(load_number, '')),
    (COALESCE(order_number, '')),
    (COALESCE(environment_name, '')),
    cell_name,
    (COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- Ativar RLS para os contadores
ALTER TABLE public.production_realtime_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_realtime_counters_select ON public.production_realtime_counters;
CREATE POLICY production_realtime_counters_select ON public.production_realtime_counters
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS production_realtime_counters_all ON public.production_realtime_counters;
CREATE POLICY production_realtime_counters_all ON public.production_realtime_counters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Contador realtime derivado dos eventos operacionais.
-- Mantem o painel consistente para coleta em varias maquinas e para apontamento manual.
CREATE OR REPLACE FUNCTION public.adjust_production_realtime_counter(
  p_date date,
  p_lot_id uuid,
  p_lot_code text,
  p_load_number text,
  p_order_number text,
  p_customer_name text,
  p_environment_name text,
  p_cell_name text,
  p_machine_id uuid,
  p_machine_name text,
  p_metric_unit text,
  p_metric_unit_label text,
  p_planned_delta numeric DEFAULT 0,
  p_approved_delta numeric DEFAULT 0,
  p_rejected_delta numeric DEFAULT 0,
  p_blocked_delta numeric DEFAULT 0,
  p_pending_delta numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zero uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_cell text := NULLIF(TRIM(p_cell_name), '');
  v_unit text := COALESCE(NULLIF(p_metric_unit, ''), public.production_metric_unit_for_cell(p_cell_name, NULL, NULL), 'pieces');
  v_label text := COALESCE(NULLIF(p_metric_unit_label, ''), public.production_metric_unit_label(v_unit));
BEGIN
  IF p_date IS NULL OR v_cell IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(p_planned_delta, 0) = 0
     AND COALESCE(p_approved_delta, 0) = 0
     AND COALESCE(p_rejected_delta, 0) = 0
     AND COALESCE(p_blocked_delta, 0) = 0
     AND COALESCE(p_pending_delta, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.production_realtime_counters (
    date, lot_id, lot_code, load_number, order_number, customer_name, environment_name,
    cell_name, machine_id, machine_name, metric_unit, metric_unit_label,
    planned_quantity, approved_quantity, rejected_quantity, blocked_quantity, pending_quantity,
    updated_at
  ) VALUES (
    p_date, p_lot_id, p_lot_code, p_load_number, p_order_number, p_customer_name, p_environment_name,
    v_cell, p_machine_id, p_machine_name, v_unit, v_label,
    COALESCE(p_planned_delta, 0),
    COALESCE(p_approved_delta, 0),
    COALESCE(p_rejected_delta, 0),
    COALESCE(p_blocked_delta, 0),
    COALESCE(p_pending_delta, 0),
    now()
  )
  ON CONFLICT (
    date,
    (COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (COALESCE(load_number, '')),
    (COALESCE(order_number, '')),
    (COALESCE(environment_name, '')),
    cell_name,
    (COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  DO UPDATE SET
    lot_code = COALESCE(EXCLUDED.lot_code, public.production_realtime_counters.lot_code),
    customer_name = COALESCE(EXCLUDED.customer_name, public.production_realtime_counters.customer_name),
    machine_name = COALESCE(EXCLUDED.machine_name, public.production_realtime_counters.machine_name),
    metric_unit = COALESCE(EXCLUDED.metric_unit, public.production_realtime_counters.metric_unit),
    metric_unit_label = COALESCE(EXCLUDED.metric_unit_label, public.production_realtime_counters.metric_unit_label),
    planned_quantity = GREATEST(public.production_realtime_counters.planned_quantity + EXCLUDED.planned_quantity, 0),
    approved_quantity = GREATEST(public.production_realtime_counters.approved_quantity + EXCLUDED.approved_quantity, 0),
    rejected_quantity = GREATEST(public.production_realtime_counters.rejected_quantity + EXCLUDED.rejected_quantity, 0),
    blocked_quantity = GREATEST(public.production_realtime_counters.blocked_quantity + EXCLUDED.blocked_quantity, 0),
    pending_quantity = GREATEST(public.production_realtime_counters.pending_quantity + EXCLUDED.pending_quantity, 0),
    updated_at = now();

  DELETE FROM public.production_realtime_counters
  WHERE date = p_date
    AND COALESCE(lot_id, v_zero) = COALESCE(p_lot_id, v_zero)
    AND COALESCE(load_number, '') = COALESCE(p_load_number, '')
    AND COALESCE(order_number, '') = COALESCE(p_order_number, '')
    AND COALESCE(environment_name, '') = COALESCE(p_environment_name, '')
    AND cell_name = v_cell
    AND COALESCE(machine_id, v_zero) = COALESCE(p_machine_id, v_zero)
    AND COALESCE(planned_quantity, 0) <= 0
    AND COALESCE(approved_quantity, 0) <= 0
    AND COALESCE(rejected_quantity, 0) <= 0
    AND COALESCE(blocked_quantity, 0) <= 0
    AND COALESCE(pending_quantity, 0) <= 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_realtime_counter_from_production_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty numeric;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND COALESCE(OLD.approval_status, 'valid') = 'valid' THEN
    v_qty := COALESCE(NULLIF(OLD.realized_quantity, 0), OLD.produced, 0);
    PERFORM public.adjust_production_realtime_counter(
      OLD.date, OLD.lot_id, OLD.lot_code, OLD.load_number, OLD.order_number,
      COALESCE(OLD.customer_name, OLD.customer_legal_name), OLD.environment_name,
      OLD.cell, OLD.machine_id, OLD.machine_name, OLD.metric_unit, OLD.metric_unit_label,
      0, -v_qty, 0, 0, 0
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND COALESCE(NEW.approval_status, 'valid') = 'valid' THEN
    v_qty := COALESCE(NULLIF(NEW.realized_quantity, 0), NEW.produced, 0);
    PERFORM public.adjust_production_realtime_counter(
      NEW.date, NEW.lot_id, NEW.lot_code, NEW.load_number, NEW.order_number,
      COALESCE(NEW.customer_name, NEW.customer_legal_name), NEW.environment_name,
      NEW.cell, NEW.machine_id, NEW.machine_name, NEW.metric_unit, NEW.metric_unit_label,
      0, v_qty, 0, 0, 0
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_realtime_counter_from_stage_reading()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit text;
  v_label text;
  v_rejected numeric := 0;
  v_blocked numeric := 0;
  v_pending numeric := 0;
  v_qty numeric;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status <> 'approved' THEN
    v_qty := GREATEST(COALESCE(OLD.quantity, 1), 1);
    v_unit := public.production_metric_unit_for_cell(OLD.cell_name, OLD.step_name, OLD.operation_name);
    v_label := public.production_metric_unit_label(v_unit);
    v_rejected := CASE WHEN OLD.status = 'rejected' THEN -v_qty ELSE 0 END;
    v_blocked := CASE WHEN OLD.status IN ('blocked', 'duplicated') THEN -v_qty ELSE 0 END;
    v_pending := CASE WHEN OLD.status = 'pending_review' THEN -v_qty ELSE 0 END;

    PERFORM public.adjust_production_realtime_counter(
      OLD.date, OLD.lot_id, OLD.lot_code, OLD.load_number, OLD.order_number,
      OLD.customer_name, OLD.environment_name, OLD.cell_name, OLD.machine_id, OLD.machine_name,
      v_unit, v_label, 0, 0, v_rejected, v_blocked, v_pending
    );
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status <> 'approved' THEN
    v_qty := GREATEST(COALESCE(NEW.quantity, 1), 1);
    v_unit := public.production_metric_unit_for_cell(NEW.cell_name, NEW.step_name, NEW.operation_name);
    v_label := public.production_metric_unit_label(v_unit);
    v_rejected := CASE WHEN NEW.status = 'rejected' THEN v_qty ELSE 0 END;
    v_blocked := CASE WHEN NEW.status IN ('blocked', 'duplicated') THEN v_qty ELSE 0 END;
    v_pending := CASE WHEN NEW.status = 'pending_review' THEN v_qty ELSE 0 END;

    PERFORM public.adjust_production_realtime_counter(
      NEW.date, NEW.lot_id, NEW.lot_code, NEW.load_number, NEW.order_number,
      NEW.customer_name, NEW.environment_name, NEW.cell_name, NEW.machine_id, NEW.machine_name,
      v_unit, v_label, 0, 0, v_rejected, v_blocked, v_pending
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_realtime_counter_entries ON public.production_entries;
CREATE TRIGGER trg_sync_realtime_counter_entries
  AFTER INSERT OR UPDATE OR DELETE ON public.production_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_realtime_counter_from_production_entry();

DROP TRIGGER IF EXISTS trg_sync_realtime_counter_stage_readings ON public.production_stage_readings;
CREATE TRIGGER trg_sync_realtime_counter_stage_readings
  AFTER INSERT OR UPDATE OR DELETE ON public.production_stage_readings
  FOR EACH ROW EXECUTE FUNCTION public.sync_realtime_counter_from_stage_reading();

GRANT EXECUTE ON FUNCTION public.adjust_production_realtime_counter(
  date, uuid, text, text, text, text, text, text, uuid, text, text, text, numeric, numeric, numeric, numeric, numeric
) TO authenticated, anon;

-- Reconstroi o cache a partir das fontes reais. A tabela de contadores e derivada.
TRUNCATE TABLE public.production_realtime_counters;

DO $$
DECLARE
  r record;
  v_unit text;
  v_label text;
  v_qty numeric;
BEGIN
  FOR r IN
    SELECT * FROM public.production_entries
    WHERE COALESCE(approval_status, 'valid') = 'valid'
  LOOP
    v_qty := COALESCE(NULLIF(r.realized_quantity, 0), r.produced, 0);
    PERFORM public.adjust_production_realtime_counter(
      r.date, r.lot_id, r.lot_code, r.load_number, r.order_number,
      COALESCE(r.customer_name, r.customer_legal_name), r.environment_name,
      r.cell, r.machine_id, r.machine_name, r.metric_unit, r.metric_unit_label,
      0, v_qty, 0, 0, 0
    );
  END LOOP;

  FOR r IN
    SELECT * FROM public.production_stage_readings
    WHERE status <> 'approved'
  LOOP
    v_qty := GREATEST(COALESCE(r.quantity, 1), 1);
    v_unit := public.production_metric_unit_for_cell(r.cell_name, r.step_name, r.operation_name);
    v_label := public.production_metric_unit_label(v_unit);

    PERFORM public.adjust_production_realtime_counter(
      r.date, r.lot_id, r.lot_code, r.load_number, r.order_number,
      r.customer_name, r.environment_name, r.cell_name, r.machine_id, r.machine_name,
      v_unit, v_label, 0, 0,
      CASE WHEN r.status = 'rejected' THEN v_qty ELSE 0 END,
      CASE WHEN r.status IN ('blocked', 'duplicated') THEN v_qty ELSE 0 END,
      CASE WHEN r.status = 'pending_review' THEN v_qty ELSE 0 END
    );
  END LOOP;
END $$;

-- 5. Redesenho da Função process_production_reading com Lock de Concorrência Otimizado
CREATE OR REPLACE FUNCTION process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_event_id text := TRIM(p_payload->>'client_event_id');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), 'keyboard_barcode');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', '')), '');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', '')), '');
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_shift text := NULLIF(TRIM(COALESCE(p_payload->>'shift', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour', ''), to_char(now(), 'HH24:MI'));
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_created_at_client timestamptz := COALESCE(NULLIF(p_payload->>'createdAtClient', '')::timestamptz, now());

  -- Máquina
  v_machine_id uuid := NULLIF(p_payload->>'machineId', '')::uuid;
  v_machine_name text := NULLIF(TRIM(p_payload->>'machineName'), '');
  v_enqueue_duration_ms numeric := (p_payload->>'enqueue_duration_ms')::numeric;
  v_sync_started_at timestamptz := now();

  v_operator_id uuid;
  v_registration text;
  v_operator_row public.operators%ROWTYPE;

  v_event public.production_collection_events%ROWTYPE;
  v_tag public.production_tags%ROWTYPE;
  v_item public.production_lot_items%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_route public.production_routes%ROWTYPE;
  v_next public.production_routes%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_recent integer := 0;
  v_total integer := 0;
  v_completed integer := 0;
  v_result jsonb;
  v_is_rework boolean := false;
  v_rework_of_reading_id uuid;
  v_rework_reason text;
  
  -- Para atualização do contador incremental
  v_machine_row public.production_machines%ROWTYPE;
BEGIN
  -- 1. Validar autenticação
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','operator') THEN
    RETURN jsonb_build_object('success', false, 'status', 'forbidden', 'message', 'Usuário sem permissão para coleta produtiva.');
  END IF;

  IF v_client_event_id IS NULL OR v_client_event_id = '' THEN
    v_client_event_id := gen_random_uuid()::text;
  END IF;

  -- 2. Resolver operador
  IF p_payload->>'operatorId' IS NOT NULL AND p_payload->>'operatorId' <> '' THEN
    SELECT * INTO v_operator_row FROM public.operators WHERE id = (p_payload->>'operatorId')::uuid;
  ELSE
    SELECT * INTO v_operator_row FROM public.operators WHERE LOWER(name) = LOWER(v_operator) LIMIT 1;
  END IF;

  IF v_operator_row.id IS NOT NULL THEN
    v_operator_id := v_operator_row.id;
    v_operator := v_operator_row.name;
    v_registration := v_operator_row.registration;
    v_shift := COALESCE(v_shift, v_operator_row.shift);
  END IF;

  -- Resolver máquina se ID fornecido
  IF v_machine_id IS NOT NULL THEN
    SELECT * INTO v_machine_row FROM public.production_machines WHERE id = v_machine_id;
    IF FOUND THEN
      v_machine_name := v_machine_row.name;
    END IF;
  ELSIF v_machine_name IS NOT NULL AND v_cell IS NOT NULL THEN
    SELECT * INTO v_machine_row FROM public.production_machines WHERE name = v_machine_name AND cell_name = v_cell LIMIT 1;
    IF FOUND THEN
      v_machine_id := v_machine_row.id;
    END IF;
  END IF;

  -- 3. Verificar se o evento já existe (idempotência)
  SELECT * INTO v_event FROM public.production_collection_events WHERE client_event_id = v_client_event_id;
  IF FOUND THEN
    IF v_event.status = 'synced' THEN
      SELECT * INTO v_reading FROM public.production_stage_readings WHERE id = v_event.reading_id;
      SELECT * INTO v_item FROM public.production_lot_items WHERE id = v_reading.item_id;
      SELECT * INTO v_lot FROM public.production_lots WHERE id = v_reading.lot_id;
      SELECT * INTO v_route FROM public.production_routes WHERE lot_id = v_reading.lot_id AND step_name = v_reading.step_name LIMIT 1;
      SELECT * INTO v_next FROM public.production_routes WHERE lot_id = v_reading.lot_id AND required = true AND step_order > v_route.step_order ORDER BY step_order LIMIT 1;

      RETURN jsonb_build_object(
        'success', true,
        'status', 'approved',
        'message', 'Leitura aprovada (recuperada da fila).',
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_item),
        'route', to_jsonb(v_route),
        'reading', to_jsonb(v_reading),
        'nextStep', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END,
        'contextSummary', get_collection_context_summary(v_lot.id, null)
      );
    ELSIF v_event.status = 'error' THEN
      RETURN jsonb_build_object('success', false, 'status', 'error', 'message', v_event.error_message);
    ELSIF v_event.status = 'ignored' THEN
      RETURN jsonb_build_object('success', false, 'status', v_event.result_status, 'message', 'Leitura ignorada.');
    END IF;
  END IF;

  -- Registrar evento inicial como 'processing'
  INSERT INTO public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type,
    operator_id, operator_name, registration, cell_name, shift, date, hour,
    status, created_at_client, payload,
    machine_id, machine_name, station_name, enqueue_duration_ms, sync_started_at
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_operator_id, v_operator, v_registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload,
    v_machine_id, v_machine_name, v_station, v_enqueue_duration_ms, v_sync_started_at
  ) RETURNING * INTO v_event;

  -- 4. Validar tag vazia
  IF v_tag_value = '' THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'invalid', error_message = 'Identificação produtiva vazia.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'Informe uma identificação produtiva válida.');
  END IF;

  -- 5. Localizar tag
  SELECT * INTO v_tag FROM public.production_tags
  WHERE tag_value = v_tag_value AND active = true
  LIMIT 1;

  -- 6. Localizar item de lote correspondente com LOCK OTIMIZADO
  IF FOUND AND v_tag.item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.production_lot_items WHERE id = v_tag.item_id FOR UPDATE;
  ELSE
    SELECT * INTO v_item FROM public.production_lot_items
    WHERE UPPER(item_code) = v_tag_value
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    SELECT pli.* INTO v_item
    FROM public.production_lot_items pli
    JOIN public.production_lots pl ON pl.id = pli.lot_id
    WHERE UPPER(pl.lot_code) = v_tag_value
      AND pli.status NOT IN ('completed','cancelled')
    ORDER BY pli.created_at ASC LIMIT 1 FOR UPDATE OF pli;
  END IF;

  IF v_item.id IS NULL THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'not_found', error_message = 'Tag, peça ou lote não localizado.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Tag, peça ou lote não localizado.');
  END IF;

  -- Preencher detalhes do item e do lote no evento do ledger
  UPDATE public.production_collection_events SET
    lot_id = v_item.lot_id,
    lot_code = v_item.lot_code,
    load_number = v_item.load_number,
    order_number = v_item.order_number,
    customer_name = v_item.customer_name,
    environment_name = v_item.environment_name,
    piece_code = v_item.item_code
  WHERE id = v_event.id;

  -- Se a tag não foi criada no banco, criar agora
  IF v_tag.id IS NULL THEN
    INSERT INTO public.production_tags (lot_id, item_id, tag_value, tag_type, tag_format, barcode_value)
    VALUES (v_item.lot_id, v_item.id, v_tag_value,
      CASE
        WHEN p_payload->>'detectedTagType' IN ('qrcode','datamatrix','rfid_epc','rfid_tid','manual') THEN p_payload->>'detectedTagType'
        ELSE 'barcode'
      END,
      CASE
        WHEN p_payload->>'detectedTagFormat' IN ('code128','code39','ean13','qrcode','datamatrix','epc96','custom') THEN p_payload->>'detectedTagFormat'
        ELSE 'custom'
      END,
      v_tag_value)
    ON CONFLICT (tag_value) DO UPDATE SET active = true
    RETURNING * INTO v_tag;
  END IF;

  -- Seleciona lote SEM LOCK FOR UPDATE global
  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_item.lot_id;

  -- 7. Validar status da peça
  IF v_item.status IN ('rejected','blocked','scrap','cancelled') THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'blocked', error_message = 'Peça bloqueada ou reprovada.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'blocked', 'message', 'Peça bloqueada ou reprovada. Libere a ocorrência antes de avançar.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  IF v_item.status = 'completed' THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'completed', error_message = 'Peça já concluída.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'completed', 'message', 'Esta peça já concluiu toda a rota produtiva.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  v_is_rework := v_item.status = 'rework';
  IF v_is_rework THEN
    v_rework_of_reading_id := v_item.last_rejection_reading_id;
    v_rework_reason := v_item.last_rejection_reason;
  END IF;

  -- 8. Resolver rota do lote considerando se a peça requer a etapa
  SELECT * INTO v_route FROM public.production_routes
  WHERE lot_id = v_item.lot_id
    AND required = true
    AND (step_name = v_item.current_step OR v_item.current_step IS NULL)
    AND piece_requires_step(v_item.source_lot_item_id, step_name) = true
  ORDER BY step_order LIMIT 1;

  IF v_route.id IS NULL THEN
    SELECT * INTO v_route FROM public.production_routes
    WHERE lot_id = v_item.lot_id
      AND required = true
      AND piece_requires_step(v_item.source_lot_item_id, step_name) = true
    ORDER BY step_order LIMIT 1;
  END IF;

  IF v_route.id IS NULL THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'route_missing', error_message = 'Rota do lote não configurada.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'route_missing', 'message', 'O lote não possui rota produtiva configurada.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  -- 9. Validar se a etapa é a correta
  IF v_step_input IS NOT NULL AND LOWER(v_step_input) <> LOWER(v_route.step_name) THEN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code,
      machine_id, machine_name
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,
      v_station,v_step_input,v_cell,v_operator,auth.uid(),v_shift,v_date,v_hour,'blocked','wrong_step',v_quantity,
      'Etapa esperada: ' || v_route.step_name, v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_step_input, v_item.item_code,
      v_machine_id, v_machine_name
    ) RETURNING * INTO v_reading;

    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'wrong_step', reading_id = v_reading.id, processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object('success', false, 'status', 'wrong_step', 'message', 'Etapa incorreta. Etapa esperada: ' || v_route.step_name, 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  -- 10. Validar se a célula é a correta
  IF v_route.cell_name IS NOT NULL AND v_cell IS NOT NULL AND LOWER(v_route.cell_name) <> LOWER(v_cell) THEN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code,
      machine_id, machine_name
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,
      v_station,v_route.step_name,v_cell,v_operator,auth.uid(),v_shift,v_date,v_hour,'blocked','wrong_step',v_quantity,
      'Célula esperada: ' || v_route.cell_name, v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_route.step_name, v_item.item_code,
      v_machine_id, v_machine_name
    ) RETURNING * INTO v_reading;

    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'wrong_cell', reading_id = v_reading.id, processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object('success', false, 'status', 'wrong_cell', 'message', 'Célula incorreta. Célula esperada: ' || v_route.cell_name, 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  -- 11. Janela anti-repetição de 3 segundos
  SELECT COUNT(*) INTO v_recent FROM public.production_stage_readings
  WHERE tag_id = v_tag.id AND created_at >= now() - interval '3 seconds';
  
  IF v_recent > 0 THEN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code,
      machine_id, machine_name
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,v_station,v_route.step_name,v_cell,
      v_operator,auth.uid(),v_shift,v_date,v_hour,'duplicated','duplicated_scan',v_quantity,
      'Janela anti-repetição de 3 segundos', v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_route.step_name, v_item.item_code,
      v_machine_id, v_machine_name
    ) RETURNING * INTO v_reading;

    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'duplicated', reading_id = v_reading.id, processed_at = now()
    WHERE id = v_event.id;

    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Leitura repetida bloqueada.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  -- 12. Inserir leitura aprovada com tratamento de concorrência por unique key
  BEGIN
    INSERT INTO public.production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,reader_id,reader_name,station_id,station_name,
      step_name,cell_name,operator,user_id,shift,date,hour,status,event_type,quantity,notes,
      rssi,antenna_port,read_count,first_seen_at,last_seen_at,client_event_id,
      lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code,
      machine_id, machine_name, is_rework, rework_of_reading_id, rework_reason
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,NULLIF(p_payload->>'readerId','')::uuid,
      p_payload->>'readerName',p_payload->>'stationId',v_station,v_route.step_name,COALESCE(v_cell,v_route.cell_name),
      v_operator,auth.uid(),v_shift,v_date,v_hour,'approved',
      CASE WHEN v_reader_type = 'manual' THEN 'manual_adjustment' WHEN v_reader_type LIKE 'rfid_%' AND v_quantity > 1 THEN 'rfid_bulk_read' ELSE 'approved_scan' END,
      v_quantity,p_payload->>'notes',NULLIF(p_payload->>'rssi','')::numeric,NULLIF(p_payload->>'antennaPort','')::integer,
      COALESCE(NULLIF(p_payload->>'readCount','')::integer,1),NULLIF(p_payload->>'firstSeenAt','')::timestamptz,NULLIF(p_payload->>'lastSeenAt','')::timestamptz,
      v_client_event_id,
      v_item.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_route.step_name, v_item.item_code,
      v_machine_id, v_machine_name, v_is_rework, v_rework_of_reading_id, v_rework_reason
    ) RETURNING * INTO v_reading;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.production_collection_events
    SET status = 'ignored', result_status = 'duplicated', error_message = 'Esta peça já foi aprovada nesta etapa por outra máquina ou operador.', processed_at = now()
    WHERE id = v_event.id;
    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Esta peça já foi aprovada nesta etapa por outra máquina ou operador.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route));
  END;

  -- 13. Encontrar próxima etapa necessária da peça
  SELECT * INTO v_next FROM public.production_routes
  WHERE lot_id = v_item.lot_id 
    AND required = true 
    AND step_order > v_route.step_order
    AND piece_requires_step(v_item.source_lot_item_id, step_name) = true
  ORDER BY step_order LIMIT 1;

  -- 14. Atualizar item
  UPDATE public.production_lot_items
  SET current_step = v_next.step_name,
      current_cell = v_next.cell_name,
      status = CASE WHEN v_next.id IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  -- 15. Atualizar progresso do lote
  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total, v_completed
  FROM public.production_lot_items WHERE lot_id = v_lot.id;

  UPDATE public.production_lots
  SET progress_percent = CASE WHEN v_total > 0 THEN ROUND((v_completed::numeric / v_total::numeric) * 100, 2) ELSE 0 END,
      planned_quantity = CASE WHEN COALESCE(planned_quantity,0) = 0 THEN v_total ELSE planned_quantity END,
      current_status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'completed' ELSE 'in_progress' END,
      status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'shipped' ELSE 'in_progress' END,
      actual_end = CASE WHEN v_total > 0 AND v_completed = v_total THEN now() ELSE actual_end END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  -- 16. Inserir baixa produtiva na tabela production_entries
  INSERT INTO public.production_entries (
    date,shift,cell,hour,produced,target,scrap,downtime,operator,notes,created_by,client_event_id,
    operator_id, order_id, production_order_id, lot_id, lot_code, load_number, order_number,
    customer_name, customer_legal_name, environment_name, operation_name, machine_id, machine_name,
    is_rework, rework_of_reading_id, rework_reason
  ) VALUES (
    v_date,COALESCE(v_shift,'Não informado'),COALESCE(v_cell,v_route.cell_name,'Não informada'),v_hour,v_quantity,0,0,0,
    v_operator,CASE WHEN v_is_rework THEN 'Retrabalho aprovado - tag ' || v_tag_value ELSE 'Coleta produtiva - tag ' || v_tag_value END,auth.uid(),v_client_event_id,
    v_operator_id, COALESCE(v_lot.production_order_id, v_lot.order_id), COALESCE(v_lot.production_order_id, v_lot.order_id), v_lot.id, v_lot.lot_code, v_item.load_number, v_item.order_number,
    v_item.customer_name, v_item.customer_name, v_item.environment_name, v_route.step_name, v_machine_id, v_machine_name,
    v_is_rework, v_rework_of_reading_id, v_rework_reason
  ) RETURNING id INTO v_entry_id;

  UPDATE public.production_stage_readings
  SET production_entry_id = v_entry_id
  WHERE id = v_reading.id
  RETURNING * INTO v_reading;

  -- 17. Contador realtime atualizado por trigger em production_entries/production_stage_readings.

  -- 18. Registrar log de auditoria
  INSERT INTO public.traceability_logs (user_id,action,entity,entity_id,details)
  VALUES (auth.uid(),'approved_scan','production_lot_item',v_item.id,jsonb_build_object('tag',v_tag_value,'step',v_route.step_name,'cell',COALESCE(v_cell,v_route.cell_name),'reading_id',v_reading.id));

  -- 19. Sincronizar o evento no ledger
  UPDATE public.production_collection_events
  SET status = 'synced',
      result_status = 'approved',
      reading_id = v_reading.id,
      production_entry_id = v_entry_id,
      processed_at = now(),
      sync_finished_at = now(),
      sync_duration_ms = EXTRACT(EPOCH FROM (now() - v_sync_started_at)) * 1000
  WHERE id = v_event.id;

  -- 20. Montar resposta
  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'message', CASE WHEN v_is_rework THEN 'Retrabalho aprovado. Baixa produtiva registrada.' ELSE 'Leitura aprovada. Baixa produtiva registrada.' END,
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_item),
    'route', to_jsonb(v_route),
    'reading', to_jsonb(v_reading),
    'nextStep', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END,
    'contextSummary', get_collection_context_summary(v_lot.id, null)
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  -- Sincronizar erro no ledger
  IF v_event.id IS NOT NULL THEN
    UPDATE public.production_collection_events
    SET status = 'error',
        error_message = SQLERRM,
        processed_at = now(),
        sync_finished_at = now(),
        sync_duration_ms = EXTRACT(EPOCH FROM (now() - v_sync_started_at)) * 1000
    WHERE id = v_event.id;
  END IF;
  RETURN jsonb_build_object('success', false, 'status', 'error', 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION register_traceability_rejection(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.production_lot_items%ROWTYPE;
  v_tag public.production_tags%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_occurrence public.occurrences%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_prior_reading public.production_stage_readings%ROWTYPE;
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity','')::integer, 1), 1);
  v_date date := COALESCE(NULLIF(p_payload->>'date','')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour',''), to_char(now(), 'HH24:MI'));
  v_shift text := COALESCE(NULLIF(p_payload->>'shift',''), 'Não informado');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_operator_id uuid := NULLIF(p_payload->>'operatorId', '')::uuid;
  v_step text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', '')), '');
  v_reason text := COALESCE(NULLIF(p_payload->>'reason',''), 'Reprovação registrada na coleta produtiva');
  v_defect_type text := NULLIF(p_payload->>'defectType', '');
  v_notes text := NULLIF(p_payload->>'notes', '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'tagValue', p_payload->>'rawValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), 'manual');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', '')), '');
  v_machine_id uuid := NULLIF(p_payload->>'machineId', '')::uuid;
  v_machine_name text := NULLIF(TRIM(p_payload->>'machineName'), '');
  v_release_for_rework boolean := COALESCE(NULLIF(p_payload->>'releaseForRework','')::boolean, true);
  v_message text;
BEGIN
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','operator') THEN
    RETURN jsonb_build_object('success', false, 'status', 'forbidden', 'message', 'Usuário sem permissão para reprovar peças.');
  END IF;

  SELECT * INTO v_item
  FROM public.production_lot_items
  WHERE id = NULLIF(p_payload->>'itemId','')::uuid
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Peça não localizada para reprovar.');
  END IF;

  SELECT * INTO v_lot
  FROM public.production_lots
  WHERE id = COALESCE(NULLIF(p_payload->>'lotId','')::uuid, v_item.lot_id)
  FOR UPDATE;

  IF v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Lote não localizado para reprovar.');
  END IF;

  IF NULLIF(p_payload->>'tagId','') IS NOT NULL THEN
    SELECT * INTO v_tag FROM public.production_tags WHERE id = NULLIF(p_payload->>'tagId','')::uuid;
  END IF;

  IF v_tag.id IS NULL AND v_tag_value <> '' THEN
    SELECT * INTO v_tag FROM public.production_tags WHERE tag_value = v_tag_value AND active = true LIMIT 1;
  END IF;

  v_tag_value := COALESCE(NULLIF(v_tag.tag_value, ''), NULLIF(v_tag_value, ''), v_item.item_code);
  v_cell := COALESCE(v_cell, v_item.current_cell, 'Não informada');
  v_step := COALESCE(v_step, v_item.current_step);

  SELECT * INTO v_prior_reading
  FROM public.production_stage_readings
  WHERE item_id = v_item.id
    AND step_name IS NOT DISTINCT FROM v_step
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  INSERT INTO public.occurrences (
    date, shift, cell, reason, downtime, operator, notes, created_by,
    lot_id, lot_item_id, production_order_id, stage_reading_id, tag_value, lot_code,
    severity, status, load_number, order_number, customer_name, environment_name,
    piece_code, operation_name
  ) VALUES (
    v_date, v_shift, v_cell, v_reason, 0, v_operator,
    concat_ws(' | ', v_defect_type, v_notes, 'Tag: ' || v_tag_value, CASE WHEN v_release_for_rework THEN 'Liberada para retrabalho' ELSE 'Bloqueada' END),
    auth.uid(), v_lot.id, v_item.source_lot_item_id,
    COALESCE(v_lot.production_order_id, v_lot.order_id),
    NULL, v_tag_value, v_lot.lot_code, 'high', 'open',
    v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name,
    v_item.item_code, v_step
  ) RETURNING * INTO v_occurrence;

  INSERT INTO public.production_stage_readings (
    lot_id, item_id, tag_id, tag_value, reader_type, station_name, step_name, cell_name,
    operator, user_id, shift, date, hour, status, event_type, quantity, occurrence_id, notes,
    lot_code, load_number, order_number, customer_name, environment_name, operation_name, piece_code,
    production_order_id, machine_id, machine_name, rework_reason
  ) VALUES (
    v_lot.id, v_item.id, v_tag.id, v_tag_value, v_reader_type, v_station, v_step, v_cell,
    v_operator, auth.uid(), v_shift, v_date, v_hour, 'rejected', 'rejected_scan', v_quantity, v_occurrence.id,
    concat_ws(' | ', v_defect_type, v_notes),
    v_lot.lot_code, v_item.load_number, v_item.order_number, v_item.customer_name, v_item.environment_name, v_step, v_item.item_code,
    COALESCE(v_lot.production_order_id, v_lot.order_id), v_machine_id, v_machine_name, v_reason
  ) RETURNING * INTO v_reading;

  UPDATE public.occurrences
  SET stage_reading_id = v_reading.id,
      updated_at = now()
  WHERE id = v_occurrence.id
  RETURNING * INTO v_occurrence;

  IF v_release_for_rework AND v_prior_reading.id IS NOT NULL THEN
    UPDATE public.production_stage_readings
    SET status = 'pending_review',
        notes = concat_ws(E'\n', NULLIF(notes, ''), 'Estornada por reprovação para retrabalho: ' || v_reason),
        rework_reason = v_reason
    WHERE id = v_prior_reading.id;

    UPDATE public.production_entries
    SET approval_status = 'reversed',
        correction_reason = concat_ws(' | ', 'Estorno automático por retrabalho', v_reason),
        corrected_by = COALESCE(v_operator, auth.uid()::text),
        corrected_at = now(),
        updated_at = now()
    WHERE (v_prior_reading.production_entry_id IS NOT NULL AND id = v_prior_reading.production_entry_id)
       OR (
         v_prior_reading.production_entry_id IS NULL
         AND v_prior_reading.client_event_id IS NOT NULL
         AND client_event_id = v_prior_reading.client_event_id
       );
  END IF;

  IF v_release_for_rework THEN
    UPDATE public.production_lot_items
    SET status = 'rework',
        current_step = COALESCE(v_step, current_step),
        current_cell = COALESCE(v_cell, current_cell),
        rework_count = COALESCE(rework_count, 0) + v_quantity,
        last_rejection_reading_id = v_reading.id,
        last_rejection_reason = v_reason,
        updated_at = now()
    WHERE id = v_item.id
    RETURNING * INTO v_item;

    UPDATE public.production_lots
    SET scrap_count = COALESCE(scrap_count, 0) + v_quantity,
        rework_count = COALESCE(rework_count, 0) + v_quantity,
        rejected_quantity = COALESCE(rejected_quantity, 0) + v_quantity,
        current_status = CASE WHEN current_status IN ('completed','shipped') THEN current_status ELSE 'in_progress' END,
        status = CASE WHEN status = 'shipped' THEN status ELSE 'in_progress' END,
        updated_at = now()
    WHERE id = v_lot.id
    RETURNING * INTO v_lot;

    v_message := 'Peça reprovada, liberada para retrabalho e pronta para recoleta.';
  ELSE
    UPDATE public.production_lot_items
    SET status = 'blocked',
        last_rejection_reading_id = v_reading.id,
        last_rejection_reason = v_reason,
        updated_at = now()
    WHERE id = v_item.id
    RETURNING * INTO v_item;

    UPDATE public.production_lots
    SET scrap_count = COALESCE(scrap_count, 0) + v_quantity,
        rejected_quantity = COALESCE(rejected_quantity, 0) + v_quantity,
        current_status = 'blocked',
        updated_at = now()
    WHERE id = v_lot.id
    RETURNING * INTO v_lot;

    v_message := 'Peça reprovada, bloqueada e ocorrência vinculada.';
  END IF;

  INSERT INTO public.production_entries (
    date, shift, cell, hour, produced, target, scrap, downtime, operator, notes, created_by,
    operator_id, order_id, production_order_id, lot_id, lot_code, load_number, order_number,
    customer_name, customer_legal_name, environment_name, operation_name, machine_id, machine_name,
    rework_reason
  ) VALUES (
    v_date, v_shift, v_cell, v_hour, 0, 0, v_quantity, 0, v_operator,
    CASE WHEN v_release_for_rework THEN 'Reprovação liberada para retrabalho - tag ' || v_tag_value ELSE 'Reprovação vinculada a tag ' || v_tag_value END,
    auth.uid(), v_operator_id, COALESCE(v_lot.production_order_id, v_lot.order_id), COALESCE(v_lot.production_order_id, v_lot.order_id),
    v_lot.id, v_lot.lot_code, v_item.load_number, v_item.order_number,
    v_item.customer_name, v_item.customer_name, v_item.environment_name, v_step, v_machine_id, v_machine_name,
    CASE WHEN v_release_for_rework THEN v_reason ELSE NULL END
  );

  INSERT INTO public.traceability_logs (user_id, action, entity, entity_id, details)
  VALUES (
    auth.uid(), 'rejected_scan', 'production_lot_item', v_item.id,
    jsonb_build_object(
      'reading_id', v_reading.id,
      'occurrence_id', v_occurrence.id,
      'reason', v_reason,
      'release_for_rework', v_release_for_rework,
      'previous_approved_reading_id', CASE WHEN v_prior_reading.id IS NULL THEN NULL ELSE v_prior_reading.id END
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN v_release_for_rework THEN 'rework' ELSE 'rejected' END,
    'message', v_message,
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_item),
    'reading', to_jsonb(v_reading),
    'occurrence', to_jsonb(v_occurrence)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_production_reading(jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION register_traceability_rejection(jsonb) TO authenticated, anon;

-- 6. Adiciona tabelas à publicação de realtime
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'production_entries',
    'daily_goals',
    'production_daily_goals',
    'occurrences',
    'cells',
    'production_machines',
    'production_realtime_counters',
    'production_collection_events',
    'production_stage_readings',
    'production_orders',
    'production_lots',
    'production_lot_items',
    'production_routes',
    'production_tags',
    'lot_step_events',
    'packages',
    'shipments',
    'operators',
    'profiles',
    'automation_rules',
    'alert_logs'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_table THEN NULL;
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;
