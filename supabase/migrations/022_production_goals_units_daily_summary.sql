-- AC.Prod - metas e indicadores por unidade operacional.
-- Aditiva: nao apaga dados existentes e preserva campos legados.

ALTER TABLE public.lot_items
  ADD COLUMN IF NOT EXISTS sheet_count numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edge_meters numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covers_quantity numeric NOT NULL DEFAULT 0;

ALTER TABLE public.production_lot_items
  ADD COLUMN IF NOT EXISTS sheet_count numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edge_meters numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covers_quantity numeric NOT NULL DEFAULT 0;

ALTER TABLE public.production_order_items
  ADD COLUMN IF NOT EXISTS sheet_count numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edge_meters numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covers_quantity numeric NOT NULL DEFAULT 0;

ALTER TABLE public.production_entries
  ADD COLUMN IF NOT EXISTS metric_unit text,
  ADD COLUMN IF NOT EXISTS metric_unit_label text,
  ADD COLUMN IF NOT EXISTS metric_name text,
  ADD COLUMN IF NOT EXISTS planned_capacity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS planned_target numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS realized_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difference_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS efficiency_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sheet_count numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edge_meters numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS covers_quantity numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_entries_metric_unit_check'
  ) THEN
    ALTER TABLE public.production_entries
      ADD CONSTRAINT production_entries_metric_unit_check
      CHECK (metric_unit IS NULL OR metric_unit IN ('sheets','meters','pieces','covers'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.production_daily_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  shift text NOT NULL,
  cell_name text NOT NULL,
  area_name text,
  metric_unit text NOT NULL CHECK (metric_unit IN ('sheets','meters','pieces','covers')),
  metric_unit_label text NOT NULL,
  metric_name text NOT NULL,
  capacity numeric NOT NULL DEFAULT 0,
  target numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, shift, cell_name, metric_unit)
);

CREATE INDEX IF NOT EXISTS idx_daily_goals_units_date
  ON public.production_daily_goals(date, shift, cell_name, metric_unit);

ALTER TABLE public.production_daily_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_daily_goals_select ON public.production_daily_goals;
CREATE POLICY production_daily_goals_select ON public.production_daily_goals
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS production_daily_goals_write ON public.production_daily_goals;
CREATE POLICY production_daily_goals_write ON public.production_daily_goals
  FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

DROP TRIGGER IF EXISTS trg_production_daily_goals_updated_at ON public.production_daily_goals;
CREATE TRIGGER trg_production_daily_goals_updated_at
  BEFORE UPDATE ON public.production_daily_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.production_metric_unit_label(p_unit text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_unit
    WHEN 'sheets' THEN 'chapas'
    WHEN 'meters' THEN 'metros'
    WHEN 'covers' THEN 'capas'
    ELSE 'peças'
  END
$$;

CREATE OR REPLACE FUNCTION public.production_metric_name_for_unit(p_unit text, p_cell text DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_unit
    WHEN 'sheets' THEN 'Chapas cortadas'
    WHEN 'meters' THEN 'Metros de bordo'
    WHEN 'covers' THEN 'Capas expedidas'
    ELSE CASE
      WHEN COALESCE(p_cell, '') ILIKE '%marcen%' THEN 'Peças de marcenaria'
      WHEN COALESCE(p_cell, '') ILIKE '%embalag%' THEN 'Peças embaladas'
      WHEN COALESCE(p_cell, '') ILIKE '%expedi%' THEN 'Peças expedidas'
      WHEN COALESCE(p_cell, '') ILIKE '%fura%' OR COALESCE(p_cell, '') ILIKE '%usin%' THEN 'Peças usinadas'
      ELSE 'Peças produzidas'
    END
  END
$$;

CREATE OR REPLACE FUNCTION public.production_metric_unit_for_cell(
  p_cell text DEFAULT NULL,
  p_step text DEFAULT NULL,
  p_operation text DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_text text := lower(concat_ws(' ', p_cell, p_step, p_operation));
BEGIN
  IF v_text ILIKE '%corte%' OR v_text ILIKE '%seccion%' THEN
    RETURN 'sheets';
  END IF;
  IF v_text ILIKE '%bord%' OR v_text ILIKE '%coladeira%' THEN
    RETURN 'meters';
  END IF;
  IF v_text ILIKE '%usin%' OR v_text ILIKE '%fura%' OR v_text ILIKE '%cnc%' THEN
    RETURN 'pieces';
  END IF;
  IF v_text ILIKE '%marcen%' OR v_text ILIKE '%embalag%' OR v_text ILIKE '%expedi%' THEN
    RETURN 'pieces';
  END IF;
  RETURN 'pieces';
END;
$$;

CREATE OR REPLACE FUNCTION public.production_dimension_meters(p_value numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN COALESCE(p_value, 0) > 30 THEN p_value / 1000 ELSE COALESCE(p_value, 0) END
$$;

CREATE OR REPLACE FUNCTION public.production_edge_flag(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(lower(trim(p_value)), ''), '') NOT IN ('', '0', 'false', 'nao', 'não', 'sem fita', '-', 'n')
$$;

UPDATE public.lot_items
SET
  pieces_quantity = CASE WHEN COALESCE(pieces_quantity, 0) = 0 THEN GREATEST(COALESCE(quantity, 1), 1) ELSE pieces_quantity END,
  edge_meters = CASE
    WHEN COALESCE(edge_meters, 0) > 0 THEN edge_meters
    ELSE ROUND((
      CASE WHEN public.production_edge_flag(edge_front) THEN public.production_dimension_meters(width) ELSE 0 END +
      CASE WHEN public.production_edge_flag(edge_back) THEN public.production_dimension_meters(width) ELSE 0 END +
      CASE WHEN public.production_edge_flag(edge_left) THEN public.production_dimension_meters(height) ELSE 0 END +
      CASE WHEN public.production_edge_flag(edge_right) THEN public.production_dimension_meters(height) ELSE 0 END
    ) * GREATEST(COALESCE(quantity, 1), 1), 3)
  END;

UPDATE public.production_lot_items pli
SET
  sheet_count = COALESCE(NULLIF(pli.sheet_count, 0), li.sheet_count, 0),
  edge_meters = COALESCE(NULLIF(pli.edge_meters, 0), li.edge_meters, 0),
  pieces_quantity = COALESCE(NULLIF(pli.pieces_quantity, 0), li.pieces_quantity, 1),
  covers_quantity = COALESCE(NULLIF(pli.covers_quantity, 0), li.covers_quantity, 0)
FROM public.lot_items li
WHERE li.id = pli.source_lot_item_id;

CREATE OR REPLACE FUNCTION public.enrich_production_entry_metric()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_id uuid;
  v_item_sheet numeric := 0;
  v_item_edge numeric := 0;
  v_item_pieces numeric := 0;
  v_item_covers numeric := 0;
  v_inferred_unit text;
  v_unit text;
  v_realized numeric;
  v_base numeric;
BEGIN
  SELECT pli.id, pli.sheet_count, pli.edge_meters, pli.pieces_quantity, pli.covers_quantity
  INTO v_item_id, v_item_sheet, v_item_edge, v_item_pieces, v_item_covers
  FROM public.production_stage_readings psr
  JOIN public.production_lot_items pli ON pli.id = psr.item_id
  WHERE psr.client_event_id IS NOT NULL
    AND psr.client_event_id = NEW.client_event_id
  ORDER BY psr.created_at DESC
  LIMIT 1;

  IF v_item_id IS NULL AND NEW.order_item_id IS NOT NULL THEN
    SELECT id, sheet_count, edge_meters, pieces_quantity, covers_quantity
    INTO v_item_id, v_item_sheet, v_item_edge, v_item_pieces, v_item_covers
    FROM public.production_order_items
    WHERE id = NEW.order_item_id
    LIMIT 1;
  END IF;

  v_inferred_unit := public.production_metric_unit_for_cell(
    NEW.cell,
    COALESCE(NEW.operation_name, NEW.process_step),
    NEW.operation_name
  );

  v_unit := CASE
    WHEN NEW.metric_unit IN ('sheets','meters','covers') THEN NEW.metric_unit
    WHEN NEW.metric_unit = 'pieces' AND v_inferred_unit = 'pieces' THEN 'pieces'
    ELSE v_inferred_unit
  END;

  NEW.metric_unit := v_unit;
  NEW.metric_unit_label := public.production_metric_unit_label(v_unit);
  NEW.metric_name := COALESCE(NULLIF(NEW.metric_name, ''), public.production_metric_name_for_unit(v_unit, NEW.cell));
  NEW.planned_target := COALESCE(NULLIF(NEW.planned_target, 0), NEW.target, 0);
  NEW.planned_capacity := COALESCE(NEW.planned_capacity, 0);

  v_realized := COALESCE(NULLIF(NEW.realized_quantity, 0), 0);

  IF v_realized = 0 THEN
    IF v_unit = 'meters' THEN
      v_realized := COALESCE(NULLIF(NEW.edge_meters, 0), NULLIF(v_item_edge, 0), GREATEST(COALESCE(NEW.produced, 0), 1));
      NEW.edge_meters := COALESCE(NULLIF(NEW.edge_meters, 0), NULLIF(v_item_edge, 0), v_realized);
    ELSIF v_unit = 'sheets' THEN
      v_realized := COALESCE(NULLIF(NEW.sheet_count, 0), NULLIF(v_item_sheet, 0), CASE WHEN NEW.client_event_id IS NULL THEN COALESCE(NEW.produced, 0) ELSE 0 END);
      NEW.sheet_count := COALESCE(NULLIF(NEW.sheet_count, 0), NULLIF(v_item_sheet, 0), v_realized);
    ELSIF v_unit = 'covers' THEN
      v_realized := COALESCE(NULLIF(NEW.covers_quantity, 0), NULLIF(v_item_covers, 0), COALESCE(NEW.produced, 0));
      NEW.covers_quantity := COALESCE(NULLIF(NEW.covers_quantity, 0), NULLIF(v_item_covers, 0), v_realized);
    ELSE
      v_realized := COALESCE(NULLIF(NEW.pieces_quantity, 0), NULLIF(v_item_pieces, 0), COALESCE(NEW.produced, 0));
      NEW.pieces_quantity := COALESCE(NULLIF(NEW.pieces_quantity, 0), NULLIF(v_item_pieces, 0), v_realized);
    END IF;
  END IF;

  NEW.realized_quantity := COALESCE(v_realized, 0);
  v_base := COALESCE(NULLIF(NEW.planned_target, 0), NULLIF(NEW.planned_capacity, 0), 0);
  NEW.difference_quantity := NEW.realized_quantity - v_base;
  NEW.efficiency_percent := CASE WHEN COALESCE(NEW.planned_target, 0) > 0
    THEN ROUND((NEW.realized_quantity / NEW.planned_target) * 100, 1)
    ELSE 0
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrich_production_entry_metric ON public.production_entries;
CREATE TRIGGER trg_enrich_production_entry_metric
  BEFORE INSERT OR UPDATE ON public.production_entries
  FOR EACH ROW EXECUTE FUNCTION public.enrich_production_entry_metric();

UPDATE public.production_entries
SET metric_unit = NULL
WHERE metric_unit IS NULL OR metric_unit = '';

UPDATE public.production_entries
SET updated_at = updated_at;

CREATE OR REPLACE VIEW public.production_daily_cell_summary AS
WITH entry_summary AS (
  SELECT
    e.date,
    e.shift,
    e.cell AS cell_name,
    e.cell AS area_name,
    COALESCE(e.metric_unit, public.production_metric_unit_for_cell(e.cell, e.process_step, e.operation_name)) AS metric_unit,
    COALESCE(e.metric_unit_label, public.production_metric_unit_label(COALESCE(e.metric_unit, public.production_metric_unit_for_cell(e.cell, e.process_step, e.operation_name)))) AS metric_unit_label,
    COALESCE(e.metric_name, public.production_metric_name_for_unit(COALESCE(e.metric_unit, public.production_metric_unit_for_cell(e.cell, e.process_step, e.operation_name)), e.cell)) AS metric_name,
    SUM(COALESCE(e.planned_capacity, 0)) AS entry_capacity,
    SUM(COALESCE(NULLIF(e.planned_target, 0), e.target, 0)) AS entry_target,
    SUM(COALESCE(NULLIF(e.realized_quantity, 0), e.produced, 0)) AS realized_quantity,
    SUM(COALESCE(e.scrap, 0)) AS scrap_quantity,
    SUM(COALESCE(e.downtime, 0)) AS downtime_minutes,
    COUNT(*) AS entries_count
  FROM public.production_entries e
  WHERE COALESCE(e.approval_status, 'valid') = 'valid'
  GROUP BY 1, 2, 3, 4, 5, 6, 7
),
goal_summary AS (
  SELECT
    date,
    shift,
    cell_name,
    COALESCE(area_name, cell_name) AS area_name,
    metric_unit,
    metric_unit_label,
    metric_name,
    SUM(capacity) AS goal_capacity,
    SUM(target) AS goal_target
  FROM public.production_daily_goals
  GROUP BY date, shift, cell_name, COALESCE(area_name, cell_name), metric_unit, metric_unit_label, metric_name
)
SELECT
  COALESCE(g.date, e.date) AS date,
  COALESCE(g.shift, e.shift) AS shift,
  COALESCE(g.cell_name, e.cell_name) AS cell_name,
  COALESCE(g.area_name, e.area_name, g.cell_name, e.cell_name) AS area_name,
  COALESCE(g.metric_unit, e.metric_unit) AS metric_unit,
  COALESCE(g.metric_unit_label, e.metric_unit_label) AS metric_unit_label,
  COALESCE(g.metric_name, e.metric_name) AS metric_name,
  COALESCE(g.goal_capacity, e.entry_capacity, 0) AS capacity,
  COALESCE(g.goal_target, e.entry_target, 0) AS target,
  COALESCE(e.realized_quantity, 0) AS realized_quantity,
  COALESCE(e.realized_quantity, 0) - COALESCE(g.goal_capacity, e.entry_capacity, 0) AS difference_capacity,
  COALESCE(e.realized_quantity, 0) - COALESCE(g.goal_target, e.entry_target, 0) AS difference_target,
  CASE WHEN COALESCE(g.goal_capacity, e.entry_capacity, 0) > 0
    THEN ROUND((COALESCE(e.realized_quantity, 0) / COALESCE(g.goal_capacity, e.entry_capacity, 0)) * 100, 1)
    ELSE 0
  END AS efficiency_capacity,
  CASE WHEN COALESCE(g.goal_target, e.entry_target, 0) > 0
    THEN ROUND((COALESCE(e.realized_quantity, 0) / COALESCE(g.goal_target, e.entry_target, 0)) * 100, 1)
    ELSE 0
  END AS efficiency_target,
  COALESCE(e.scrap_quantity, 0) AS scrap_quantity,
  COALESCE(e.downtime_minutes, 0) AS downtime_minutes,
  COALESCE(e.entries_count, 0) AS entries_count
FROM goal_summary g
FULL OUTER JOIN entry_summary e
  ON e.date = g.date
 AND e.shift = g.shift
 AND e.cell_name = g.cell_name
 AND e.metric_unit = g.metric_unit;

CREATE OR REPLACE VIEW public.production_daily_unit_summary AS
SELECT
  date,
  shift,
  metric_unit,
  metric_unit_label,
  SUM(capacity) AS capacity,
  SUM(target) AS target,
  SUM(realized_quantity) AS realized_quantity,
  SUM(realized_quantity) - SUM(capacity) AS difference_capacity,
  SUM(realized_quantity) - SUM(target) AS difference_target,
  CASE WHEN SUM(capacity) > 0 THEN ROUND((SUM(realized_quantity) / SUM(capacity)) * 100, 1) ELSE 0 END AS efficiency_capacity,
  CASE WHEN SUM(target) > 0 THEN ROUND((SUM(realized_quantity) / SUM(target)) * 100, 1) ELSE 0 END AS efficiency_target,
  SUM(scrap_quantity) AS scrap_quantity,
  SUM(downtime_minutes) AS downtime_minutes,
  SUM(entries_count) AS entries_count
FROM public.production_daily_cell_summary
GROUP BY date, shift, metric_unit, metric_unit_label;

GRANT SELECT ON public.production_daily_cell_summary TO authenticated;
GRANT SELECT ON public.production_daily_unit_summary TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_daily_goals TO authenticated;
