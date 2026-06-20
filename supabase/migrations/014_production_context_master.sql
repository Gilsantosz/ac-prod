-- AC.Prod - contexto produtivo mestre (migracao aditiva)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS system_order_number text,
  ADD COLUMN IF NOT EXISTS customer_order_number text,
  ADD COLUMN IF NOT EXISTS order_number text,
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS customer_legal_name text,
  ADD COLUMN IF NOT EXISTS customer_trade_name text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS delivery_region text,
  ADD COLUMN IF NOT EXISTS finalization_date date;

UPDATE production_orders SET
  system_order_number = COALESCE(system_order_number, order_code),
  order_number = COALESCE(order_number, order_code),
  customer_legal_name = COALESCE(customer_legal_name, customer_name),
  customer_trade_name = COALESCE(customer_trade_name, customer_name);

ALTER TABLE production_lots
  ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES production_orders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS product_description text,
  ADD COLUMN IF NOT EXISTS produced_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS current_cell text;

UPDATE production_lots SET
  production_order_id = COALESCE(production_order_id, order_id),
  current_step = COALESCE(current_step, current_stage),
  rejected_quantity = COALESCE(rejected_quantity, scrap_count, 0),
  pending_quantity = GREATEST(COALESCE(planned_quantity, 0) - COALESCE(produced_quantity, 0), 0);

CREATE OR REPLACE FUNCTION sync_production_lot_context()
RETURNS trigger AS $$
BEGIN
  NEW.order_id := COALESCE(NEW.order_id, NEW.production_order_id);
  NEW.production_order_id := COALESCE(NEW.production_order_id, NEW.order_id);
  NEW.current_stage := COALESCE(NULLIF(NEW.current_stage, ''), NEW.current_step, 'imported');
  NEW.current_step := COALESCE(NULLIF(NEW.current_step, ''), NEW.current_stage);
  NEW.pending_quantity := GREATEST(COALESCE(NEW.planned_quantity, 0) - COALESCE(NEW.produced_quantity, 0), 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_sync_production_lot_context ON production_lots;
CREATE TRIGGER trg_sync_production_lot_context BEFORE INSERT OR UPDATE ON production_lots
FOR EACH ROW EXECUTE FUNCTION sync_production_lot_context();

CREATE TABLE IF NOT EXISTS production_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  product_code text,
  product_name text,
  product_description text,
  quantity numeric NOT NULL DEFAULT 0,
  mirror_quantity numeric NOT NULL DEFAULT 0,
  pallet_number text,
  route_code text,
  route_name text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE production_routes
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES production_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE production_stage_readings
  ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES production_order_items(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS production_search_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  search_text text NOT NULL DEFAULT '',
  keywords_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);

ALTER TABLE production_entries
  ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_item_id uuid REFERENCES production_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS system_order_number text,
  ADD COLUMN IF NOT EXISTS customer_order_number text,
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS customer_legal_name text,
  ADD COLUMN IF NOT EXISTS customer_trade_name text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS product_description text,
  ADD COLUMN IF NOT EXISTS route_code text,
  ADD COLUMN IF NOT EXISTS route_name text,
  ADD COLUMN IF NOT EXISTS finalization_date date,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS delivery_region text,
  ADD COLUMN IF NOT EXISTS mirror_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pallet_number text,
  ADD COLUMN IF NOT EXISTS traceability_status text NOT NULL DEFAULT 'limited';

UPDATE production_entries SET
  production_order_id = COALESCE(production_order_id, order_id),
  traceability_status = CASE WHEN COALESCE(lot_id, production_order_id, order_id) IS NULL THEN 'limited' ELSE 'resolved' END;

CREATE OR REPLACE FUNCTION enrich_production_entry_context()
RETURNS trigger AS $$
DECLARE
  v_tag text;
  v_lot production_lots%ROWTYPE;
  v_order production_orders%ROWTYPE;
  v_item production_order_items%ROWTYPE;
BEGIN
  NEW.production_order_id := COALESCE(NEW.production_order_id, NEW.order_id);
  NEW.order_id := COALESCE(NEW.order_id, NEW.production_order_id);
  IF NEW.lot_id IS NULL AND NEW.notes ~* 'tag ' THEN
    v_tag := UPPER(TRIM(regexp_replace(NEW.notes, '^.*tag ', '', 'i')));
    SELECT pl.* INTO v_lot FROM production_tags pt JOIN production_lots pl ON pl.id = pt.lot_id
    WHERE pt.tag_value = v_tag LIMIT 1;
    NEW.lot_id := COALESCE(NEW.lot_id, v_lot.id);
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
    SELECT * INTO v_lot FROM production_lots WHERE id = NEW.lot_id;
    NEW.production_order_id := COALESCE(NEW.production_order_id, v_lot.production_order_id, v_lot.order_id);
    NEW.order_id := COALESCE(NEW.order_id, NEW.production_order_id);
    NEW.lot_code := COALESCE(NULLIF(NEW.lot_code,''), v_lot.lot_code);
    NEW.product_code := COALESCE(NULLIF(NEW.product_code,''), v_lot.product_code);
    NEW.product_name := COALESCE(NULLIF(NEW.product_name,''), v_lot.product_name);
    NEW.product_description := COALESCE(NULLIF(NEW.product_description,''), v_lot.product_description);
    NEW.process_step := COALESCE(NULLIF(NEW.process_step,''), v_lot.current_step, v_lot.current_stage);
  END IF;
  IF NEW.production_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM production_orders WHERE id = NEW.production_order_id;
    NEW.system_order_number := COALESCE(NULLIF(NEW.system_order_number,''), v_order.system_order_number);
    NEW.customer_order_number := COALESCE(NULLIF(NEW.customer_order_number,''), v_order.customer_order_number);
    NEW.order_number := COALESCE(NULLIF(NEW.order_number,''), v_order.order_number, v_order.order_code);
    NEW.load_number := COALESCE(NULLIF(NEW.load_number,''), v_order.load_number);
    NEW.customer_code := COALESCE(NULLIF(NEW.customer_code,''), v_order.customer_code);
    NEW.customer_legal_name := COALESCE(NULLIF(NEW.customer_legal_name,''), v_order.customer_legal_name, v_order.customer_name);
    NEW.customer_trade_name := COALESCE(NULLIF(NEW.customer_trade_name,''), v_order.customer_trade_name, v_order.customer_name);
    NEW.customer_name := COALESCE(NULLIF(NEW.customer_name,''), v_order.customer_trade_name, v_order.customer_name);
    NEW.cnpj := COALESCE(NULLIF(NEW.cnpj,''), v_order.cnpj);
    NEW.finalization_date := COALESCE(NEW.finalization_date, v_order.finalization_date);
    NEW.city := COALESCE(NULLIF(NEW.city,''), v_order.city);
    NEW.state := COALESCE(NULLIF(NEW.state,''), v_order.state);
    NEW.delivery_region := COALESCE(NULLIF(NEW.delivery_region,''), v_order.delivery_region);
  END IF;
  IF NEW.order_item_id IS NOT NULL THEN
    SELECT * INTO v_item FROM production_order_items WHERE id = NEW.order_item_id;
    NEW.product_code := COALESCE(NULLIF(NEW.product_code,''), v_item.product_code);
    NEW.product_name := COALESCE(NULLIF(NEW.product_name,''), v_item.product_name);
    NEW.product_description := COALESCE(NULLIF(NEW.product_description,''), v_item.product_description);
    NEW.route_code := COALESCE(NULLIF(NEW.route_code,''), v_item.route_code);
    NEW.route_name := COALESCE(NULLIF(NEW.route_name,''), v_item.route_name);
    NEW.mirror_quantity := COALESCE(NEW.mirror_quantity, v_item.mirror_quantity, 0);
    NEW.pallet_number := COALESCE(NULLIF(NEW.pallet_number,''), v_item.pallet_number);
  END IF;
  NEW.traceability_status := CASE WHEN COALESCE(NEW.production_order_id, NEW.lot_id, NEW.order_item_id) IS NULL THEN 'limited' ELSE 'resolved' END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS trg_enrich_production_entry_context ON production_entries;
CREATE TRIGGER trg_enrich_production_entry_context BEFORE INSERT OR UPDATE ON production_entries
FOR EACH ROW EXECUTE FUNCTION enrich_production_entry_context();

CREATE OR REPLACE FUNCTION enrich_stage_reading_context()
RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(production_order_id, order_id) INTO NEW.production_order_id FROM production_lots WHERE id = NEW.lot_id;
  IF NEW.order_item_id IS NULL THEN
    SELECT poi.id INTO NEW.order_item_id FROM production_order_items poi
    LEFT JOIN production_lot_items pli ON pli.id = NEW.item_id
    WHERE poi.lot_id = NEW.lot_id AND (pli.id IS NULL OR poi.product_code = pli.product_code OR poi.product_name = pli.product_name)
    ORDER BY poi.created_at LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS trg_enrich_stage_reading_context ON production_stage_readings;
CREATE TRIGGER trg_enrich_stage_reading_context BEFORE INSERT ON production_stage_readings
FOR EACH ROW EXECUTE FUNCTION enrich_stage_reading_context();

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON production_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_load_number ON production_orders(load_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_legal_name ON production_orders(customer_legal_name);
CREATE INDEX IF NOT EXISTS idx_orders_finalization_date ON production_orders(finalization_date);
CREATE INDEX IF NOT EXISTS idx_lots_lot_code_context ON production_lots(lot_code);
CREATE INDEX IF NOT EXISTS idx_lots_production_order ON production_lots(production_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_pallet ON production_order_items(pallet_number);
CREATE INDEX IF NOT EXISTS idx_order_items_route ON production_order_items(route_code);
CREATE INDEX IF NOT EXISTS idx_entries_order_context ON production_entries(order_number);
CREATE INDEX IF NOT EXISTS idx_entries_load_context ON production_entries(load_number);
CREATE INDEX IF NOT EXISTS idx_entries_lot_context ON production_entries(lot_code);
CREATE INDEX IF NOT EXISTS idx_entries_customer_legal ON production_entries(customer_legal_name);
CREATE INDEX IF NOT EXISTS idx_entries_product_name ON production_entries(product_name);
CREATE INDEX IF NOT EXISTS idx_entries_pallet ON production_entries(pallet_number);
CREATE INDEX IF NOT EXISTS idx_stage_readings_tag_context ON production_stage_readings(tag_value);
CREATE INDEX IF NOT EXISTS idx_production_search_text ON production_search_index USING gin (to_tsvector('simple', search_text));

DROP TRIGGER IF EXISTS trg_production_order_items_updated_at ON production_order_items;
CREATE TRIGGER trg_production_order_items_updated_at BEFORE UPDATE ON production_order_items
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS trg_production_routes_context_updated_at ON production_routes;
CREATE TRIGGER trg_production_routes_context_updated_at BEFORE UPDATE ON production_routes
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE production_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_search_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_order_items_select ON production_order_items;
CREATE POLICY production_order_items_select ON production_order_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS production_order_items_write ON production_order_items;
CREATE POLICY production_order_items_write ON production_order_items FOR ALL TO authenticated
USING (get_my_role() IN ('admin','manager')) WITH CHECK (get_my_role() IN ('admin','manager'));
DROP POLICY IF EXISTS production_search_index_select ON production_search_index;
CREATE POLICY production_search_index_select ON production_search_index FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS production_search_index_write ON production_search_index;
CREATE POLICY production_search_index_write ON production_search_index FOR ALL TO authenticated
USING (get_my_role() IN ('admin','manager')) WITH CHECK (get_my_role() IN ('admin','manager'));

CREATE OR REPLACE FUNCTION refresh_production_search_index()
RETURNS trigger AS $$
DECLARE
  v_order_id uuid;
  v_order production_orders%ROWTYPE;
  v_lots text;
  v_products text;
  v_pallets text;
  v_routes text;
BEGIN
  IF TG_TABLE_NAME = 'production_orders' THEN
    v_order_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'production_lots' THEN
    v_order_id := COALESCE(NEW.production_order_id, NEW.order_id);
  ELSE
    v_order_id := NEW.production_order_id;
  END IF;
  SELECT * INTO v_order FROM production_orders WHERE id = v_order_id;
  IF v_order.id IS NULL THEN RETURN NEW; END IF;
  SELECT string_agg(lot_code, ' | ') INTO v_lots FROM production_lots WHERE COALESCE(production_order_id,order_id)=v_order_id;
  SELECT string_agg(concat_ws(' ',product_code,product_name,product_description), ' | '),
         string_agg(pallet_number, ' | '), string_agg(concat_ws(' ',route_code,route_name), ' | ')
  INTO v_products,v_pallets,v_routes FROM production_order_items WHERE production_order_id=v_order_id;
  INSERT INTO production_search_index(entity_type,entity_id,search_text,keywords_json,status,updated_at)
  VALUES ('production_order',v_order_id,concat_ws(' | ',v_order.order_code,v_order.system_order_number,v_order.customer_order_number,v_order.order_number,v_order.load_number,v_order.customer_code,v_order.customer_legal_name,v_order.customer_trade_name,v_order.cnpj,v_order.city,v_order.state,v_order.delivery_region,v_order.finalization_date::text,v_lots,v_products,v_pallets,v_routes),
    jsonb_build_object('pedido',v_order.order_number,'carga',v_order.load_number,'cliente',v_order.customer_trade_name,'razao_social',v_order.customer_legal_name,'lotes',v_lots,'produtos',v_products,'pallets',v_pallets,'roteiros',v_routes,'finalizacao',v_order.finalization_date),v_order.status,now())
  ON CONFLICT(entity_type,entity_id) DO UPDATE SET search_text=EXCLUDED.search_text,keywords_json=EXCLUDED.keywords_json,status=EXCLUDED.status,updated_at=now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public;

DROP TRIGGER IF EXISTS trg_search_index_orders ON production_orders;
CREATE TRIGGER trg_search_index_orders AFTER INSERT OR UPDATE ON production_orders FOR EACH ROW EXECUTE FUNCTION refresh_production_search_index();
DROP TRIGGER IF EXISTS trg_search_index_lots ON production_lots;
CREATE TRIGGER trg_search_index_lots AFTER INSERT OR UPDATE ON production_lots FOR EACH ROW EXECUTE FUNCTION refresh_production_search_index();
DROP TRIGGER IF EXISTS trg_search_index_items ON production_order_items;
CREATE TRIGGER trg_search_index_items AFTER INSERT OR UPDATE ON production_order_items FOR EACH ROW EXECUTE FUNCTION refresh_production_search_index();

INSERT INTO production_search_index(entity_type,entity_id,search_text,keywords_json,status,updated_at)
SELECT 'production_order',po.id,
  concat_ws(' | ',po.order_code,po.system_order_number,po.customer_order_number,po.order_number,po.load_number,po.customer_code,po.customer_legal_name,po.customer_trade_name,po.cnpj,po.city,po.state,po.delivery_region,po.finalization_date::text),
  jsonb_build_object('pedido',po.order_number,'carga',po.load_number,'cliente',po.customer_trade_name,'razao_social',po.customer_legal_name,'finalizacao',po.finalization_date),po.status,now()
FROM production_orders po
ON CONFLICT(entity_type,entity_id) DO UPDATE SET search_text=EXCLUDED.search_text,keywords_json=EXCLUDED.keywords_json,status=EXCLUDED.status,updated_at=now();

CREATE OR REPLACE FUNCTION resolve_production_context(p_input text, p_hint text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v text := UPPER(TRIM(COALESCE(p_input,'')));
  h text := LOWER(TRIM(COALESCE(p_hint,'')));
  o production_orders%ROWTYPE;
  l production_lots%ROWTYPE;
  i production_order_items%ROWTYPE;
  li production_lot_items%ROWTYPE;
  r production_routes%ROWTYPE;
  t production_tags%ROWTYPE;
  matched text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('contextFound',false,'warnings',jsonb_build_array('Autenticacao obrigatoria.')); END IF;
  IF v = '' THEN RETURN jsonb_build_object('contextFound',false,'warnings',jsonb_build_array('Informe Pedido, Lote, Carga, Pallet ou etiqueta.')); END IF;
  IF h IN ('','tag','scanner','camera','rfid') THEN
    SELECT * INTO t FROM production_tags WHERE active AND UPPER(tag_value)=v LIMIT 1;
    IF t.id IS NOT NULL THEN SELECT * INTO l FROM production_lots WHERE id=t.lot_id; SELECT * INTO li FROM production_lot_items WHERE id=t.item_id; matched:='tag'; END IF;
  END IF;
  IF l.id IS NULL AND h IN ('','lot','lote') THEN SELECT * INTO l FROM production_lots WHERE UPPER(lot_code)=v LIMIT 1; IF l.id IS NOT NULL THEN matched:='lot'; END IF; END IF;
  IF l.id IS NOT NULL THEN
    SELECT * INTO o FROM production_orders WHERE id=COALESCE(l.production_order_id,l.order_id);
    SELECT * INTO i FROM production_order_items WHERE lot_id=l.id AND (li.id IS NULL OR product_code=li.product_code OR product_name=li.product_name) ORDER BY created_at LIMIT 1;
  END IF;
  IF i.id IS NULL AND h IN ('','pallet','palete') THEN
    SELECT * INTO i FROM production_order_items WHERE UPPER(COALESCE(pallet_number,''))=v ORDER BY created_at DESC LIMIT 1;
    IF i.id IS NOT NULL THEN SELECT * INTO o FROM production_orders WHERE id=i.production_order_id; SELECT * INTO l FROM production_lots WHERE id=i.lot_id; matched:='pallet'; END IF;
  END IF;
  IF o.id IS NULL AND h IN ('','order','pedido') THEN
    SELECT * INTO o FROM production_orders WHERE UPPER(COALESCE(system_order_number,''))=v OR UPPER(COALESCE(customer_order_number,''))=v OR UPPER(COALESCE(order_number,''))=v OR UPPER(order_code)=v ORDER BY created_at DESC LIMIT 1;
    IF o.id IS NOT NULL THEN matched:='order'; END IF;
  END IF;
  IF o.id IS NULL AND h IN ('','load','carga') THEN SELECT * INTO o FROM production_orders WHERE UPPER(COALESCE(load_number,''))=v ORDER BY created_at DESC LIMIT 1; IF o.id IS NOT NULL THEN matched:='load'; END IF; END IF;
  IF o.id IS NULL AND h IN ('','product','produto') THEN
    SELECT * INTO i FROM production_order_items WHERE UPPER(COALESCE(product_code,''))=v OR UPPER(COALESCE(product_name,''))=v ORDER BY created_at DESC LIMIT 1;
    IF i.id IS NOT NULL THEN SELECT * INTO o FROM production_orders WHERE id=i.production_order_id; SELECT * INTO l FROM production_lots WHERE id=i.lot_id; matched:='product'; END IF;
  END IF;
  IF o.id IS NULL AND h IN ('','customer','cliente') THEN
    SELECT * INTO o FROM production_orders WHERE UPPER(COALESCE(customer_code,''))=v OR UPPER(COALESCE(customer_legal_name,''))=v OR UPPER(COALESCE(customer_trade_name,''))=v OR UPPER(customer_name)=v ORDER BY created_at DESC LIMIT 1;
    IF o.id IS NOT NULL THEN matched:='customer'; END IF;
  END IF;
  IF o.id IS NOT NULL AND l.id IS NULL THEN SELECT * INTO l FROM production_lots WHERE COALESCE(production_order_id,order_id)=o.id ORDER BY created_at DESC LIMIT 1; END IF;
  IF l.id IS NOT NULL AND i.id IS NULL THEN SELECT * INTO i FROM production_order_items WHERE lot_id=l.id ORDER BY created_at LIMIT 1; END IF;
  IF l.id IS NOT NULL THEN SELECT * INTO r FROM production_routes WHERE lot_id=l.id AND required AND status NOT IN ('completed','skipped') ORDER BY step_order LIMIT 1; END IF;
  RETURN jsonb_build_object(
    'productionOrder',CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o) END,
    'lot',CASE WHEN l.id IS NULL THEN NULL ELSE to_jsonb(l) END,
    'item',CASE WHEN i.id IS NULL THEN CASE WHEN li.id IS NULL THEN NULL ELSE to_jsonb(li) END ELSE to_jsonb(i) END,
    'route',CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END,
    'contextFound',o.id IS NOT NULL OR l.id IS NOT NULL OR i.id IS NOT NULL,
    'matchedBy',matched,
    'warnings',CASE WHEN o.id IS NULL AND l.id IS NULL AND i.id IS NULL THEN jsonb_build_array('Contexto produtivo nao localizado. Rastreabilidade limitada.') WHEN i.id IS NULL THEN jsonb_build_array('Contexto localizado sem item comercial vinculado.') ELSE '[]'::jsonb END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION resolve_production_context(text,text) TO authenticated;
COMMENT ON FUNCTION resolve_production_context(text,text) IS 'Resolvedor canonico usado por entrada, scanner, camera, RFID, IA e relatorios.';
