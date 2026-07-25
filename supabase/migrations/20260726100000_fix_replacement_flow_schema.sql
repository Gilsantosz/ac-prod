-- ============================================================
-- AC.Prod MES — Correção do Fluxo de Reposição (Schema Sync)
-- Migration 20260726100000
-- Aplica colunas faltantes nas tabelas de reposição e qualidade
-- e cria a tabela quality_nonconformities no banco remoto.
-- ============================================================

-- 1. Colunas faltantes em replacement_orders
ALTER TABLE public.replacement_orders
  ADD COLUMN IF NOT EXISTS replacement_code text,
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS environment_name text,
  ADD COLUMN IF NOT EXISTS operator_id uuid,
  ADD COLUMN IF NOT EXISTS operator_name text,
  ADD COLUMN IF NOT EXISTS requester_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS defect_id uuid,
  ADD COLUMN IF NOT EXISTS defect_name text,
  ADD COLUMN IF NOT EXISTS origin_cell_id uuid,
  ADD COLUMN IF NOT EXISTS origin_cell_name text,
  ADD COLUMN IF NOT EXISTS rejection_stage text,
  ADD COLUMN IF NOT EXISTS approver_id uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 2. Colunas faltantes em production_pieces
ALTER TABLE public.production_pieces
  ADD COLUMN IF NOT EXISTS is_rework boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lot_code text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS environment_name text,
  ADD COLUMN IF NOT EXISTS production_status text,
  ADD COLUMN IF NOT EXISTS lot_item_id uuid,
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS piece_code text,
  ADD COLUMN IF NOT EXISTS sequence_number integer,
  ADD COLUMN IF NOT EXISTS total_in_lot integer,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- 3. Tabela quality_nonconformities
CREATE TABLE IF NOT EXISTS public.quality_nonconformities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nc_code text UNIQUE,
  piece_id uuid,
  reading_id uuid,
  occurrence_id uuid,
  defect_id uuid,
  defect_code text,
  defect_name text,
  quantity integer DEFAULT 1,
  severity text DEFAULT 'medium',
  disposition text DEFAULT 'scrap',
  status text DEFAULT 'open',
  lot_id uuid,
  lot_code text,
  production_order_id uuid,
  order_number text,
  customer_name text,
  environment_name text,
  cell_id uuid,
  cell_name text,
  stage_name text,
  machine_id uuid,
  operator_id uuid,
  operator_name text,
  notes text,
  client_event_id uuid UNIQUE,
  related_replacement_id uuid,
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.quality_nonconformities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='quality_nonconformities' AND policyname='authenticated_access') THEN
    CREATE POLICY authenticated_access ON public.quality_nonconformities FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_qnc_piece_id ON public.quality_nonconformities(piece_id);
CREATE INDEX IF NOT EXISTS idx_qnc_status ON public.quality_nonconformities(status);
CREATE INDEX IF NOT EXISTS idx_qnc_client_event ON public.quality_nonconformities(client_event_id);

-- 4. RPCs de ciclo de reposição
CREATE OR REPLACE FUNCTION public.request_piece_replacement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_original_piece_id uuid;
  v_piece record;
  v_reason text;
  v_priority text;
  v_notes text;
  v_replacement_code text;
  v_order_id uuid;
  v_existing_id uuid;
BEGIN
  v_original_piece_id := (p_payload->>'original_piece_id')::uuid;
  v_reason := COALESCE(p_payload->>'reason', 'Solicitacao de reposicao');
  v_priority := COALESCE(p_payload->>'priority', 'high');
  v_notes := p_payload->>'notes';
  IF v_original_piece_id IS NULL THEN RAISE EXCEPTION 'original_piece_id e obrigatorio'; END IF;
  SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_original_piece_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peca nao encontrada: %', v_original_piece_id; END IF;
  SELECT id INTO v_existing_id FROM public.replacement_orders
  WHERE original_piece_id = v_original_piece_id AND status NOT IN ('completed', 'cancelled') LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT replacement_code INTO v_replacement_code FROM public.replacement_orders WHERE id = v_existing_id;
    RETURN jsonb_build_object('success',true,'idempotent',true,'replacement_order_id',v_existing_id,'replacement_code',v_replacement_code);
  END IF;
  v_replacement_code := 'REP-' || to_char(now(),'YYYYMMDD') || '-' || lpad(floor(random()*8999+1000)::text,4,'0');
  INSERT INTO public.replacement_orders (replacement_code,original_piece_id,reason,priority,lot_id,production_order_id,status,created_by,lot_code,order_number,customer_name,environment_name,requester_id,notes)
  VALUES (v_replacement_code,v_original_piece_id,v_reason,v_priority,v_piece.lot_id,v_piece.production_order_id,'requested',v_user_id,v_piece.lot_code,v_piece.order_number,v_piece.customer_name,v_piece.environment_name,v_user_id,v_notes) RETURNING id INTO v_order_id;
  RETURN jsonb_build_object('success',true,'replacement_order_id',v_order_id,'replacement_code',v_replacement_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_piece_replacement(jsonb) TO authenticated;

-- register_quality_rejection — adaptado ao schema real
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
  v_severity text;
  v_cell_name text;
  v_machine_id uuid;
  v_operator_id uuid;
  v_operator_name text;
  v_client_event_id uuid;
  v_reading_id uuid;
  v_occurrence_id uuid;
  v_nc_id uuid;
  v_nc_code text;
  v_replacement_order_id uuid := NULL;
  v_existing_repl_id uuid := NULL;
BEGIN
  v_traceability_code := p_payload->>'traceability_code';
  v_reason := COALESCE(p_payload->>'reason','Defeito detectado na coleta');
  v_notes := p_payload->>'notes';
  v_disposition := COALESCE(p_payload->>'disposition','scrap');
  v_cell_name := p_payload->>'cell_name';
  v_operator_name := p_payload->>'operator_name';
  IF p_payload->>'defect_id' IS NOT NULL AND p_payload->>'defect_id' != '' THEN v_defect_id := (p_payload->>'defect_id')::uuid; END IF;
  IF p_payload->>'machine_id' IS NOT NULL AND p_payload->>'machine_id' != '' THEN v_machine_id := (p_payload->>'machine_id')::uuid; END IF;
  IF p_payload->>'operator_id' IS NOT NULL AND p_payload->>'operator_id' != '' THEN v_operator_id := (p_payload->>'operator_id')::uuid; END IF;
  IF p_payload->>'client_event_id' IS NOT NULL AND p_payload->>'client_event_id' != '' THEN
    v_client_event_id := (p_payload->>'client_event_id')::uuid;
    SELECT id INTO v_nc_id FROM public.quality_nonconformities WHERE client_event_id = v_client_event_id;
    IF v_nc_id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'idempotent',true,'nonconformity_id',v_nc_id); END IF;
  END IF;
  IF p_payload->>'piece_id' IS NOT NULL AND p_payload->>'piece_id' != '' THEN
    v_piece_id := (p_payload->>'piece_id')::uuid;
    SELECT * INTO v_piece FROM public.production_pieces WHERE id = v_piece_id;
  ELSE
    SELECT * INTO v_piece FROM public.production_pieces WHERE piece_uid = v_traceability_code LIMIT 1;
    IF v_piece IS NOT NULL THEN v_piece_id := v_piece.id; END IF;
  END IF;
  v_severity := COALESCE(p_payload->>'severity','medium');
  INSERT INTO public.production_stage_readings (tag_value,step_name,cell_name,machine_id,operator_id,operator,status,notes,lot_id,production_order_id,piece_id,piece_code,client_event_id)
  VALUES (COALESCE(v_traceability_code,v_piece.piece_uid),COALESCE(v_piece.current_stage,'Coleta'),v_cell_name,v_machine_id,v_operator_id,v_operator_name,'rejected',CONCAT(v_reason,' - ',v_notes),v_piece.lot_id,v_piece.production_order_id,v_piece_id,v_piece.piece_code,v_client_event_id) RETURNING id INTO v_reading_id;
  INSERT INTO public.occurrences (date,shift,cell,reason,downtime,operator,notes,created_by,lot_id,production_order_id,severity,status,stage_reading_id)
  VALUES (CURRENT_DATE,COALESCE(p_payload->>'shift','1'),COALESCE(v_cell_name,'Geral'),v_reason,0,v_operator_name,v_notes,v_user_id,v_piece.lot_id,v_piece.production_order_id,v_severity,'open',v_reading_id) RETURNING id INTO v_occurrence_id;
  IF v_piece_id IS NOT NULL THEN
    UPDATE public.production_pieces SET status=CASE WHEN v_disposition='hold' THEN 'blocked' ELSE 'rejected' END,updated_at=now() WHERE id=v_piece_id;
  END IF;
  v_nc_code := 'NC-'||to_char(now(),'YYYY')||'-'||lpad(floor(random()*89999+10000)::text,5,'0');
  INSERT INTO public.quality_nonconformities (nc_code,piece_id,reading_id,occurrence_id,defect_id,quantity,severity,disposition,status,lot_id,lot_code,production_order_id,cell_name,stage_name,machine_id,operator_id,operator_name,notes,client_event_id,created_by)
  VALUES (v_nc_code,v_piece_id,v_reading_id,v_occurrence_id,v_defect_id,1,v_severity,v_disposition,'open',v_piece.lot_id,v_piece.lot_code,v_piece.production_order_id,v_cell_name,v_piece.current_stage,v_machine_id,v_operator_id,v_operator_name,v_notes,v_client_event_id,v_user_id) RETURNING id INTO v_nc_id;
  IF v_piece_id IS NOT NULL THEN
    SELECT id INTO v_existing_repl_id FROM public.replacement_orders WHERE original_piece_id=v_piece_id AND status NOT IN ('completed','cancelled');
    IF v_existing_repl_id IS NULL THEN
      INSERT INTO public.replacement_orders (replacement_code,original_piece_id,reason,priority,lot_id,production_order_id,status,created_by,defect_id,origin_cell_name,rejection_stage,lot_code,customer_name,requester_id,notes)
      VALUES ('REP-'||to_char(now(),'YYYYMMDD')||'-'||lpad(floor(random()*8999+1000)::text,4,'0'),v_piece_id,v_reason,CASE WHEN v_severity='critical' THEN 'critical' WHEN v_severity='high' THEN 'high' ELSE 'normal' END,v_piece.lot_id,v_piece.production_order_id,'requested',v_user_id,v_defect_id,v_cell_name,v_piece.current_stage,v_piece.lot_code,v_piece.customer_name,v_user_id,v_notes) RETURNING id INTO v_replacement_order_id;
    ELSE
      v_replacement_order_id := v_existing_repl_id;
    END IF;
    UPDATE public.quality_nonconformities SET related_replacement_id=v_replacement_order_id WHERE id=v_nc_id;
  END IF;
  RETURN jsonb_build_object('success',true,'nonconformity_id',v_nc_id,'nc_code',v_nc_code,'occurrence_id',v_occurrence_id,'reading_id',v_reading_id,'replacement_order_id',v_replacement_order_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_quality_rejection(jsonb) TO authenticated;
