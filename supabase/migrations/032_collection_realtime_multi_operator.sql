-- ============================================================
-- AC.Prod MES — Coleta multioperador, histórico permanente
-- e consistência transacional de KPIs
-- Migration 032 — aditiva; não remove histórico existente
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Harmoniza estados já usados pelo módulo PCP e mantém o lote de importação
-- como agrupador comum mesmo quando o arquivo contém vários pedidos/clientes.
ALTER TABLE public.production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;
ALTER TABLE public.production_orders ADD CONSTRAINT production_orders_status_check CHECK (status IN (
  'planned','imported','released','in_production','blocked','partially_completed',
  'completed','closed','shipped','cancelled'
)) NOT VALID;

ALTER TABLE public.production_lots
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pcp_import_batch_id uuid REFERENCES public.promob_import_batches(id) ON DELETE SET NULL;
ALTER TABLE public.production_pieces
  ADD COLUMN IF NOT EXISTS pcp_import_batch_id uuid REFERENCES public.promob_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_joinery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_joinery_reason text;
ALTER TABLE public.production_entries
  ADD COLUMN IF NOT EXISTS pcp_import_batch_id uuid REFERENCES public.promob_import_batches(id) ON DELETE SET NULL;

ALTER TABLE public.promob_import_batches
  ADD COLUMN IF NOT EXISTS general_lot_code text,
  ADD COLUMN IF NOT EXISTS completed_parts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_parts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_operations bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_operations bigint NOT NULL DEFAULT 0;
ALTER TABLE public.promob_import_batches
  ADD COLUMN IF NOT EXISTS client_lots_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customers_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_promob_import_batches_general_lot
  ON public.promob_import_batches(lower(general_lot_code));
CREATE INDEX IF NOT EXISTS idx_production_pieces_manual_joinery_pending
  ON public.production_pieces(pcp_import_batch_id, lot_id)
  WHERE manual_joinery = true;

-- Reinstala as duas pontes legadas usadas pela coleta. Isso também corrige
-- bases já migradas até a 031, pois alterações em migrations antigas não são
-- reaplicadas pelo Supabase.
CREATE OR REPLACE FUNCTION public.resolve_piece_by_identifier(p_identifier text)
RETURNS public.production_pieces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
  v_piece public.production_pieces;
  v_count integer;
BEGIN
  v_normalized := TRIM(p_identifier);

  IF v_normalized IS NULL OR v_normalized = '' THEN
    RAISE EXCEPTION 'Identificador vazio' USING ERRCODE = 'P0001';
  END IF;

  WITH matches AS (
    SELECT id FROM public.production_pieces
    WHERE piece_uid = v_normalized OR traceability_code = v_normalized
       OR upper(piece_uid) = upper(v_normalized)
       OR upper(traceability_code) = upper(v_normalized)
    UNION
    SELECT piece_id FROM public.production_tags
    WHERE (tag_value = v_normalized OR upper(tag_value) = upper(v_normalized))
      AND active = true
      AND piece_id IS NOT NULL
  )
  SELECT count(*), (SELECT id FROM matches ORDER BY id LIMIT 1)
  INTO v_count, v_piece.id
  FROM matches;

  IF v_count = 0 THEN
    SELECT count(*) INTO v_count
    FROM public.production_tags
    WHERE (tag_value = v_normalized OR upper(tag_value) = upper(v_normalized))
      AND active = false;

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Identificador % inativo no sistema', p_identifier USING ERRCODE = 'P0003';
    END IF;
    RAISE EXCEPTION 'Peça não localizada para o identificador %', p_identifier USING ERRCODE = 'P0002';
  ELSIF v_count > 1 THEN
    RAISE EXCEPTION 'Identificador % ambíguo (múltiplas peças encontradas)', p_identifier USING ERRCODE = 'P0004';
  END IF;

  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece.id;
  RETURN v_piece;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_production_lot_item_to_piece()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lot_item public.lot_items%ROWTYPE;
  v_piece_id uuid;
  v_uid text;
  v_tcode text;
  v_order_id uuid;
BEGIN
  SELECT production_order_id INTO v_order_id
  FROM public.production_lots
  WHERE id = NEW.lot_id;

  IF NEW.source_lot_item_id IS NOT NULL THEN
    SELECT * INTO v_lot_item
    FROM public.lot_items
    WHERE id = NEW.source_lot_item_id;
  END IF;

  v_uid := 'PC-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substring(encode(gen_random_bytes(4), 'hex') FROM 1 FOR 6));
  v_tcode := COALESCE(NEW.item_code, replace(v_uid, 'PC-', ''));

  SELECT id INTO v_piece_id
  FROM public.production_pieces
  WHERE legacy_production_lot_item_id = NEW.id
  ORDER BY created_at, id
  LIMIT 1;

  IF v_piece_id IS NULL THEN
    INSERT INTO public.production_pieces (
      piece_uid, traceability_code, production_order_id, lot_id,
      module_name, environment, piece_name, description, material, color,
      thickness, width, height, length, edge_front, edge_back, edge_left,
      edge_right, requires_cut, requires_edge, requires_cnc, requires_joinery,
      requires_separation, requires_packaging, current_stage, status,
      source_origin, legacy_lot_item_id, legacy_production_lot_item_id, created_at
    ) VALUES (
      v_uid, v_tcode,
      COALESCE(v_order_id, (SELECT order_id FROM public.production_lots WHERE id = NEW.lot_id)),
      NEW.lot_id, NULL,
      COALESCE(NEW.environment_name, v_lot_item.environment_name),
      COALESCE(NEW.product_name, v_lot_item.piece_name, 'Peça sem nome'),
      NULL, v_lot_item.material, v_lot_item.color,
      COALESCE(v_lot_item.thickness, 0), COALESCE(v_lot_item.width, 0),
      COALESCE(v_lot_item.height, 0), COALESCE(v_lot_item.depth, 0),
      v_lot_item.edge_front, v_lot_item.edge_back, v_lot_item.edge_left,
      v_lot_item.edge_right, COALESCE(v_lot_item.requires_cut, true),
      COALESCE(v_lot_item.requires_edge, false), COALESCE(v_lot_item.requires_cnc, false),
      COALESCE(v_lot_item.requires_joinery, false),
      COALESCE(v_lot_item.requires_separation, true),
      COALESCE(v_lot_item.requires_packaging, true), NEW.current_step,
      CASE
        WHEN NEW.status = 'completed' THEN 'completed'
        WHEN NEW.status = 'cancelled' THEN 'cancelled'
        WHEN NEW.status = 'rework' THEN 'rework'
        ELSE 'planned'
      END,
      CASE WHEN NEW.source_lot_item_id IS NOT NULL THEN 'promob_xml' ELSE 'manual' END,
      NEW.source_lot_item_id, NEW.id, NEW.created_at
    ) RETURNING id INTO v_piece_id;

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id, event_type,
      from_stage, to_stage, event_status, created_at
    ) VALUES (
      v_piece_id, v_tcode, v_order_id, NEW.lot_id, 'reading',
      NULL, NEW.current_step, 'accepted', NEW.created_at
    );
  ELSE
    UPDATE public.production_pieces
    SET current_stage = CASE
          WHEN pcp_import_batch_id IS NULL THEN NEW.current_step
          ELSE current_stage
        END,
        status = CASE
          WHEN NEW.status = 'completed' THEN 'completed'
          WHEN NEW.status = 'cancelled' THEN 'cancelled'
          WHEN NEW.status = 'rework' THEN 'rework'
          ELSE 'in_progress'
        END,
        updated_at = now()
    WHERE id = v_piece_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_production_lot_item_to_piece ON public.production_lot_items;
CREATE TRIGGER trg_sync_production_lot_item_to_piece
  AFTER INSERT OR UPDATE ON public.production_lot_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_production_lot_item_to_piece();

INSERT INTO public.pcp_mapping_profiles (profile_name, version, columns_mapping, is_active)
VALUES (
  'pcp_promob_semicolon_v2',
  2,
  '{
    "sourceGroup": 0,
    "projectName": 1,
    "environmentName": 1,
    "customer": 2,
    "width": 5,
    "height": 6,
    "thickness": 7,
    "materialCode": 8,
    "material": 10,
    "pieceName": 11,
    "lineSequence": 12,
    "pieceCode": 13,
    "barcode": 14,
    "moduleName": 15,
    "checkBarcode": 24,
    "generalLotCode": 25,
    "route": 26,
    "clientLotCode": 28
  }'::jsonb,
  true
)
ON CONFLICT (profile_name) DO UPDATE
SET columns_mapping = EXCLUDED.columns_mapping,
    version = EXCLUDED.version,
    is_active = true;

-- 1. O ledger é a fonte permanente de auditoria de TODA tentativa de coleta.
ALTER TABLE public.production_collection_events
  ADD COLUMN IF NOT EXISTS piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS pcp_import_batch_id uuid REFERENCES public.promob_import_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz NOT NULL DEFAULT now();

UPDATE public.production_collection_events e
SET piece_id = sr.piece_id
FROM public.production_stage_readings sr
WHERE e.reading_id = sr.id
  AND e.piece_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_collection_events_cell_created
  ON public.production_collection_events(cell_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_events_piece_created
  ON public.production_collection_events(piece_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_events_machine_created
  ON public.production_collection_events(machine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_events_result_created
  ON public.production_collection_events(result_status, created_at DESC);

-- O histórico remoto não possui TTL. A limpeza de eventos sincronizados no
-- IndexedDB do navegador não remove nenhuma linha deste ledger.
REVOKE DELETE ON public.production_collection_events FROM anon, authenticated;

-- 2. Unicidade canônica por peça/etapa/ciclo. O ranking preserva leituras
-- antigas e permite distinguir ciclos legados/retrabalho sem apagar dados.
ALTER TABLE public.production_stage_readings
  ADD COLUMN IF NOT EXISTS production_cycle integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tag_type text;

COMMENT ON COLUMN public.production_stage_readings.tag_type IS
  'Tipo de identificação usado na coleta (barcode, RFID ou baixa manual).';

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY piece_id, step_name
           ORDER BY created_at, id
         )::integer AS cycle_number
  FROM public.production_stage_readings
  WHERE status = 'approved'
    AND piece_id IS NOT NULL
    AND step_name IS NOT NULL
)
UPDATE public.production_stage_readings sr
SET production_cycle = ranked.cycle_number
FROM ranked
WHERE sr.id = ranked.id
  AND sr.production_cycle IS DISTINCT FROM ranked.cycle_number;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_readings_piece_step_cycle_approved
  ON public.production_stage_readings(piece_id, step_name, production_cycle)
  WHERE status = 'approved' AND piece_id IS NOT NULL AND step_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pcp_import_rows_batch_row
  ON public.pcp_import_rows(batch_id, row_number);

-- Snapshot único da célula: carga ativa vem das peças/lotes PCP; produção do
-- turno vem das leituras. Todos os operadores e máquinas compõem o resultado.
CREATE OR REPLACE FUNCTION public.get_collection_cell_snapshot(
  p_cell_name text,
  p_workstation_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_code text;
  v_expected bigint := 0;
  v_pending bigint := 0;
  v_rework bigint := 0;
  v_replacement bigint := 0;
  v_active_lots bigint := 0;
  v_active_batches bigint := 0;
  v_approved numeric := 0;
  v_rejected numeric := 0;
  v_blocked numeric := 0;
BEGIN
  SELECT code INTO v_step_code
  FROM public.routing_steps
  WHERE lower(code) = lower(p_cell_name)
     OR lower(name) = lower(p_cell_name)
     OR (p_cell_name IN ('Borda', 'Bordo') AND code = 'edge')
     OR (p_cell_name = 'Usinagem' AND code = 'cnc')
     OR (p_cell_name = 'Furação' AND code = 'drill')
  ORDER BY sequence NULLS LAST
  LIMIT 1;
  v_step_code := COALESCE(v_step_code, lower(p_cell_name));

  SELECT count(*),
         count(*) FILTER (
           WHERE NOT (v_step_code = ANY(COALESCE(p.completed_steps, '{}'::text[])))
         ),
         count(*) FILTER (
           WHERE p.status IN ('rework_pending','rework_in_progress') OR p.rework_status = 'in_progress'
         ),
         count(*) FILTER (
           WHERE p.status IN ('replacement_requested','replacement_in_production') OR p.replacement_status = 'in_production'
         ),
         count(DISTINCT p.lot_id),
         count(DISTINCT p.pcp_import_batch_id)
  INTO v_expected, v_pending, v_rework, v_replacement, v_active_lots, v_active_batches
  FROM public.production_pieces p
  JOIN public.production_lots l ON l.id = p.lot_id
  WHERE v_step_code = ANY(COALESCE(p.route_steps, '{}'::text[]))
    AND p.status NOT IN ('cancelled','replaced','shipped')
    AND l.status NOT IN ('closed','shipped','cancelled');

  SELECT
    COALESCE(sum(quantity) FILTER (WHERE status = 'approved'), 0),
    COALESCE(sum(quantity) FILTER (WHERE status = 'rejected'), 0),
    COALESCE(sum(quantity) FILTER (WHERE status IN ('blocked','duplicated')), 0)
  INTO v_approved, v_rejected, v_blocked
  FROM public.production_stage_readings sr
  WHERE lower(COALESCE(sr.cell_name, '')) = lower(p_cell_name)
    AND (p_workstation_id IS NULL OR sr.machine_id = p_workstation_id)
    AND (p_shift IS NULL OR sr.shift = p_shift)
    AND (p_date_from IS NULL OR sr.created_at >= p_date_from)
    AND (p_date_to IS NULL OR sr.created_at < p_date_to);

  RETURN jsonb_build_object(
    'total', v_approved + v_rejected + v_blocked,
    'approved', v_approved,
    'rejected', v_rejected,
    'blocked', v_blocked,
    'expected', v_expected,
    'pending', v_pending,
    'rework', v_rework,
    'replacement', v_replacement,
    'active_lots', v_active_lots,
    'active_pcp_batches', v_active_batches,
    'step_code', v_step_code,
    'date_from', p_date_from,
    'date_to', p_date_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_collection_cell_snapshot(text, uuid, text, timestamptz, timestamptz)
  TO authenticated, anon;

-- 3. Histórico paginado. A consulta parte do ledger, portanto inclui
-- aprovações, rejeições, bloqueios, duplicidades, inválidos e não encontrados.
DROP FUNCTION IF EXISTS public.get_collection_history(
  uuid, uuid, uuid, text, text, uuid, integer, integer, timestamptz, timestamptz, text
);

CREATE FUNCTION public.get_collection_history(
  p_cell_id uuid DEFAULT NULL,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_cell_name text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  client_event_id text,
  created_at timestamptz,
  server_created_at timestamptz,
  processed_at timestamptz,
  date date,
  hour text,
  traceability_code text,
  raw_value text,
  piece_id uuid,
  piece_name text,
  pcp_import_batch_id uuid,
  pcp_batch_name text,
  lot_id uuid,
  lot_code text,
  order_number text,
  client_name text,
  current_stage_name text,
  operation_name text,
  operator_id uuid,
  operator_name text,
  registration text,
  cell_name text,
  machine_id uuid,
  machine_name text,
  station_name text,
  shift text,
  reader_type text,
  event_status text,
  result_status text,
  sync_status text,
  message text,
  route_steps text[],
  completed_steps text[],
  result_payload jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH history AS (
    SELECT
      e.id,
      e.id AS event_id,
      e.client_event_id,
      COALESCE(e.created_at_client, e.created_at) AS created_at,
      e.created_at AS server_created_at,
      e.processed_at,
      e.date,
      e.hour,
      COALESCE(NULLIF(e.piece_code, ''), p.traceability_code, p.piece_uid, NULLIF(e.normalized_value, ''), e.raw_value) AS traceability_code,
      e.raw_value,
      COALESCE(e.piece_id, sr.piece_id) AS piece_id,
      p.piece_name,
      COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id) AS pcp_import_batch_id,
      COALESCE(batch.general_lot_code, batch.file_name) AS pcp_batch_name,
      COALESCE(e.lot_id, sr.lot_id, p.lot_id) AS lot_id,
      COALESCE(e.lot_code, l.lot_code) AS lot_code,
      COALESCE(e.order_number, po.order_number, po.order_code) AS order_number,
      COALESCE(e.customer_name, po.customer_name) AS client_name,
      COALESCE(sr.step_name, e.operation_name, e.result_payload #>> '{route,step_name}', p.current_stage) AS current_stage_name,
      COALESCE(e.operation_name, sr.operation_name, sr.step_name) AS operation_name,
      e.operator_id,
      COALESCE(e.operator_name, op.name, sr.operator) AS operator_name,
      COALESCE(e.registration, op.registration) AS registration,
      COALESCE(e.cell_name, sr.cell_name) AS cell_name,
      COALESCE(e.machine_id, sr.machine_id) AS machine_id,
      COALESCE(e.machine_name, sr.machine_name) AS machine_name,
      COALESCE(e.station_name, sr.station_name) AS station_name,
      COALESCE(e.shift, sr.shift) AS shift,
      e.reader_type,
      CASE
        WHEN e.result_status = 'approved' THEN 'approved'
        WHEN e.result_status = 'rejected' THEN 'rejected'
        WHEN e.result_status = 'duplicated' THEN 'duplicated'
        WHEN e.result_status IN ('blocked', 'wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        WHEN e.status = 'error' THEN 'error'
        WHEN e.status = 'synced' THEN 'approved'
        ELSE COALESCE(NULLIF(e.result_status, ''), e.status)
      END AS event_status,
      e.result_status,
      e.status AS sync_status,
      COALESCE(e.result_payload->>'message', e.error_message) AS message,
      COALESCE(p.route_steps, '{}'::text[]) AS route_steps,
      COALESCE(p.completed_steps, '{}'::text[]) AS completed_steps,
      e.result_payload
    FROM public.production_collection_events e
    LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
    LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
    LEFT JOIN public.promob_import_batches batch ON batch.id = COALESCE(e.pcp_import_batch_id, p.pcp_import_batch_id)
    LEFT JOIN public.production_lots l ON l.id = COALESCE(e.lot_id, sr.lot_id, p.lot_id)
    LEFT JOIN public.production_orders po ON po.id = COALESCE(e.production_order_id, p.production_order_id, l.production_order_id, l.order_id)
    LEFT JOIN public.operators op ON op.id = e.operator_id
    WHERE (p_cell_name IS NULL OR lower(COALESCE(e.cell_name, sr.cell_name, '')) = lower(p_cell_name))
      AND (p_cell_id IS NULL OR EXISTS (
        SELECT 1 FROM public.cells c
        WHERE c.id = p_cell_id
          AND lower(c.name) = lower(COALESCE(e.cell_name, sr.cell_name, ''))
      ))
      AND (p_workstation_id IS NULL OR COALESCE(e.machine_id, sr.machine_id) = p_workstation_id)
      AND (p_operator_id IS NULL OR e.operator_id = p_operator_id)
      AND (p_shift IS NULL OR COALESCE(e.shift, sr.shift) = p_shift)
      AND (p_lot_id IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = p_lot_id)
      AND (p_date_from IS NULL OR COALESCE(e.created_at_client, e.created_at) >= p_date_from)
      AND (p_date_to IS NULL OR COALESCE(e.created_at_client, e.created_at) <= p_date_to)
  )
  SELECT *
  FROM history h
  WHERE p_status IS NULL OR h.event_status = p_status
  ORDER BY h.created_at DESC, h.server_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

DROP FUNCTION IF EXISTS public.get_collection_history_count(
  uuid, uuid, uuid, text, text, uuid, timestamptz, timestamptz, text
);

CREATE FUNCTION public.get_collection_history_count(
  p_cell_id uuid DEFAULT NULL,
  p_workstation_id uuid DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_shift text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_lot_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_cell_name text DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.production_collection_events e
  LEFT JOIN public.production_stage_readings sr ON sr.id = e.reading_id
  LEFT JOIN public.production_pieces p ON p.id = COALESCE(e.piece_id, sr.piece_id)
  WHERE (p_cell_name IS NULL OR lower(COALESCE(e.cell_name, sr.cell_name, '')) = lower(p_cell_name))
    AND (p_cell_id IS NULL OR EXISTS (
      SELECT 1 FROM public.cells c
      WHERE c.id = p_cell_id
        AND lower(c.name) = lower(COALESCE(e.cell_name, sr.cell_name, ''))
    ))
    AND (p_workstation_id IS NULL OR COALESCE(e.machine_id, sr.machine_id) = p_workstation_id)
    AND (p_operator_id IS NULL OR e.operator_id = p_operator_id)
    AND (p_shift IS NULL OR COALESCE(e.shift, sr.shift) = p_shift)
    AND (p_lot_id IS NULL OR COALESCE(e.lot_id, sr.lot_id, p.lot_id) = p_lot_id)
    AND (p_date_from IS NULL OR COALESCE(e.created_at_client, e.created_at) >= p_date_from)
    AND (p_date_to IS NULL OR COALESCE(e.created_at_client, e.created_at) <= p_date_to)
    AND (
      p_status IS NULL OR
      CASE
        WHEN e.result_status = 'approved' THEN 'approved'
        WHEN e.result_status = 'rejected' THEN 'rejected'
        WHEN e.result_status = 'duplicated' THEN 'duplicated'
        WHEN e.result_status IN ('blocked', 'wrong_step', 'wrong_cell', 'warning') THEN 'blocked'
        WHEN e.status = 'error' THEN 'error'
        WHEN e.status = 'synced' THEN 'approved'
        ELSE COALESCE(NULLIF(e.result_status, ''), e.status)
      END = p_status
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_collection_history(
  uuid, uuid, uuid, text, text, uuid, integer, integer, timestamptz, timestamptz, text
) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_collection_history_count(
  uuid, uuid, uuid, text, text, uuid, timestamptz, timestamptz, text
) TO authenticated, anon;

-- 4. Finalização padronizada: o mesmo JSON persistido é devolvido em retries.
CREATE OR REPLACE FUNCTION public.finish_collection_event(
  p_event_id uuid,
  p_ledger_status text,
  p_result_status text,
  p_result jsonb,
  p_reading_id uuid DEFAULT NULL,
  p_entry_id uuid DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.production_collection_events
  SET status = p_ledger_status,
      result_status = p_result_status,
      result_payload = COALESCE(p_result, '{}'::jsonb),
      reading_id = COALESCE(p_reading_id, reading_id),
      production_entry_id = COALESCE(p_entry_id, production_entry_id),
      error_message = p_error_message,
      processed_at = now(),
      sync_finished_at = now(),
      sync_duration_ms = CASE
        WHEN sync_started_at IS NULL THEN NULL
        ELSE EXTRACT(epoch FROM (now() - sync_started_at)) * 1000
      END,
      updated_at = now(),
      last_attempt_at = now()
  WHERE id = p_event_id;

  RETURN p_result;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_collection_event(uuid, text, text, jsonb, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Consolida o andamento do lote geral PCP a partir de todas as peças e de
-- todas as células/máquinas pelas quais elas passam.
CREATE OR REPLACE FUNCTION public.refresh_pcp_batch_progress(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_parts bigint := 0;
  v_completed_parts bigint := 0;
  v_total_operations bigint := 0;
  v_completed_operations bigint := 0;
  v_progress numeric(5,2) := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE p.status IN ('completed','packed','inspected','ready_for_shipping','shipped')),
    COALESCE(sum(cardinality(COALESCE(p.route_steps, '{}'::text[]))), 0),
    COALESCE(sum(cardinality(ARRAY(
      SELECT DISTINCT step
      FROM unnest(COALESCE(p.route_steps, '{}'::text[])) AS step
      WHERE step = ANY(COALESCE(p.completed_steps, '{}'::text[]))
    ))), 0)
  INTO v_total_parts, v_completed_parts, v_total_operations, v_completed_operations
  FROM public.production_pieces p
  WHERE p.pcp_import_batch_id = p_batch_id
    AND p.status NOT IN ('cancelled','replaced');

  v_progress := CASE
    WHEN v_total_operations > 0
      THEN ROUND((v_completed_operations::numeric / v_total_operations::numeric) * 100, 2)
    WHEN v_total_parts > 0
      THEN ROUND((v_completed_parts::numeric / v_total_parts::numeric) * 100, 2)
    ELSE 0
  END;

  UPDATE public.promob_import_batches
  SET total_parts = v_total_parts,
      completed_parts = v_completed_parts,
      pending_parts = GREATEST(v_total_parts - v_completed_parts, 0),
      total_operations = v_total_operations,
      completed_operations = v_completed_operations,
      progress_percent = LEAST(GREATEST(v_progress, 0), 100)
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'total_parts', v_total_parts,
    'completed_parts', v_completed_parts,
    'pending_parts', GREATEST(v_total_parts - v_completed_parts, 0),
    'total_operations', v_total_operations,
    'completed_operations', v_completed_operations,
    'progress_percent', LEAST(GREATEST(v_progress, 0), 100)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_pcp_batch_progress(uuid) TO authenticated;

DO $$
DECLARE
  batch_row record;
BEGIN
  FOR batch_row IN
    SELECT DISTINCT pcp_import_batch_id AS id
    FROM public.production_pieces
    WHERE pcp_import_batch_id IS NOT NULL
  LOOP
    PERFORM public.refresh_pcp_batch_progress(batch_row.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sync_pcp_batch_progress_from_piece()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.pcp_import_batch_id IS DISTINCT FROM NEW.pcp_import_batch_id
     AND OLD.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(OLD.pcp_import_batch_id);
  END IF;
  IF NEW.pcp_import_batch_id IS NOT NULL THEN
    PERFORM public.refresh_pcp_batch_progress(NEW.pcp_import_batch_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pcp_batch_progress_from_piece ON public.production_pieces;
CREATE TRIGGER trg_sync_pcp_batch_progress_from_piece
AFTER UPDATE OF completed_steps, status, pcp_import_batch_id, route_steps
ON public.production_pieces
FOR EACH ROW
EXECUTE FUNCTION public.sync_pcp_batch_progress_from_piece();

-- 5. Processamento atômico multioperador.
-- A transação: reivindica o client_event_id, bloqueia a peça, valida o fluxo,
-- grava histórico/leitura/entrada, atualiza lote e alimenta os contadores.
CREATE OR REPLACE FUNCTION public.process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_event_id text := NULLIF(TRIM(p_payload->>'client_event_id'), '');
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', p_payload->>'raw_value', p_payload->>'tagValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), NULLIF(p_payload->>'reader_type', ''), 'keyboard_barcode');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', p_payload->>'cell_name', '')), '');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', p_payload->>'station_name', '')), '');
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', p_payload->>'step_name', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_shift text := NULLIF(TRIM(COALESCE(p_payload->>'shift', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour', ''), to_char(now(), 'HH24:MI'));
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_created_at_client timestamptz := COALESCE(
    NULLIF(p_payload->>'createdAtClient', '')::timestamptz,
    NULLIF(p_payload->>'created_at_client', '')::timestamptz,
    now()
  );
  v_machine_id uuid := NULLIF(COALESCE(p_payload->>'machineId', p_payload->>'machine_id'), '')::uuid;
  v_machine_name text := NULLIF(TRIM(COALESCE(p_payload->>'machineName', p_payload->>'machine_name', '')), '');
  v_device_id text := NULLIF(TRIM(COALESCE(p_payload->>'deviceId', p_payload->>'device_id', '')), '');
  v_enqueue_duration_ms numeric := COALESCE(NULLIF(p_payload->>'enqueue_duration_ms', '')::numeric, 0);

  v_operator_id uuid;
  v_registration text;
  v_operator_row public.operators%ROWTYPE;
  v_event public.production_collection_events%ROWTYPE;
  v_piece public.production_pieces%ROWTYPE;
  v_lot public.production_lots%ROWTYPE;
  v_order public.production_orders%ROWTYPE;
  v_reading public.production_stage_readings%ROWTYPE;
  v_existing_reading public.production_stage_readings%ROWTYPE;
  v_entry_id uuid;
  v_result jsonb;
  v_batch_progress jsonb;
  v_val_res jsonb;
  v_target_step_code text;
  v_from_stage text;
  v_new_completed_steps text[];
  v_next_step text;
  v_found_next boolean := false;
  v_total_pieces bigint := 0;
  v_completed_pieces bigint := 0;
  v_total_steps bigint := 0;
  v_completed_steps_count bigint := 0;
  v_lot_progress numeric(5,2) := 0;
  i integer;
BEGIN
  IF auth.uid() IS NULL OR public.get_my_role() NOT IN ('admin','manager','supervisor','operator') THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'forbidden',
      'message', 'Usuário sem permissão para coleta produtiva.'
    );
  END IF;

  v_client_event_id := COALESCE(v_client_event_id, gen_random_uuid()::text);

  -- Resolver operador antes de persistir o snapshot do evento.
  IF COALESCE(p_payload->>'operatorId', p_payload->>'operator_id') IS NOT NULL
     AND COALESCE(p_payload->>'operatorId', p_payload->>'operator_id') <> '' THEN
    SELECT * INTO v_operator_row
    FROM public.operators
    WHERE id = COALESCE(p_payload->>'operatorId', p_payload->>'operator_id')::uuid;
  ELSE
    SELECT * INTO v_operator_row
    FROM public.operators
    WHERE lower(name) = lower(v_operator)
    ORDER BY active DESC NULLS LAST, created_at
    LIMIT 1;
  END IF;

  IF v_operator_row.id IS NOT NULL THEN
    v_operator_id := v_operator_row.id;
    v_operator := v_operator_row.name;
    v_registration := v_operator_row.registration;
    v_shift := COALESCE(v_shift, v_operator_row.shift);
  END IF;

  -- Claim atômico. Em concorrência, o INSERT espera a transação vencedora;
  -- depois o retry recebe exatamente o result_payload já confirmado.
  INSERT INTO public.production_collection_events (
    client_event_id, raw_value, normalized_value, reader_type,
    operator_id, operator_name, registration, cell_name, shift, date, hour,
    status, created_at_client, payload, machine_id, machine_name, station_name,
    device_id, enqueue_duration_ms, sync_started_at, attempt_count, last_attempt_at
  ) VALUES (
    v_client_event_id, v_tag_value, v_tag_value, v_reader_type,
    v_operator_id, v_operator, v_registration, v_cell, v_shift, v_date, v_hour,
    'processing', v_created_at_client, p_payload, v_machine_id, v_machine_name, v_station,
    v_device_id, v_enqueue_duration_ms, now(), 1, now()
  )
  ON CONFLICT (client_event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT * INTO v_event
    FROM public.production_collection_events
    WHERE client_event_id = v_client_event_id;

    UPDATE public.production_collection_events
    SET attempt_count = attempt_count + 1,
        last_attempt_at = now()
    WHERE id = v_event.id;

    IF v_event.result_payload IS NOT NULL AND v_event.result_payload <> '{}'::jsonb
       AND v_event.status IN ('synced', 'ignored', 'error') THEN
      RETURN v_event.result_payload;
    END IF;

    IF v_event.status = 'synced' THEN
      SELECT * INTO v_reading FROM public.production_stage_readings WHERE id = v_event.reading_id;
      SELECT * INTO v_piece FROM public.production_pieces WHERE id = COALESCE(v_event.piece_id, v_reading.piece_id);
      SELECT * INTO v_lot FROM public.production_lots WHERE id = COALESCE(v_event.lot_id, v_reading.lot_id, v_piece.lot_id);
      v_result := jsonb_build_object(
        'success', true,
        'status', 'approved',
        'alert_level', 'green',
        'message', 'Leitura já processada anteriormente.',
        'lot', to_jsonb(v_lot),
        'item', to_jsonb(v_piece),
        'reading', to_jsonb(v_reading)
      );
      UPDATE public.production_collection_events SET result_payload = v_result WHERE id = v_event.id;
      RETURN v_result;
    END IF;

    IF v_event.status = 'ignored' THEN
      v_result := jsonb_build_object(
        'success', false,
        'status', COALESCE(v_event.result_status, 'ignored'),
        'message', COALESCE(v_event.error_message, 'Evento já processado anteriormente.')
      );
      UPDATE public.production_collection_events SET result_payload = v_result WHERE id = v_event.id;
      RETURN v_result;
    END IF;

    IF v_event.status = 'processing' THEN
      RAISE EXCEPTION 'Evento % ainda está em processamento; tente novamente.', v_client_event_id
        USING ERRCODE = '40001';
    END IF;

    -- Eventos antigos marcados como erro podem ser retomados mantendo o mesmo ID.
    UPDATE public.production_collection_events
    SET status = 'processing',
        payload = p_payload,
        sync_started_at = now(),
        sync_finished_at = NULL,
        error_message = NULL,
        updated_at = now()
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  END IF;

  IF v_tag_value = '' THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'invalid',
      'alert_level', 'red',
      'message', 'Informe uma identificação produtiva válida.'
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'invalid', v_result, NULL, NULL, v_result->>'message');
  END IF;

  BEGIN
    v_piece := public.resolve_piece_by_identifier(v_tag_value);
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'not_found',
      'alert_level', 'red',
      'message', SQLERRM
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'not_found', v_result, NULL, NULL, SQLERRM);
  END;

  -- Serializa todas as entradas da mesma peça, inclusive entre dispositivos.
  SELECT * INTO v_piece
  FROM public.production_pieces
  WHERE id = v_piece.id
  FOR UPDATE;

  SELECT * INTO v_lot FROM public.production_lots WHERE id = v_piece.lot_id;
  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = COALESCE(v_piece.production_order_id, v_lot.production_order_id, v_lot.order_id);

  UPDATE public.production_collection_events
  SET piece_id = v_piece.id,
      pcp_import_batch_id = v_piece.pcp_import_batch_id,
      lot_id = v_piece.lot_id,
      production_order_id = v_piece.production_order_id,
      lot_code = v_lot.lot_code,
      load_number = v_order.load_number,
      order_number = COALESCE(v_order.order_number, v_order.order_code),
      customer_name = v_order.customer_name,
      environment_name = v_piece.environment,
      piece_code = v_piece.traceability_code,
      updated_at = now()
  WHERE id = v_event.id;

  IF v_step_input IS NOT NULL THEN
    v_target_step_code := v_step_input;
  ELSE
    SELECT code INTO v_target_step_code
    FROM public.routing_steps
    WHERE lower(code) = lower(v_cell)
       OR lower(name) = lower(v_cell)
       OR (v_cell IN ('Borda', 'Bordo') AND code = 'edge')
       OR (v_cell = 'Usinagem' AND code = 'cnc')
       OR (v_cell = 'Furação' AND code = 'drill')
    ORDER BY sequence NULLS LAST
    LIMIT 1;
  END IF;
  v_target_step_code := COALESCE(v_target_step_code, v_piece.current_stage);

  UPDATE public.production_collection_events
  SET operation_name = v_target_step_code
  WHERE id = v_event.id;

  v_val_res := public.validar_fluxo_da_peca(v_piece.id, v_target_step_code);

  -- Bloqueios e duplicidades também são fatos auditáveis e alimentam os
  -- contadores gerais, mas nunca geram production_entries aprovadas.
  IF NOT COALESCE((v_val_res->>'success')::boolean, false)
     OR v_val_res->>'status' = 'duplicated' THEN
    IF v_piece.lot_id IS NOT NULL THEN
      INSERT INTO public.production_stage_readings (
        client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
        operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
        step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
        lot_code, load_number, order_number, customer_name, environment_name,
        operation_name, piece_code
      ) VALUES (
        v_client_event_id, v_piece.piece_uid,
        CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
        v_reader_type, v_station, v_cell,
        v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
        v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
        CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
        CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated_scan' ELSE 'wrong_step' END,
        v_operator_id, v_machine_id, v_machine_name, v_lot.lot_code, v_order.load_number,
        COALESCE(v_order.order_number, v_order.order_code), v_order.customer_name,
        v_piece.environment, v_target_step_code, v_piece.traceability_code
      ) RETURNING * INTO v_reading;
    END IF;

    INSERT INTO public.production_events (
      piece_id, traceability_code, production_order_id, lot_id, event_type,
      from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
      event_status, reading_source, barcode_raw_value, notes, legacy_stage_reading_id
    ) VALUES (
      v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id, 'block',
      v_piece.current_stage, v_target_step_code, v_cell, v_machine_id::text, v_device_id, v_operator_id,
      CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
      v_reader_type, v_tag_value, v_val_res->>'message', v_reading.id
    );

    v_result := jsonb_build_object(
      'success', false,
      'status', COALESCE(v_val_res->>'status', 'blocked'),
      'alert_level', COALESCE(v_val_res->>'alert_level', 'red'),
        'message', COALESCE(v_val_res->>'message', 'Entrada bloqueada.'),
        'lot', to_jsonb(v_lot),
        'order', to_jsonb(v_order),
        'item', to_jsonb(v_piece),
      'reading', CASE WHEN v_reading.id IS NULL THEN NULL ELSE to_jsonb(v_reading) END
    );
    RETURN public.finish_collection_event(
      v_event.id,
      'ignored',
      CASE WHEN v_val_res->>'status' = 'duplicated' THEN 'duplicated' ELSE 'blocked' END,
      v_result,
      v_reading.id,
      NULL,
      v_result->>'message'
    );
  END IF;

  -- Defesa adicional para bases antigas cujo completed_steps esteja defasado.
  SELECT * INTO v_existing_reading
  FROM public.production_stage_readings
  WHERE piece_id = v_piece.id
    AND step_name = v_target_step_code
    AND production_cycle = 1
    AND status = 'approved'
  ORDER BY created_at
  LIMIT 1;

  IF v_existing_reading.id IS NOT NULL THEN
    INSERT INTO public.production_stage_readings (
      client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
      operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
      step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
      lot_code, load_number, order_number, customer_name, environment_name,
      operation_name, piece_code
    ) VALUES (
      v_client_event_id, v_piece.piece_uid,
      CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
      v_reader_type, v_station, v_cell,
      v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
      v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
      'duplicated', 'duplicated_scan', v_operator_id, v_machine_id, v_machine_name,
      v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
      v_order.customer_name, v_piece.environment, v_target_step_code, v_piece.traceability_code
    ) RETURNING * INTO v_reading;

    v_result := jsonb_build_object(
      'success', false,
      'status', 'duplicated',
      'alert_level', 'yellow',
      'message', 'Peça já aprovada nesta etapa; a nova tentativa foi registrada sem duplicar produção.',
      'lot', to_jsonb(v_lot),
      'order', to_jsonb(v_order),
      'item', to_jsonb(v_piece),
      'reading', to_jsonb(v_reading)
    );
    RETURN public.finish_collection_event(v_event.id, 'ignored', 'duplicated', v_result, v_reading.id, NULL, v_result->>'message');
  END IF;

  v_from_stage := v_piece.current_stage;

  INSERT INTO public.production_stage_readings (
    client_event_id, tag_value, tag_type, reader_type, station_name, cell_name,
    operator, shift, date, hour, item_id, piece_id, lot_id, production_order_id,
    step_name, quantity, status, event_type, operator_id, machine_id, machine_name,
    lot_code, load_number, order_number, customer_name, environment_name,
    operation_name, piece_code, production_cycle
  ) VALUES (
    v_client_event_id, v_piece.piece_uid,
    CASE WHEN v_reader_type = 'manual' THEN 'manual' ELSE 'barcode' END,
    v_reader_type, v_station, v_cell,
    v_operator, v_shift, v_date, v_hour, v_piece.legacy_production_lot_item_id, v_piece.id,
    v_piece.lot_id, v_piece.production_order_id, v_target_step_code, v_quantity,
    'approved', 'approved_scan', v_operator_id, v_machine_id, v_machine_name,
    v_lot.lot_code, v_order.load_number, COALESCE(v_order.order_number, v_order.order_code),
    v_order.customer_name, v_piece.environment, v_target_step_code,
    v_piece.traceability_code, 1
  ) RETURNING * INTO v_reading;

  v_new_completed_steps := COALESCE(v_piece.completed_steps, '{}'::text[]);
  IF NOT (v_target_step_code = ANY(v_new_completed_steps)) THEN
    v_new_completed_steps := array_append(v_new_completed_steps, v_target_step_code);
  END IF;

  v_next_step := NULL;
  v_found_next := false;
  IF v_piece.route_steps IS NOT NULL AND array_length(v_piece.route_steps, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_piece.route_steps, 1) LOOP
      IF v_found_next THEN
        v_next_step := v_piece.route_steps[i];
        EXIT;
      END IF;
      IF lower(v_piece.route_steps[i]) = lower(v_target_step_code) THEN
        v_found_next := true;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.production_pieces
  SET completed_steps = v_new_completed_steps,
      current_stage = COALESCE(v_next_step, v_target_step_code),
      status = CASE WHEN v_next_step IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_piece.id
  RETURNING * INTO v_piece;

  UPDATE public.production_lot_items
  SET current_step = COALESCE(
        (SELECT name FROM public.routing_steps WHERE code = v_piece.current_stage),
        v_piece.current_stage
      ),
      status = CASE WHEN v_piece.status = 'completed' THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_piece.legacy_production_lot_item_id;

  -- Progresso real do lote: etapas concluídas / etapas necessárias de todas as
  -- peças. Assim entradas em células diferentes compõem o mesmo andamento.
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('completed','packed','inspected','ready_for_shipping','shipped'))
  INTO v_total_pieces, v_completed_pieces
  FROM public.production_pieces
  WHERE lot_id = v_lot.id
    AND status NOT IN ('cancelled','replaced');

  SELECT COALESCE(sum(s.required_steps), 0), COALESCE(sum(s.done_steps), 0)
  INTO v_total_steps, v_completed_steps_count
  FROM (
    SELECT cardinality(COALESCE(p.route_steps, '{}'::text[])) AS required_steps,
           cardinality(ARRAY(
             SELECT DISTINCT step
             FROM unnest(COALESCE(p.route_steps, '{}'::text[])) AS step
             WHERE step = ANY(COALESCE(p.completed_steps, '{}'::text[]))
           )) AS done_steps
    FROM public.production_pieces p
    WHERE p.lot_id = v_lot.id
      AND p.status NOT IN ('cancelled','replaced')
  ) s;

  v_lot_progress := CASE
    WHEN v_total_steps > 0 THEN ROUND((v_completed_steps_count::numeric / v_total_steps::numeric) * 100, 2)
    WHEN v_total_pieces > 0 THEN ROUND((v_completed_pieces::numeric / v_total_pieces::numeric) * 100, 2)
    ELSE 0
  END;

  UPDATE public.production_lots
  SET progress_percent = LEAST(GREATEST(v_lot_progress, 0), 100),
      produced_quantity = v_completed_pieces,
      approved_quantity = v_completed_pieces,
      pending_quantity = GREATEST(v_total_pieces - v_completed_pieces, 0),
      current_stage = v_target_step_code,
      current_step = v_target_step_code,
      current_cell = v_cell,
      current_status = CASE
        WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'completed'
        ELSE 'in_progress'
      END,
      status = CASE
        WHEN v_total_pieces > 0 AND v_completed_pieces = v_total_pieces THEN 'waiting_packaging'
        ELSE 'in_progress'
      END,
      actual_start = COALESCE(actual_start, now()),
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  UPDATE public.production_orders
  SET status = CASE
        WHEN status IN ('completed','cancelled') THEN status
        ELSE 'in_production'
      END,
      updated_at = now()
  WHERE id = v_order.id;

  v_batch_progress := public.refresh_pcp_batch_progress(v_piece.pcp_import_batch_id);

  INSERT INTO public.production_events (
    piece_id, traceability_code, production_order_id, lot_id, event_type,
    from_stage, to_stage, cell_name, machine_id, device_id, operator_id,
    event_status, reading_source, barcode_raw_value, legacy_stage_reading_id
  ) VALUES (
    v_piece.id, v_piece.traceability_code, v_piece.production_order_id, v_piece.lot_id,
    'stage_advance', v_from_stage, v_target_step_code, v_cell, v_machine_id::text,
    v_device_id, v_operator_id, 'accepted', v_reader_type, v_tag_value, v_reading.id
  );

  -- Mantém a integração existente: este INSERT continua alimentando gráficos,
  -- metas e production_realtime_counters por meio dos triggers já instalados.
  INSERT INTO public.production_entries (
    date, shift, cell, hour, produced, target, scrap, downtime, operator, notes,
    created_by, client_event_id, operator_id, order_id, production_order_id,
    lot_id, lot_code, load_number, order_number, customer_name, environment_name,
    operation_name, machine_id, machine_name, pcp_import_batch_id
  ) VALUES (
    v_date, COALESCE(v_shift, 'Não informado'), COALESCE(v_cell, 'Não informada'),
    v_hour, v_quantity, 0, 0, 0, v_operator,
    'Coleta MES validada - Peça: ' || v_piece.traceability_code,
    auth.uid(), v_client_event_id, v_operator_id, v_order.id, v_order.id,
    v_lot.id, v_lot.lot_code, v_order.load_number,
    COALESCE(v_order.order_number, v_order.order_code), v_order.customer_name,
    v_piece.environment, v_target_step_code, v_machine_id, v_machine_name,
    v_piece.pcp_import_batch_id
  ) RETURNING id INTO v_entry_id;

  UPDATE public.production_stage_readings
  SET production_entry_id = v_entry_id
  WHERE id = v_reading.id;

  v_result := jsonb_build_object(
    'success', true,
    'status', 'approved',
    'alert_level', COALESCE(v_val_res->>'alert_level', 'green'),
    'message', COALESCE(v_val_res->>'message', 'Peça liberada e registrada com sucesso.'),
    'lot', to_jsonb(v_lot),
    'order', to_jsonb(v_order),
    'item', to_jsonb(v_piece),
    'reading', to_jsonb(v_reading),
    'lot_progress_percent', v_lot.progress_percent,
    'general_lot_progress', v_batch_progress
  );

  RETURN public.finish_collection_event(v_event.id, 'synced', 'approved', v_result, v_reading.id, v_entry_id, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_production_reading(jsonb) TO authenticated, anon;

COMMENT ON FUNCTION public.process_production_reading(jsonb) IS
  'Processa coleta MES com claim idempotente, lock por peça, histórico permanente e atualização atômica de lote/entradas/KPIs.';

-- 6. Importação PCP linha a linha.
-- O batch identifica o arquivo completo; lotCode agrupa o lote produtivo e
-- orderCode/customer da própria linha preservam pedido e cliente de cada peça.
DROP FUNCTION IF EXISTS public.commit_pcp_import(uuid, text, text, text, text, text, integer, jsonb);

CREATE FUNCTION public.commit_pcp_import(
  p_batch_id uuid,
  p_order_code text,
  p_lot_code text,
  p_customer text,
  p_project_name text,
  p_mapping_profile text,
  p_mapping_version integer,
  p_rows jsonb,
  p_finalize boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_current_user uuid := auth.uid();
  v_order_id uuid;
  v_first_order_id uuid;
  v_lot_id uuid;
  v_piece_id uuid;
  v_lot_item_id uuid;
  v_route_steps text[];
  v_row_order_code text;
  v_row_general_lot_code text;
  v_row_lot_code text;
  v_row_customer text;
  v_row_project text;
  v_barcode text;
  v_check_barcode text;
  v_route text;
  v_piece_code text;
  v_piece_name text;
  v_manual_joinery boolean;
  v_quantity integer;
  v_material text;
  v_color text;
  v_thickness numeric;
  v_width numeric;
  v_height numeric;
  v_environment text;
  v_module text;
  v_piece_uid text;
  v_suffix text;
  v_inserted_pieces integer := 0;
  v_inserted_rows integer := 0;
  v_order_count integer := 0;
  v_lot_count integer := 0;
  v_customer_count integer := 0;
  v_total_batch_pieces integer := 0;
  v_total_batch_rows integer := 0;
  v_existing_batch_id uuid;
  v_batch_general_lot_code text;
  v_existing_lot_batch_id uuid;
  v_existing_lot_customer text;
  i integer;
BEGIN
  IF v_current_user IS NULL OR public.get_my_role() NOT IN ('admin','manager','supervisor') THEN
    RAISE EXCEPTION 'Usuário sem permissão para confirmar importação PCP.' USING ERRCODE = '42501';
  END IF;

  SELECT general_lot_code INTO v_batch_general_lot_code
  FROM public.promob_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importação % não localizado.', p_batch_id USING ERRCODE = 'P0008';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'A importação PCP não contém linhas válidas.' USING ERRCODE = 'P0009';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row_order_code := COALESCE(NULLIF(TRIM(v_row->>'orderCode'), ''), NULLIF(TRIM(p_order_code), ''), 'PED-' || p_batch_id::text);
    v_row_general_lot_code := COALESCE(NULLIF(TRIM(v_row->>'generalLotCode'), ''), NULLIF(TRIM(p_lot_code), ''));
    v_row_lot_code := NULLIF(TRIM(v_row->>'clientLotCode'), '');
    v_row_customer := COALESCE(NULLIF(TRIM(v_row->>'customer'), ''), NULLIF(TRIM(p_customer), ''), 'Cliente não informado');
    v_row_project := COALESCE(NULLIF(TRIM(v_row->>'projectName'), ''), NULLIF(TRIM(p_project_name), ''), '');
    v_barcode := UPPER(TRIM(COALESCE(v_row->>'barcode', '')));
    v_check_barcode := UPPER(TRIM(COALESCE(v_row->>'checkBarcode', '')));
    v_route := TRIM(COALESCE(v_row->>'route', ''));
    v_piece_code := COALESCE(NULLIF(TRIM(v_row->>'pieceCode'), ''), v_barcode);
    v_piece_name := COALESCE(NULLIF(TRIM(v_row->>'pieceName'), ''), 'Sem nome');
    v_manual_joinery := COALESCE((v_row->>'manualJoinery')::boolean, false);
    -- Regra do arquivo PCP: uma ocorrência da linha equivale a uma peça.
    v_quantity := 1;
    v_material := NULLIF(TRIM(v_row->>'material'), '');
    v_color := NULLIF(TRIM(v_row->>'color'), '');
    v_thickness := NULLIF(REPLACE(v_row->>'thickness', ',', '.'), '')::numeric;
    v_width := NULLIF(REPLACE(v_row->>'width', ',', '.'), '')::numeric;
    v_height := NULLIF(REPLACE(v_row->>'height', ',', '.'), '')::numeric;
    v_environment := NULLIF(TRIM(v_row->>'environmentName'), '');
    v_module := NULLIF(TRIM(v_row->>'moduleName'), '');

    IF v_barcode = '' THEN
      RAISE EXCEPTION 'Linha % sem código de barras.', COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1);
    END IF;
    IF v_row_general_lot_code IS NULL THEN
      RAISE EXCEPTION 'Linha % sem lote geral PCP.', COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1);
    END IF;
    IF v_batch_general_lot_code IS NULL OR v_batch_general_lot_code = '' THEN
      v_batch_general_lot_code := v_row_general_lot_code;
      UPDATE public.promob_import_batches
      SET general_lot_code = v_batch_general_lot_code
      WHERE id = p_batch_id;
    ELSIF v_batch_general_lot_code <> v_row_general_lot_code THEN
      RAISE EXCEPTION 'Linha % pertence ao lote geral %, mas esta importação é do lote geral %.',
        COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1),
        v_row_general_lot_code,
        v_batch_general_lot_code;
    END IF;
    IF v_row_lot_code IS NULL THEN
      RAISE EXCEPTION 'Linha % sem lote do cliente.', COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1);
    END IF;
    IF v_check_barcode <> '' AND v_check_barcode <> v_barcode THEN
      RAISE EXCEPTION 'Linha % com divergência entre código e conferência (% <> %).',
        COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1), v_barcode, v_check_barcode;
    END IF;

    INSERT INTO public.production_orders (
      order_code, system_order_number, order_number, customer_name,
      customer_legal_name, promob_project_name, status, created_by
    ) VALUES (
      v_row_order_code, v_row_order_code, v_row_order_code, v_row_customer,
      v_row_customer, v_row_project, 'planned', v_current_user
    )
    ON CONFLICT (order_code) DO UPDATE
    SET customer_name = CASE
          WHEN public.production_orders.customer_name = '' THEN EXCLUDED.customer_name
          ELSE public.production_orders.customer_name
        END,
        customer_legal_name = COALESCE(public.production_orders.customer_legal_name, EXCLUDED.customer_legal_name),
        promob_project_name = COALESCE(public.production_orders.promob_project_name, EXCLUDED.promob_project_name),
        updated_at = now()
    RETURNING id INTO v_order_id;

    v_first_order_id := COALESCE(v_first_order_id, v_order_id);

    SELECT l.id, l.pcp_import_batch_id,
           (SELECT pli.customer_name FROM public.production_lot_items pli WHERE pli.lot_id = l.id AND pli.customer_name IS NOT NULL LIMIT 1)
    INTO v_lot_id, v_existing_lot_batch_id, v_existing_lot_customer
    FROM public.production_lots l
    WHERE upper(l.lot_code) = upper(v_row_lot_code)
    FOR UPDATE;

    IF v_lot_id IS NULL THEN
      INSERT INTO public.production_lots (
        lot_code, order_id, production_order_id, order_number, customer_name,
        status, created_by, pcp_import_batch_id, actual_start
      ) VALUES (
        v_row_lot_code, v_order_id, v_order_id, v_row_order_code, v_row_customer,
        'planned', v_current_user, p_batch_id, NULL
      ) RETURNING id INTO v_lot_id;
    ELSE
      IF v_existing_lot_batch_id IS NOT NULL AND v_existing_lot_batch_id <> p_batch_id THEN
        RAISE EXCEPTION 'Lote do cliente % já pertence a outro lote geral PCP.', v_row_lot_code;
      END IF;
      IF v_existing_lot_customer IS NOT NULL AND lower(v_existing_lot_customer) <> lower(v_row_customer) THEN
        RAISE EXCEPTION 'Lote do cliente % está vinculado a % e não pode receber peças de %.',
          v_row_lot_code, v_existing_lot_customer, v_row_customer;
      END IF;
      UPDATE public.production_lots
      SET pcp_import_batch_id = p_batch_id,
          customer_name = COALESCE(NULLIF(customer_name, ''), v_row_customer),
          order_number = COALESCE(NULLIF(order_number, ''), v_row_order_code),
          updated_at = now()
      WHERE id = v_lot_id;
    END IF;

    INSERT INTO public.pcp_import_rows (
      batch_id, row_number, raw_cells, normalized_payload, barcode_raw,
      barcode_normalized, validation_status, validation_errors,
      mapping_version, row_hash
    ) VALUES (
      p_batch_id,
      COALESCE((v_row->>'row_number')::integer, v_inserted_rows + 1),
      COALESCE(v_row->'raw_cells', '[]'::jsonb),
      v_row,
      v_barcode,
      v_barcode,
      'valid',
      '[]'::jsonb,
      COALESCE(p_mapping_version, 1),
      md5(p_batch_id::text || ':' || v_row::text)
    )
    ON CONFLICT (batch_id, row_number) DO UPDATE
    SET raw_cells = EXCLUDED.raw_cells,
        normalized_payload = EXCLUDED.normalized_payload,
        barcode_raw = EXCLUDED.barcode_raw,
        barcode_normalized = EXCLUDED.barcode_normalized,
        validation_status = EXCLUDED.validation_status,
        validation_errors = EXCLUDED.validation_errors,
        mapping_version = EXCLUDED.mapping_version,
        row_hash = EXCLUDED.row_hash;

    v_route_steps := public.parse_pcp_route_tokens(v_route);
    IF v_manual_joinery THEN
      -- Peça especial: a baixa manual da Marcenaria é a primeira operação;
      -- depois ela entra no roteiro produtivo original do arquivo.
      v_route_steps := array_prepend('joinery', array_remove(v_route_steps, 'joinery'));
    END IF;

    FOR i IN 1..v_quantity LOOP
      v_suffix := CASE WHEN v_quantity > 1 THEN '-' || i::text ELSE '' END;
      v_piece_uid := v_barcode || v_suffix;

      SELECT pcp_import_batch_id INTO v_existing_batch_id
      FROM public.production_pieces
      WHERE piece_uid = v_piece_uid;

      IF FOUND THEN
        IF v_existing_batch_id = p_batch_id THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Código de barras % já pertence a outra importação PCP.', v_piece_uid;
      END IF;

      INSERT INTO public.production_lot_items (
        lot_id, item_code, product_code, product_name, current_step, status,
        lot_code, load_number, order_number, customer_name, environment_name,
        pieces_quantity
      ) VALUES (
        v_lot_id, v_piece_uid, v_piece_code, v_piece_name,
        COALESCE(v_route_steps[1], 'Importado'), 'pending',
        v_row_lot_code, NULL, v_row_order_code, v_row_customer, v_environment, 1
      ) RETURNING id INTO v_lot_item_id;

      -- A migration 028 mantém um gatilho de compatibilidade que cria uma
      -- production_piece ao inserir production_lot_items. Reaproveitamos essa
      -- mesma peça em vez de criar uma segunda, preservando as integrações
      -- legadas sem duplicar os totais do lote geral e dos lotes de cliente.
      v_piece_id := NULL;
      SELECT id INTO v_piece_id
      FROM public.production_pieces
      WHERE legacy_production_lot_item_id = v_lot_item_id
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE;

      IF v_piece_id IS NULL THEN
        INSERT INTO public.production_pieces (
          piece_uid, traceability_code, production_order_id, lot_id,
          module_name, environment, piece_name, material, color,
          thickness, width, height, length, requires_joinery, manual_joinery,
          manual_joinery_reason, current_stage, status,
          source_origin, legacy_production_lot_item_id, route_steps,
          pcp_import_batch_id, created_by
        ) VALUES (
          v_piece_uid, v_piece_uid, v_order_id, v_lot_id,
          v_module, v_environment, v_piece_name, v_material, v_color,
          v_thickness, v_width, v_height, v_height, v_manual_joinery, v_manual_joinery,
          NULLIF(TRIM(v_row->>'manualJoineryReason'), ''),
          COALESCE(v_route_steps[1], 'created'), 'planned',
          CASE
            WHEN lower(COALESCE(v_row->>'sourceFormat', p_mapping_profile, '')) LIKE '%csv%' THEN 'csv'
            ELSE 'xlsx'
          END,
          v_lot_item_id, v_route_steps, p_batch_id, v_current_user
        ) RETURNING id INTO v_piece_id;
      ELSE
        UPDATE public.production_pieces
        SET piece_uid = v_piece_uid,
            traceability_code = v_piece_uid,
            production_order_id = v_order_id,
            lot_id = v_lot_id,
            module_name = v_module,
            environment = v_environment,
            piece_name = v_piece_name,
            material = v_material,
            color = v_color,
            thickness = v_thickness,
            width = v_width,
            height = v_height,
            length = v_height,
            requires_joinery = v_manual_joinery,
            manual_joinery = v_manual_joinery,
            manual_joinery_reason = NULLIF(TRIM(v_row->>'manualJoineryReason'), ''),
            current_stage = COALESCE(v_route_steps[1], 'created'),
            status = 'planned',
            source_origin = CASE
              WHEN lower(COALESCE(v_row->>'sourceFormat', p_mapping_profile, '')) LIKE '%csv%' THEN 'csv'
              ELSE 'xlsx'
            END,
            route_steps = v_route_steps,
            pcp_import_batch_id = p_batch_id,
            created_by = v_current_user,
            updated_at = now()
        WHERE id = v_piece_id;

        -- O evento automático do gatilho antigo representa criação, não uma
        -- coleta física. Reclassificá-lo evita inflar o histórico operacional.
        UPDATE public.production_events
        SET traceability_code = v_piece_uid,
            production_order_id = v_order_id,
            event_type = 'note',
            from_stage = NULL,
            to_stage = COALESCE(v_route_steps[1], 'created'),
            notes = 'Peça criada pela importação PCP.',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'source', 'pcp_import',
              'pcp_import_batch_id', p_batch_id,
              'general_lot_code', v_row_general_lot_code,
              'client_lot_code', v_row_lot_code
            )
        WHERE piece_id = v_piece_id
          AND event_type = 'reading'
          AND operator_id IS NULL
          AND legacy_stage_reading_id IS NULL;
      END IF;

      INSERT INTO public.production_tags (
        lot_id, item_id, piece_id, tag_value, tag_type, active
      ) VALUES (
        v_lot_id, v_lot_item_id, v_piece_id, v_piece_uid,
        CASE WHEN v_manual_joinery THEN 'manual' ELSE 'barcode' END,
        true
      );

      v_inserted_pieces := v_inserted_pieces + 1;
    END LOOP;

    v_inserted_rows := v_inserted_rows + 1;
  END LOOP;

  SELECT count(*),
         count(DISTINCT p.production_order_id),
         count(DISTINCT p.lot_id),
         count(DISTINCT NULLIF(TRIM(l.customer_name), ''))
  INTO v_total_batch_pieces, v_order_count, v_lot_count, v_customer_count
  FROM public.production_pieces p
  LEFT JOIN public.production_lots l ON l.id = p.lot_id
  WHERE p.pcp_import_batch_id = p_batch_id;

  SELECT count(*) INTO v_total_batch_rows
  FROM public.pcp_import_rows
  WHERE batch_id = p_batch_id;

  SELECT production_order_id INTO v_first_order_id
  FROM public.production_pieces
  WHERE pcp_import_batch_id = p_batch_id
    AND production_order_id IS NOT NULL
  ORDER BY created_at, id
  LIMIT 1;

  UPDATE public.production_lots l
  SET planned_quantity = x.piece_count,
      pending_quantity = x.piece_count,
      progress_percent = 0,
      updated_at = now()
  FROM (
    SELECT lot_id, count(*)::numeric AS piece_count
    FROM public.production_pieces
    WHERE pcp_import_batch_id = p_batch_id
    GROUP BY lot_id
  ) x
  WHERE l.id = x.lot_id;

  UPDATE public.promob_import_batches
  SET status = CASE WHEN p_finalize THEN 'processed' ELSE 'parsed' END,
      imported_at = CASE WHEN p_finalize THEN now() ELSE imported_at END,
      validated_at = CASE WHEN p_finalize THEN now() ELSE validated_at END,
      customer_name = CASE WHEN v_order_count > 1 THEN 'Múltiplos clientes' ELSE p_customer END,
      promob_project_name = p_project_name,
      order_code = CASE WHEN v_order_count > 1 THEN 'Múltiplos pedidos' ELSE p_order_code END,
      generated_op_id = CASE WHEN v_order_count = 1 THEN v_first_order_id ELSE NULL END,
      total_parts = v_total_batch_pieces,
      client_lots_count = v_lot_count,
      customers_count = v_customer_count,
      source_format = p_mapping_profile,
      mapping_profile = p_mapping_profile,
      mapping_version = COALESCE(p_mapping_version, 1),
      total_lines = v_total_batch_rows,
      valid_lines = v_total_batch_rows,
      empty_lines = 0,
      duplicate_lines = 0,
      notes = format(
        'PCP consolidado: %s peças, %s pedido(s), %s lote(s).',
        v_total_batch_pieces, v_order_count, v_lot_count
      )
  WHERE id = p_batch_id;

  PERFORM public.refresh_pcp_batch_progress(p_batch_id);

  IF p_finalize THEN
    INSERT INTO public.pcp_import_logs (
    import_file_id, user_id, action, message, severity, metadata_json
    ) VALUES (
      p_batch_id,
      v_current_user,
      'PCP_IMPORT',
      format(
        'Importação PCP finalizada: %s peças, %s pedido(s), %s lote(s).',
        v_total_batch_pieces, v_order_count, v_lot_count
      ),
      'info',
      jsonb_build_object(
        'pieces_created', v_total_batch_pieces,
        'source_rows', v_total_batch_rows,
        'orders', v_order_count,
        'lots', v_lot_count,
        'pcp_import_batch_id', p_batch_id
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'pieces_created', v_total_batch_pieces,
    'pieces_created_in_chunk', v_inserted_pieces,
    'rows_imported', v_total_batch_rows,
    'rows_imported_in_chunk', v_inserted_rows,
    'orders', v_order_count,
    'lots', v_lot_count,
    'finalized', p_finalize
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.promob_import_batches
  SET status = 'error', error_message = SQLERRM
  WHERE id = p_batch_id;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.commit_pcp_import(uuid, text, text, text, text, text, integer, jsonb, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.commit_pcp_import(uuid, text, text, text, text, text, integer, jsonb, boolean) IS
  'Importa PCP/CSV por linha, preserva pedido/cliente/lote de cada peça e mantém o batch como agrupador consolidado.';

-- Garante que progresso do lote geral e alterações de peças também cheguem
-- imediatamente a outros operadores e monitores conectados.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['production_pieces', 'promob_import_batches']
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
