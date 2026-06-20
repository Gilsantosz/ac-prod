-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 001: Tabelas de Rastreabilidade Produtiva
-- Todas as tabelas são NOVAS — nenhuma tabela existente é alterada.
-- ============================================================

-- ─── Extensões necessárias ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── 1. ORDENS DE PRODUÇÃO ───────────────────────────────────
CREATE TABLE IF NOT EXISTS production_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code          text NOT NULL UNIQUE,
  customer_name       text NOT NULL DEFAULT '',
  customer_document   text,
  promob_project_id   text,
  promob_project_name text,
  source              text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('promob_xml','promob_api','manual')),
  delivery_date       date,
  priority            integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status              text NOT NULL DEFAULT 'imported'
                      CHECK (status IN ('imported','released','in_production','blocked',
                                        'partially_completed','completed','cancelled')),
  notes               text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ─── 2. LOTES PRODUTIVOS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_lots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  lot_code            text NOT NULL UNIQUE,
  lot_sequence        integer DEFAULT 1,
  current_stage       text DEFAULT 'imported',
  status              text NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned','released','in_progress','blocked',
                                        'partial','ready_to_pack','packed',
                                        'waiting_shipping','shipped','cancelled')),
  priority            integer DEFAULT 5,
  planned_start       timestamptz,
  planned_end         timestamptz,
  actual_start        timestamptz,
  actual_end          timestamptz,
  progress_percent    numeric(5,2) DEFAULT 0,
  missing_count       integer DEFAULT 0,
  rework_count        integer DEFAULT 0,
  scrap_count         integer DEFAULT 0,
  blocked_reason      text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ─── 3. ITENS DO LOTE (vindos do Promob) ─────────────────────
CREATE TABLE IF NOT EXISTS lot_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  promob_item_id      text,
  promob_module_id    text,
  promob_parent_id    text,
  environment_name    text,
  module_name         text,
  piece_code          text,
  piece_name          text NOT NULL DEFAULT '',
  material            text,
  color               text,
  thickness           numeric(8,2),
  width               numeric(8,2),
  height              numeric(8,2),
  depth               numeric(8,2),
  quantity            integer NOT NULL DEFAULT 1,
  edge_front          text,
  edge_back           text,
  edge_left           text,
  edge_right          text,
  -- Roteiro dinâmico por peça
  requires_cut        boolean DEFAULT true,
  requires_edge       boolean DEFAULT false,
  requires_cnc        boolean DEFAULT false,
  requires_joinery    boolean DEFAULT false,  -- Marcenaria
  requires_separation boolean DEFAULT true,
  requires_packaging  boolean DEFAULT true,
  requires_shipping   boolean DEFAULT true,
  route_template_id   uuid,
  unique_hash         text,
  status              text DEFAULT 'pending',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ─── 4. PEÇAS INDIVIDUAIS (rastreabilidade por unidade) ───────
CREATE TABLE IF NOT EXISTS piece_instances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_item_id         uuid NOT NULL REFERENCES lot_items(id) ON DELETE CASCADE,
  lot_id              uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  serial_code         text UNIQUE,
  qr_code             text UNIQUE,
  current_stage       text DEFAULT 'pending',
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','completed','missing',
                                        'scrap','rework','blocked','packed','shipped')),
  package_id          uuid,
  notes               text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ─── 5. ETAPAS PRODUTIVAS (seed incluído) ────────────────────
CREATE TABLE IF NOT EXISTS routing_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  sequence    integer NOT NULL,
  cell_id     uuid,
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Seed das etapas padrão Leo Madeiras
INSERT INTO routing_steps (code, name, sequence) VALUES
  ('imported',         'Importado',        1),
  ('released',         'Liberado',         2),
  ('cut',              'Corte',            3),
  ('edge',             'Bordo',            4),
  ('cnc',              'Usinagem',         5),
  ('joinery',          'Marcenaria',       6),
  ('separation',       'Separação',        7),
  ('packaging',        'Embalagem',        8),
  ('waiting_shipping', 'Aguardando Envio', 9),
  ('shipping',         'Expedição',        10),
  ('completed',        'Finalizado',       11)
ON CONFLICT (code) DO NOTHING;

-- ─── 6. ROTEIROS PRODUTIVOS (templates) ───────────────────────
CREATE TABLE IF NOT EXISTS route_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  product_type text,
  active       boolean DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Seed dos roteiros padrão Leo Madeiras
INSERT INTO route_templates (name, description, product_type) VALUES
  ('Roteiro Padrão MDF',          'Corte → Separação → Embalagem',                              'standard'),
  ('Roteiro com Bordo',           'Corte → Bordo → Separação → Embalagem',                      'edge'),
  ('Roteiro com Usinagem',        'Corte → Bordo → Usinagem → Separação → Embalagem',            'cnc'),
  ('Roteiro Sob Medida Refinado', 'Corte → Bordo → Usinagem → Marcenaria → Separação → Embalagem','custom_refined'),
  ('Roteiro Porta Pivotante',     'Corte → Bordo → Marcenaria → Separação → Embalagem',          'pivot_door'),
  ('Roteiro Sorrentos',           'Corte → Bordo → Usinagem → Marcenaria → Separação → Embalagem','sorrentos'),
  ('Roteiro Marcenaria Especial', 'Corte → Marcenaria → Separação → Embalagem',                  'special_joinery')
ON CONFLICT DO NOTHING;

-- ─── 7. ETAPAS POR ROTEIRO ───────────────────────────────────
CREATE TABLE IF NOT EXISTS route_template_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_template_id  uuid NOT NULL REFERENCES route_templates(id) ON DELETE CASCADE,
  step_code          text NOT NULL REFERENCES routing_steps(code),
  sequence           integer NOT NULL,
  required           boolean DEFAULT true,
  can_skip           boolean DEFAULT false,
  created_at         timestamptz DEFAULT now()
);

-- ─── 8. HISTÓRICO DE MOVIMENTAÇÕES (eventos) ─────────────────
CREATE TABLE IF NOT EXISTS lot_step_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  lot_item_id         uuid REFERENCES lot_items(id) ON DELETE SET NULL,
  piece_instance_id   uuid REFERENCES piece_instances(id) ON DELETE SET NULL,
  step_code           text NOT NULL,
  event_type          text NOT NULL
                      CHECK (event_type IN ('start','finish','pause','block','unblock',
                                            'rework','scrap','missing','found','undo',
                                            'transfer','note')),
  quantity            integer DEFAULT 0,
  operator_id         uuid,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cell                text,
  reason_code         text,
  notes               text,
  device_id           text,
  offline_id          text,
  created_at          timestamptz DEFAULT now(),
  synced_at           timestamptz
);

-- ─── 9. EMBALAGENS (volumes) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id         uuid NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
  order_id       uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  package_code   text NOT NULL UNIQUE,
  volume_number  integer DEFAULT 1,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','closed','waiting_shipping','shipped','cancelled')),
  total_items    integer DEFAULT 0,
  closed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at      timestamptz,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ─── 10. ITENS POR EMBALAGEM ─────────────────────────────────
CREATE TABLE IF NOT EXISTS package_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        uuid NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  lot_item_id       uuid NOT NULL REFERENCES lot_items(id) ON DELETE CASCADE,
  piece_instance_id uuid REFERENCES piece_instances(id) ON DELETE SET NULL,
  quantity          integer DEFAULT 1,
  checked_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at        timestamptz,
  created_at        timestamptz DEFAULT now()
);

-- ─── 11. EXPEDIÇÕES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  lot_id          uuid REFERENCES production_lots(id) ON DELETE SET NULL,
  shipment_code   text NOT NULL UNIQUE,
  carrier         text,
  vehicle         text,
  driver          text,
  tracking_code   text,
  shipped_at      timestamptz,
  shipped_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','shipped','delivered','cancelled')),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ─── 12. INTEGRAÇÃO PROMOB ───────────────────────────────────
CREATE TABLE IF NOT EXISTS promob_integrations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  mode                    text NOT NULL DEFAULT 'manual_xml'
                          CHECK (mode IN ('manual_xml','api_pull','api_webhook','hybrid')),
  api_url                 text,
  token_reference         text,  -- referência ao Vault, NUNCA o token em texto plano
  active                  boolean DEFAULT true,
  sync_interval_minutes   integer DEFAULT 60,
  environment             text DEFAULT 'production'
                          CHECK (environment IN ('sandbox','production')),
  last_sync_at            timestamptz,
  last_success_at         timestamptz,
  last_error_at           timestamptz,
  last_error_message      text,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- ─── 13. LOTES DE IMPORTAÇÃO PROMOB ──────────────────────────
CREATE TABLE IF NOT EXISTS promob_import_batches (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id           uuid REFERENCES promob_integrations(id) ON DELETE SET NULL,
  source_type              text NOT NULL DEFAULT 'xml_upload'
                           CHECK (source_type IN ('xml_upload','api_pull','api_webhook')),
  file_name                text,
  file_hash                text,
  promob_project_code      text,
  promob_project_name      text,
  customer_name            text,
  order_code               text,
  raw_xml_storage_path     text,
  raw_json_storage_path    text,
  status                   text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','parsed','processed',
                                            'duplicated','error')),
  error_message            text,
  imported_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at              timestamptz,
  created_at               timestamptz DEFAULT now()
);

-- ─── 14. DIFERENÇAS ENTRE IMPORTAÇÕES ────────────────────────
CREATE TABLE IF NOT EXISTS promob_import_differences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id     uuid NOT NULL REFERENCES promob_import_batches(id) ON DELETE CASCADE,
  existing_order_id   uuid REFERENCES production_orders(id) ON DELETE SET NULL,
  difference_type     text NOT NULL
                      CHECK (difference_type IN ('new_item','removed_item','changed_measure',
                                                  'changed_material','changed_quantity',
                                                  'changed_operation','changed_edge',
                                                  'changed_route')),
  field_name          text,
  old_value           text,
  new_value           text,
  severity            text DEFAULT 'info'
                      CHECK (severity IN ('info','warning','critical')),
  created_at          timestamptz DEFAULT now()
);

-- ─── 15. FILA OFFLINE GENÉRICA ───────────────────────────────
CREATE TABLE IF NOT EXISTS offline_event_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        text NOT NULL,
  operation     text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  temp_id       text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','synced','error')),
  retry_count   integer DEFAULT 0,
  error_message text,
  created_at    timestamptz DEFAULT now(),
  synced_at     timestamptz
);

-- ─── Índices de performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_production_lots_order_id     ON production_lots(order_id);
CREATE INDEX IF NOT EXISTS idx_production_lots_status       ON production_lots(status);
CREATE INDEX IF NOT EXISTS idx_production_lots_current_stage ON production_lots(current_stage);
CREATE INDEX IF NOT EXISTS idx_lot_items_lot_id             ON lot_items(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_items_requires_joinery   ON lot_items(requires_joinery) WHERE requires_joinery = true;
CREATE INDEX IF NOT EXISTS idx_piece_instances_lot_item_id  ON piece_instances(lot_item_id);
CREATE INDEX IF NOT EXISTS idx_piece_instances_qr_code      ON piece_instances(qr_code);
CREATE INDEX IF NOT EXISTS idx_lot_step_events_lot_id       ON lot_step_events(lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_step_events_step_code    ON lot_step_events(step_code);
CREATE INDEX IF NOT EXISTS idx_lot_step_events_created_at   ON lot_step_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packages_lot_id              ON packages(lot_id);
CREATE INDEX IF NOT EXISTS idx_packages_status              ON packages(status);
CREATE INDEX IF NOT EXISTS idx_shipments_order_id           ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_promob_batches_status        ON promob_import_batches(status);

-- ─── Triggers updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'production_orders','production_lots','lot_items','piece_instances',
    'routing_steps','route_templates','packages','shipments',
    'promob_integrations'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %s
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      t, t, t, t
    );
  END LOOP;
END $$;
