-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 006: Triggers de Auditoria em Tabelas Sensíveis
-- ============================================================

-- ─── Função genérica de auditoria ────────────────────────────
CREATE OR REPLACE FUNCTION audit_table_changes()
RETURNS TRIGGER AS $$
DECLARE
  user_profile RECORD;
  action_name text;
  old_val jsonb := NULL;
  new_val jsonb := NULL;
BEGIN
  -- Busca dados do usuário logado
  SELECT name, email, role INTO user_profile
  FROM profiles WHERE id = auth.uid() LIMIT 1;

  -- Determina ação
  action_name := TG_OP;  -- INSERT, UPDATE, DELETE

  IF TG_OP = 'DELETE' THEN
    old_val := to_jsonb(OLD);
  ELSIF TG_OP = 'UPDATE' THEN
    old_val := to_jsonb(OLD);
    new_val := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    new_val := to_jsonb(NEW);
  END IF;

  INSERT INTO system_audit_logs (
    user_id, user_name, user_email, user_role,
    action, entity, entity_id,
    old_value, new_value,
    metadata, created_at
  ) VALUES (
    auth.uid(),
    user_profile.name,
    user_profile.email,
    user_profile.role,
    lower(action_name),
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
    old_val,
    new_val,
    jsonb_build_object('trigger', true, 'table', TG_TABLE_NAME),
    now()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Aplicar trigger nas tabelas sensíveis ────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'production_orders',
    'production_lots',
    'lot_items',
    'piece_instances',
    'report_schedules',
    'promob_integrations',
    'backup_policies',
    'automation_rules'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_%s_audit ON %s;
         CREATE TRIGGER trg_%s_audit
           AFTER INSERT OR UPDATE OR DELETE ON %s
           FOR EACH ROW EXECUTE FUNCTION audit_table_changes();',
        t, t, t, t
      );
    EXCEPTION WHEN undefined_table THEN
      -- Tabela pode não existir ainda (ex: automation_rules)
      RAISE NOTICE 'Tabela % não encontrada, pulando trigger de auditoria.', t;
    END;
  END LOOP;
END $$;

-- ─── Função para calcular status do lote automaticamente ─────
-- (calculado via eventos, não digitado manualmente — Regra 1)
CREATE OR REPLACE FUNCTION calculate_lot_status(p_lot_id uuid)
RETURNS text AS $$
DECLARE
  v_total_items integer;
  v_completed   integer;
  v_scrap       integer;
  v_blocked     integer;
  v_in_progress integer;
  v_result      text;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'scrap'),
    COUNT(*) FILTER (WHERE status = 'blocked'),
    COUNT(*) FILTER (WHERE status = 'in_progress')
  INTO v_total_items, v_completed, v_scrap, v_blocked, v_in_progress
  FROM lot_items
  WHERE lot_id = p_lot_id;

  IF v_total_items = 0 THEN RETURN 'released'; END IF;
  IF v_blocked > 0 THEN RETURN 'blocked'; END IF;
  IF v_completed = v_total_items THEN RETURN 'completed'; END IF;
  IF v_in_progress > 0 THEN RETURN 'in_progress'; END IF;
  IF v_completed > 0 THEN RETURN 'partial'; END IF;
  RETURN 'planned';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Função: validar se peça pode avançar para Separação ─────
-- (Regra 3: requires_joinery deve estar concluído antes de Separação)
CREATE OR REPLACE FUNCTION validate_separation_ready(p_lot_item_id uuid)
RETURNS boolean AS $$
DECLARE
  v_requires_joinery boolean;
  v_joinery_done     boolean;
BEGIN
  SELECT requires_joinery INTO v_requires_joinery
  FROM lot_items WHERE id = p_lot_item_id;

  IF NOT COALESCE(v_requires_joinery, false) THEN
    RETURN true;  -- Não precisa de marcenaria, pode ir para separação
  END IF;

  -- Verifica se há evento de conclusão de marcenaria
  SELECT EXISTS (
    SELECT 1 FROM lot_step_events
    WHERE lot_item_id = p_lot_item_id
      AND step_code = 'joinery'
      AND event_type = 'finish'
  ) INTO v_joinery_done;

  RETURN v_joinery_done;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
