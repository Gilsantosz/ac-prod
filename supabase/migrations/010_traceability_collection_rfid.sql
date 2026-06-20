-- ============================================================
-- AC.Prod - Coleta por Codigo / RFID
-- Camada generica de identificacao produtiva, leituras e leitores.
-- Migracao aditiva: preserva toda a rastreabilidade existente.
-- ============================================================

ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS product_code text,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS planned_quantity integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_status text;

CREATE TABLE IF NOT EXISTS production_lot_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  source_lot_item_id  uuid REFERENCES lot_items(id) ON DELETE SET NULL,
  item_code           text NOT NULL,
  product_code        text,
  product_name        text NOT NULL DEFAULT '',
  current_step        text,
  current_cell        text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','completed','rejected','blocked','rework','scrap','cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lot_id, item_code)
);

CREATE TABLE IF NOT EXISTS production_routes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  step_order  integer NOT NULL,
  step_name   text NOT NULL,
  cell_name   text,
  required    boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lot_id, step_order),
  UNIQUE (lot_id, step_name)
);

CREATE TABLE IF NOT EXISTS production_tags (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  item_id        uuid REFERENCES production_lot_items(id) ON DELETE CASCADE,
  tag_value      text NOT NULL UNIQUE,
  tag_type       text NOT NULL DEFAULT 'barcode'
                 CHECK (tag_type IN ('barcode','qrcode','datamatrix','rfid_epc','rfid_tid','manual')),
  tag_format     text NOT NULL DEFAULT 'custom'
                 CHECK (tag_format IN ('code128','code39','ean13','qrcode','datamatrix','epc96','custom')),
  epc_code       text,
  tid_code       text,
  barcode_value  text,
  qr_value       text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reader_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  reader_type      text NOT NULL
                   CHECK (reader_type IN ('barcode_keyboard','barcode_usb','qrcode_camera','rfid_fixed','rfid_handheld','api_gateway')),
  connection_type  text NOT NULL DEFAULT 'keyboard'
                   CHECK (connection_type IN ('keyboard','usb','serial','network','mqtt','http_api','websocket')),
  location         text,
  cell_name        text,
  station_name     text,
  active           boolean NOT NULL DEFAULT true,
  config_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_stage_readings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         uuid NOT NULL REFERENCES production_lots(id) ON DELETE RESTRICT,
  item_id        uuid REFERENCES production_lot_items(id) ON DELETE RESTRICT,
  tag_id         uuid REFERENCES production_tags(id) ON DELETE RESTRICT,
  tag_value      text NOT NULL,
  reader_type    text NOT NULL DEFAULT 'keyboard_barcode'
                 CHECK (reader_type IN ('keyboard_barcode','camera_qrcode','camera_barcode','manual','rfid_fixed','rfid_handheld','api')),
  reader_id      uuid REFERENCES reader_devices(id) ON DELETE SET NULL,
  reader_name    text,
  station_id     text,
  station_name   text,
  step_name      text,
  cell_name      text,
  operator       text,
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  shift          text,
  date           date NOT NULL DEFAULT current_date,
  hour           text NOT NULL DEFAULT to_char(now(), 'HH24:MI'),
  status         text NOT NULL
                 CHECK (status IN ('approved','rejected','blocked','duplicated','pending_review')),
  event_type     text NOT NULL
                 CHECK (event_type IN ('approved_scan','rejected_scan','wrong_step','duplicated_scan','manual_adjustment','rfid_bulk_read')),
  quantity       integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  occurrence_id  uuid REFERENCES occurrences(id) ON DELETE SET NULL,
  notes          text,
  rssi           numeric,
  antenna_port   integer,
  read_count     integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS traceability_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prod_lot_items_lot ON production_lot_items(lot_id);
CREATE INDEX IF NOT EXISTS idx_prod_lot_items_step ON production_lot_items(current_step, current_cell, status);
CREATE INDEX IF NOT EXISTS idx_prod_routes_lot_order ON production_routes(lot_id, step_order);
CREATE INDEX IF NOT EXISTS idx_prod_tags_lookup ON production_tags(tag_value) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_prod_tags_epc ON production_tags(epc_code) WHERE epc_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stage_readings_created ON production_stage_readings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_readings_lot ON production_stage_readings(lot_id, item_id, step_name);
CREATE INDEX IF NOT EXISTS idx_stage_readings_filters ON production_stage_readings(date, shift, cell_name, status, reader_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approved_item_step
  ON production_stage_readings(item_id, step_name)
  WHERE status = 'approved' AND item_id IS NOT NULL;

-- Atualizacao automatica dos registros editaveis.
DROP TRIGGER IF EXISTS trg_production_lot_items_updated_at ON production_lot_items;
CREATE TRIGGER trg_production_lot_items_updated_at
  BEFORE UPDATE ON production_lot_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_production_tags_updated_at ON production_tags;
CREATE TRIGGER trg_production_tags_updated_at
  BEFORE UPDATE ON production_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Migra metadados dos lotes existentes.
UPDATE production_lots pl
SET order_number = COALESCE(pl.order_number, po.order_code),
    customer_name = COALESCE(pl.customer_name, po.customer_name),
    planned_quantity = CASE
      WHEN COALESCE(pl.planned_quantity, 0) > 0 THEN pl.planned_quantity
      ELSE COALESCE((SELECT SUM(li.quantity) FROM lot_items li WHERE li.lot_id = pl.id), 0)
    END,
    current_status = COALESCE(pl.current_status, pl.status)
FROM production_orders po
WHERE po.id = pl.order_id;

INSERT INTO production_lot_items (
  lot_id, source_lot_item_id, item_code, product_code, product_name,
  current_step, current_cell, status, created_at, updated_at
)
SELECT
  li.lot_id,
  li.id,
  COALESCE(NULLIF(li.piece_code, ''), li.id::text),
  li.piece_code,
  COALESCE(NULLIF(li.piece_name, ''), 'Peca sem descricao'),
  COALESCE(pl.current_stage, 'imported'),
  NULL,
  CASE
    WHEN li.status IN ('completed','packed','shipped') THEN 'completed'
    WHEN li.status IN ('missing','scrap','blocked') THEN 'blocked'
    WHEN li.status = 'rework' THEN 'rework'
    ELSE 'pending'
  END,
  li.created_at,
  li.updated_at
FROM lot_items li
JOIN production_lots pl ON pl.id = li.lot_id
ON CONFLICT (lot_id, item_code) DO NOTHING;

-- Rota produtiva inicial baseada nas etapas existentes; os nomes sao codigos estaveis.
INSERT INTO production_routes (lot_id, step_order, step_name, cell_name, required)
SELECT
  pl.id,
  rs.sequence,
  rs.code,
  c.name,
  CASE rs.code
    WHEN 'edge' THEN EXISTS (SELECT 1 FROM lot_items li WHERE li.lot_id = pl.id AND li.requires_edge)
    WHEN 'cnc' THEN EXISTS (SELECT 1 FROM lot_items li WHERE li.lot_id = pl.id AND li.requires_cnc)
    WHEN 'joinery' THEN EXISTS (SELECT 1 FROM lot_items li WHERE li.lot_id = pl.id AND li.requires_joinery)
    ELSE true
  END
FROM production_lots pl
CROSS JOIN routing_steps rs
LEFT JOIN cells c ON c.id = rs.cell_id
WHERE rs.active IS DISTINCT FROM false
ON CONFLICT (lot_id, step_order) DO NOTHING;

-- Identificacoes existentes viram tags produtivas genericas.
INSERT INTO production_tags (
  lot_id, item_id, tag_value, tag_type, tag_format, barcode_value, qr_value, active
)
SELECT DISTINCT ON (UPPER(TRIM(COALESCE(pi.qr_code, pi.serial_code))))
  pi.lot_id,
  pli.id,
  UPPER(TRIM(COALESCE(pi.qr_code, pi.serial_code))),
  CASE WHEN pi.qr_code IS NOT NULL THEN 'qrcode' ELSE 'barcode' END,
  CASE WHEN pi.qr_code IS NOT NULL THEN 'qrcode' ELSE 'code128' END,
  pi.serial_code,
  pi.qr_code,
  true
FROM piece_instances pi
JOIN production_lot_items pli ON pli.source_lot_item_id = pi.lot_item_id
WHERE COALESCE(pi.qr_code, pi.serial_code) IS NOT NULL
ON CONFLICT (tag_value) DO NOTHING;

INSERT INTO production_tags (lot_id, item_id, tag_value, tag_type, tag_format, barcode_value, active)
SELECT pli.lot_id, pli.id, UPPER(TRIM(pli.item_code)), 'barcode', 'custom', pli.item_code, true
FROM production_lot_items pli
WHERE NULLIF(TRIM(pli.item_code), '') IS NOT NULL
ON CONFLICT (tag_value) DO NOTHING;

-- RLS: leitura operacional ampla; escrita controlada; historicos nunca sao apagados.
ALTER TABLE production_lot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stage_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reader_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE traceability_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prod_lot_items_select" ON production_lot_items;
CREATE POLICY "prod_lot_items_select" ON production_lot_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "prod_lot_items_write" ON production_lot_items;
CREATE POLICY "prod_lot_items_write" ON production_lot_items FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager','operator'))
  WITH CHECK (get_my_role() IN ('admin','manager','operator'));

DROP POLICY IF EXISTS "prod_routes_select" ON production_routes;
CREATE POLICY "prod_routes_select" ON production_routes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "prod_routes_manage" ON production_routes;
CREATE POLICY "prod_routes_manage" ON production_routes FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

DROP POLICY IF EXISTS "prod_tags_select" ON production_tags;
CREATE POLICY "prod_tags_select" ON production_tags FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "prod_tags_write" ON production_tags;
CREATE POLICY "prod_tags_write" ON production_tags FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager','operator'))
  WITH CHECK (get_my_role() IN ('admin','manager','operator'));

DROP POLICY IF EXISTS "stage_readings_select" ON production_stage_readings;
CREATE POLICY "stage_readings_select" ON production_stage_readings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "stage_readings_insert" ON production_stage_readings;
CREATE POLICY "stage_readings_insert" ON production_stage_readings FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin','manager','operator'));

DROP POLICY IF EXISTS "reader_devices_select" ON reader_devices;
CREATE POLICY "reader_devices_select" ON reader_devices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "reader_devices_manage" ON reader_devices;
CREATE POLICY "reader_devices_manage" ON reader_devices FOR ALL TO authenticated
  USING (get_my_role() IN ('admin','manager'))
  WITH CHECK (get_my_role() IN ('admin','manager'));

DROP POLICY IF EXISTS "trace_logs_select" ON traceability_logs;
CREATE POLICY "trace_logs_select" ON traceability_logs FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS "trace_logs_insert" ON traceability_logs;
CREATE POLICY "trace_logs_insert" ON traceability_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Processamento atomico da leitura. Todas as validacoes e atualizacoes ocorrem na mesma transacao.
CREATE OR REPLACE FUNCTION process_production_reading(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag_value text := UPPER(TRIM(COALESCE(p_payload->>'rawValue', '')));
  v_reader_type text := COALESCE(NULLIF(p_payload->>'readerType', ''), 'keyboard_barcode');
  v_cell text := NULLIF(TRIM(COALESCE(p_payload->>'cellName', '')), '');
  v_station text := NULLIF(TRIM(COALESCE(p_payload->>'stationName', '')), '');
  v_step_input text := NULLIF(TRIM(COALESCE(p_payload->>'stepName', '')), '');
  v_operator text := NULLIF(TRIM(COALESCE(p_payload->>'operator', '')), '');
  v_shift text := NULLIF(TRIM(COALESCE(p_payload->>'shift', '')), '');
  v_date date := COALESCE(NULLIF(p_payload->>'date', '')::date, current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour', ''), to_char(now(), 'HH24:MI'));
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity', '')::integer, 1), 1);
  v_tag production_tags%ROWTYPE;
  v_item production_lot_items%ROWTYPE;
  v_lot production_lots%ROWTYPE;
  v_route production_routes%ROWTYPE;
  v_next production_routes%ROWTYPE;
  v_reading production_stage_readings%ROWTYPE;
  v_recent integer := 0;
  v_total integer := 0;
  v_completed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','operator') THEN
    RETURN jsonb_build_object('success', false, 'status', 'forbidden', 'message', 'Usuario sem permissao para coleta produtiva.');
  END IF;
  IF v_tag_value = '' THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'Informe uma identificacao produtiva valida.');
  END IF;

  SELECT * INTO v_tag FROM production_tags
  WHERE tag_value = v_tag_value AND active = true
  LIMIT 1;

  IF FOUND AND v_tag.item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM production_lot_items WHERE id = v_tag.item_id FOR UPDATE;
  ELSE
    SELECT * INTO v_item FROM production_lot_items
    WHERE UPPER(item_code) = v_tag_value
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    SELECT pli.* INTO v_item
    FROM production_lot_items pli
    JOIN production_lots pl ON pl.id = pli.lot_id
    WHERE UPPER(pl.lot_code) = v_tag_value
      AND pli.status NOT IN ('completed','cancelled')
    ORDER BY pli.created_at ASC LIMIT 1 FOR UPDATE OF pli;
  END IF;

  IF v_item.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found', 'message', 'Tag, peca ou lote nao localizado.');
  END IF;

  IF v_tag.id IS NULL THEN
    INSERT INTO production_tags (lot_id, item_id, tag_value, tag_type, tag_format, barcode_value)
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

  SELECT * INTO v_lot FROM production_lots WHERE id = v_item.lot_id FOR UPDATE;

  IF v_item.status IN ('rejected','blocked','scrap','cancelled') THEN
    RETURN jsonb_build_object('success', false, 'status', 'blocked', 'message', 'Peca bloqueada ou reprovada. Libere a ocorrencia antes de avancar.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;
  IF v_item.status = 'completed' THEN
    RETURN jsonb_build_object('success', false, 'status', 'completed', 'message', 'Esta peca ja concluiu toda a rota produtiva.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  SELECT * INTO v_route FROM production_routes
  WHERE lot_id = v_item.lot_id
    AND required = true
    AND (step_name = v_item.current_step OR v_item.current_step IS NULL)
  ORDER BY step_order LIMIT 1;

  IF v_route.id IS NULL THEN
    SELECT * INTO v_route FROM production_routes
    WHERE lot_id = v_item.lot_id AND required = true
    ORDER BY step_order LIMIT 1;
  END IF;
  IF v_route.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'route_missing', 'message', 'O lote nao possui rota produtiva configurada.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item));
  END IF;

  IF v_step_input IS NOT NULL AND LOWER(v_step_input) <> LOWER(v_route.step_name) THEN
    INSERT INTO production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,reader_id,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,NULLIF(p_payload->>'readerId','')::uuid,
      v_station,v_step_input,v_cell,v_operator,auth.uid(),v_shift,v_date,v_hour,'blocked','wrong_step',v_quantity,
      'Etapa esperada: ' || v_route.step_name
    ) RETURNING * INTO v_reading;
    RETURN jsonb_build_object('success', false, 'status', 'wrong_step', 'message', 'Etapa incorreta. Etapa esperada: ' || v_route.step_name, 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  IF v_route.cell_name IS NOT NULL AND v_cell IS NOT NULL AND LOWER(v_route.cell_name) <> LOWER(v_cell) THEN
    INSERT INTO production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,reader_id,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,NULLIF(p_payload->>'readerId','')::uuid,
      v_station,v_route.step_name,v_cell,v_operator,auth.uid(),v_shift,v_date,v_hour,'blocked','wrong_step',v_quantity,
      'Celula esperada: ' || v_route.cell_name
    ) RETURNING * INTO v_reading;
    RETURN jsonb_build_object('success', false, 'status', 'wrong_cell', 'message', 'Celula incorreta. Celula esperada: ' || v_route.cell_name, 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  SELECT COUNT(*) INTO v_recent FROM production_stage_readings
  WHERE tag_id = v_tag.id AND created_at >= now() - interval '3 seconds';
  IF v_recent > 0 THEN
    INSERT INTO production_stage_readings (
      lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,
      operator,user_id,shift,date,hour,status,event_type,quantity,notes
    ) VALUES (
      v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,v_station,v_route.step_name,v_cell,
      v_operator,auth.uid(),v_shift,v_date,v_hour,'duplicated','duplicated_scan',v_quantity,'Janela anti-repeticao de 3 segundos'
    ) RETURNING * INTO v_reading;
    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Leitura repetida bloqueada.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route), 'reading', to_jsonb(v_reading));
  END IF;

  IF EXISTS (
    SELECT 1 FROM production_stage_readings
    WHERE item_id = v_item.id AND step_name = v_route.step_name AND status = 'approved'
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Esta peca ja foi baixada nesta etapa.', 'lot', to_jsonb(v_lot), 'item', to_jsonb(v_item), 'route', to_jsonb(v_route));
  END IF;

  INSERT INTO production_stage_readings (
    lot_id,item_id,tag_id,tag_value,reader_type,reader_id,reader_name,station_id,station_name,
    step_name,cell_name,operator,user_id,shift,date,hour,status,event_type,quantity,notes,
    rssi,antenna_port,read_count,first_seen_at,last_seen_at
  ) VALUES (
    v_lot.id,v_item.id,v_tag.id,v_tag_value,v_reader_type,NULLIF(p_payload->>'readerId','')::uuid,
    p_payload->>'readerName',p_payload->>'stationId',v_station,v_route.step_name,COALESCE(v_cell,v_route.cell_name),
    v_operator,auth.uid(),v_shift,v_date,v_hour,'approved',
    CASE WHEN v_reader_type = 'manual' THEN 'manual_adjustment' WHEN v_reader_type LIKE 'rfid_%' AND v_quantity > 1 THEN 'rfid_bulk_read' ELSE 'approved_scan' END,
    v_quantity,p_payload->>'notes',NULLIF(p_payload->>'rssi','')::numeric,NULLIF(p_payload->>'antennaPort','')::integer,
    COALESCE(NULLIF(p_payload->>'readCount','')::integer,1),NULLIF(p_payload->>'firstSeenAt','')::timestamptz,NULLIF(p_payload->>'lastSeenAt','')::timestamptz
  ) RETURNING * INTO v_reading;

  SELECT * INTO v_next FROM production_routes
  WHERE lot_id = v_item.lot_id AND required = true AND step_order > v_route.step_order
  ORDER BY step_order LIMIT 1;

  UPDATE production_lot_items
  SET current_step = v_next.step_name,
      current_cell = v_next.cell_name,
      status = CASE WHEN v_next.id IS NULL THEN 'completed' ELSE 'in_progress' END,
      updated_at = now()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_total, v_completed
  FROM production_lot_items WHERE lot_id = v_lot.id;

  UPDATE production_lots
  SET progress_percent = CASE WHEN v_total > 0 THEN ROUND((v_completed::numeric / v_total::numeric) * 100, 2) ELSE 0 END,
      planned_quantity = CASE WHEN COALESCE(planned_quantity,0) = 0 THEN v_total ELSE planned_quantity END,
      current_status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'completed' ELSE 'in_progress' END,
      status = CASE WHEN v_total > 0 AND v_completed = v_total THEN 'shipped' ELSE 'in_progress' END,
      actual_end = CASE WHEN v_total > 0 AND v_completed = v_total THEN now() ELSE actual_end END,
      updated_at = now()
  WHERE id = v_lot.id
  RETURNING * INTO v_lot;

  INSERT INTO production_entries (date,shift,cell,hour,produced,target,scrap,downtime,operator,notes,created_by)
  VALUES (v_date,COALESCE(v_shift,'Nao informado'),COALESCE(v_cell,v_route.cell_name,'Nao informada'),v_hour,v_quantity,0,0,0,v_operator,'Coleta produtiva - tag ' || v_tag_value,auth.uid());

  INSERT INTO traceability_logs (user_id,action,entity,entity_id,details)
  VALUES (auth.uid(),'approved_scan','production_lot_item',v_item.id,jsonb_build_object('tag',v_tag_value,'step',v_route.step_name,'cell',COALESCE(v_cell,v_route.cell_name),'reading_id',v_reading.id));

  RETURN jsonb_build_object(
    'success', true,
    'status', 'approved',
    'message', 'Leitura aprovada. Baixa produtiva registrada.',
    'lot', to_jsonb(v_lot),
    'item', to_jsonb(v_item),
    'route', to_jsonb(v_route),
    'reading', to_jsonb(v_reading),
    'nextStep', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'status', 'duplicated', 'message', 'Leitura duplicada bloqueada pela rastreabilidade.');
END;
$$;

CREATE OR REPLACE FUNCTION register_traceability_rejection(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item production_lot_items%ROWTYPE;
  v_tag production_tags%ROWTYPE;
  v_lot production_lots%ROWTYPE;
  v_occurrence occurrences%ROWTYPE;
  v_reading production_stage_readings%ROWTYPE;
  v_quantity integer := GREATEST(COALESCE(NULLIF(p_payload->>'quantity','')::integer,1),1);
  v_date date := COALESCE(NULLIF(p_payload->>'date','')::date,current_date);
  v_hour text := COALESCE(NULLIF(p_payload->>'hour',''),to_char(now(),'HH24:MI'));
BEGIN
  IF auth.uid() IS NULL OR get_my_role() NOT IN ('admin','manager','operator') THEN
    RETURN jsonb_build_object('success',false,'status','forbidden','message','Usuario sem permissao para reprovar pecas.');
  END IF;

  SELECT * INTO v_item FROM production_lot_items WHERE id = NULLIF(p_payload->>'itemId','')::uuid FOR UPDATE;
  SELECT * INTO v_tag FROM production_tags WHERE id = NULLIF(p_payload->>'tagId','')::uuid;
  SELECT * INTO v_lot FROM production_lots WHERE id = v_item.lot_id FOR UPDATE;
  IF v_item.id IS NULL OR v_lot.id IS NULL THEN
    RETURN jsonb_build_object('success',false,'status','not_found','message','Peca ou lote nao localizado para reprovar.');
  END IF;

  INSERT INTO occurrences (date,shift,cell,reason,downtime,operator,notes,created_by,lot_id,lot_item_id)
  VALUES (
    v_date,
    COALESCE(NULLIF(p_payload->>'shift',''),'Nao informado'),
    COALESCE(NULLIF(p_payload->>'cellName',''),v_item.current_cell,'Nao informada'),
    COALESCE(NULLIF(p_payload->>'reason',''),'Reprovacao registrada na coleta produtiva'),
    0,p_payload->>'operator',
    concat_ws(' | ',p_payload->>'defectType',p_payload->>'notes','Tag: ' || COALESCE(v_tag.tag_value,p_payload->>'tagValue')),
    auth.uid(),v_lot.id,v_item.source_lot_item_id
  ) RETURNING * INTO v_occurrence;

  INSERT INTO production_stage_readings (
    lot_id,item_id,tag_id,tag_value,reader_type,station_name,step_name,cell_name,operator,user_id,
    shift,date,hour,status,event_type,quantity,occurrence_id,notes
  ) VALUES (
    v_lot.id,v_item.id,v_tag.id,COALESCE(v_tag.tag_value,p_payload->>'tagValue'),COALESCE(p_payload->>'readerType','manual'),
    p_payload->>'stationName',COALESCE(p_payload->>'stepName',v_item.current_step),p_payload->>'cellName',p_payload->>'operator',auth.uid(),
    p_payload->>'shift',v_date,v_hour,'rejected','rejected_scan',v_quantity,v_occurrence.id,p_payload->>'notes'
  ) RETURNING * INTO v_reading;

  UPDATE production_lot_items SET status = 'blocked', updated_at = now() WHERE id = v_item.id RETURNING * INTO v_item;
  UPDATE production_lots SET scrap_count = COALESCE(scrap_count,0) + v_quantity, current_status = 'blocked', updated_at = now() WHERE id = v_lot.id RETURNING * INTO v_lot;

  INSERT INTO production_entries (date,shift,cell,hour,produced,target,scrap,downtime,operator,notes,created_by)
  VALUES (v_date,COALESCE(p_payload->>'shift','Nao informado'),COALESCE(p_payload->>'cellName','Nao informada'),v_hour,0,0,v_quantity,0,p_payload->>'operator','Reprovacao vinculada a tag ' || COALESCE(v_tag.tag_value,p_payload->>'tagValue'),auth.uid());

  INSERT INTO traceability_logs (user_id,action,entity,entity_id,details)
  VALUES (auth.uid(),'rejected_scan','production_lot_item',v_item.id,jsonb_build_object('reading_id',v_reading.id,'occurrence_id',v_occurrence.id,'reason',p_payload->>'reason'));

  RETURN jsonb_build_object('success',true,'status','rejected','message','Peca reprovada e ocorrencia vinculada.','lot',to_jsonb(v_lot),'item',to_jsonb(v_item),'reading',to_jsonb(v_reading),'occurrence',to_jsonb(v_occurrence));
END;
$$;

GRANT EXECUTE ON FUNCTION process_production_reading(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION register_traceability_rejection(jsonb) TO authenticated;

COMMENT ON TABLE production_tags IS 'Identificacao produtiva generica para barcode, QR Code, DataMatrix e RFID.';
COMMENT ON TABLE production_stage_readings IS 'Historico imutavel de leituras produtivas, incluindo preparacao para RFID.';
COMMENT ON TABLE reader_devices IS 'Cadastro RFID-ready para leitores teclado, USB, camera, fixos, manuais e gateways.';
