-- Migration: 033_mes_alert_lifecycle.sql
-- Refatora a tabela alert_logs e adiciona o controle de ciclo de vida e histórico de ações.

-- 1. Adicionar novas colunas para o ciclo de vida à tabela alert_logs (sem remover existentes)
ALTER TABLE public.alert_logs
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'mes_diagnostic',
  ADD COLUMN IF NOT EXISTS condition_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS first_triggered_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_detected_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS occurrence_count integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS resolution_source text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- Atualizar registros existentes para terem valores padrão consistentes
UPDATE public.alert_logs
SET source = 'mes_diagnostic',
    condition_active = NOT COALESCE(resolved, false),
    first_triggered_at = COALESCE(triggered_at, now()),
    last_detected_at = COALESCE(triggered_at, now()),
    occurrence_count = 1
WHERE source IS NULL;

-- 2. Criar a tabela de histórico de ações
CREATE TABLE IF NOT EXISTS public.alert_action_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL,
  action text NOT NULL, -- 'create', 'resolve_manual', 'resolve_auto', 'reopen'
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Ativar RLS na tabela de histórico
ALTER TABLE public.alert_action_history ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para o histórico
DROP POLICY IF EXISTS alert_action_history_read ON public.alert_action_history;
CREATE POLICY alert_action_history_read ON public.alert_action_history
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS alert_action_history_insert ON public.alert_action_history;
CREATE POLICY alert_action_history_insert ON public.alert_action_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- 3. Função do Gatilho BEFORE INSERT OR UPDATE
CREATE OR REPLACE FUNCTION public.handle_alert_logs_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Normaliza a origem
  NEW.source := COALESCE(NEW.source, 'mes_diagnostic');

  IF TG_OP = 'INSERT' THEN
    NEW.condition_active := true;
    NEW.first_triggered_at := COALESCE(NEW.triggered_at, now());
    NEW.last_detected_at := COALESCE(NEW.triggered_at, now());
    NEW.occurrence_count := 1;
    NEW.resolved := COALESCE(NEW.resolved, false);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Diagnóstico tenta reabrir/marcar como não resolvido
    IF NEW.resolved = false AND OLD.resolved = true THEN
      -- Se a condição continua ativa física no fábrica (ou seja, no mesmo ciclo de detecção)
      IF OLD.condition_active = true THEN
        -- Preserva a resolução manual realizada pelo usuário!
        NEW.resolved := true;
        NEW.resolved_at := OLD.resolved_at;
        NEW.resolved_by := OLD.resolved_by;
        NEW.resolution_source := OLD.resolution_source;
        NEW.resolution_note := OLD.resolution_note;
        NEW.last_detected_at := now();
        NEW.triggered_at := OLD.triggered_at;
        NEW.first_triggered_at := OLD.first_triggered_at;
      ELSE
        -- Condição havia sumido (condition_active = false) e reapareceu! Reabrir como nova ocorrência
        NEW.resolved := false;
        NEW.condition_active := true;
        NEW.occurrence_count := COALESCE(OLD.occurrence_count, 1) + 1;
        NEW.resolved_at := NULL;
        NEW.resolved_by := NULL;
        NEW.resolution_source := NULL;
        NEW.resolution_note := NULL;
        NEW.triggered_at := now();
        NEW.last_detected_at := now();
        NEW.first_triggered_at := OLD.first_triggered_at;
      END IF;
    ELSIF NEW.resolved = false AND OLD.resolved = false THEN
      -- Condição continua ativa e alerta continua aberto
      NEW.last_detected_at := now();
      NEW.triggered_at := OLD.triggered_at;
      NEW.first_triggered_at := OLD.first_triggered_at;
      NEW.occurrence_count := COALESCE(OLD.occurrence_count, 1);
    ELSIF NEW.resolved = true AND OLD.resolved = false THEN
      -- Alerta foi marcado como resolvido
      NEW.resolved_at := COALESCE(NEW.resolved_at, now());
      NEW.resolution_source := COALESCE(NEW.resolution_source, 'manual');
      -- Se foi resolução automática, a condição não está ativa
      IF NEW.resolution_source = 'automatic' THEN
        NEW.condition_active := false;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Vincular gatilho BEFORE
DROP TRIGGER IF EXISTS trg_alert_logs_before ON public.alert_logs;
CREATE TRIGGER trg_alert_logs_before
  BEFORE INSERT OR UPDATE ON public.alert_logs
  FOR EACH ROW EXECUTE FUNCTION public.handle_alert_logs_before();

-- 4. Função do Gatilho AFTER INSERT OR UPDATE
CREATE OR REPLACE FUNCTION public.handle_alert_logs_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_action text;
  v_user_id uuid;
  v_note text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_user_id := NEW.created_by;
    v_note := 'Alerta registrado pelo sistema.';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.resolved = false AND NEW.resolved = true THEN
      IF NEW.resolution_source = 'automatic' THEN
        v_action := 'resolve_auto';
        v_note := 'Resolvido automaticamente (condição normalizada).';
      ELSE
        v_action := 'resolve_manual';
        v_user_id := NEW.resolved_by;
        v_note := COALESCE(NEW.resolution_note, 'Resolvido manualmente.');
      END IF;
    ELSIF OLD.resolved = true AND NEW.resolved = false THEN
      v_action := 'reopen';
      v_note := 'Alerta reaberto (condição recorrente detectada).';
    ELSE
      -- Sem alteração relevante de estado, sair
      RETURN NEW;
    END IF;
  END IF;

  -- Gravar histórico
  INSERT INTO public.alert_action_history (
    alert_id,
    action,
    user_id,
    note,
    metadata
  ) VALUES (
    NEW.id,
    v_action,
    v_user_id,
    v_note,
    jsonb_build_object(
      'signature', NEW.signature,
      'cell', NEW.cell,
      'message', NEW.message,
      'severity', NEW.severity,
      'occurrence_count', NEW.occurrence_count,
      'metadata', NEW.metadata
    )
  );

  RETURN NEW;
END;
$$;

-- Vincular gatilho AFTER
DROP TRIGGER IF EXISTS trg_alert_logs_after ON public.alert_logs;
CREATE TRIGGER trg_alert_logs_after
  AFTER INSERT OR UPDATE ON public.alert_logs
  FOR EACH ROW EXECUTE FUNCTION public.handle_alert_logs_after();

-- 5. RPC para Resolução Manual
CREATE OR REPLACE FUNCTION public.resolve_mes_alert(
  p_alert_id uuid,
  p_resolution_note text
)
RETURNS public.alert_logs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alert public.alert_logs;
  v_user_id uuid;
END;
$$;

-- 5. RPC para Resolução Manual (implementation)
CREATE OR REPLACE FUNCTION public.resolve_mes_alert(
  p_alert_id uuid,
  p_resolution_note text
)
RETURNS public.alert_logs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alert public.alert_logs;
  v_user_id uuid;
BEGIN
  -- Validar usuário autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  -- Obter permissão do perfil
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_user_id AND role IN ('admin', 'manager', 'supervisor', 'operator')
  ) THEN
    RAISE EXCEPTION 'Permissão insuficiente para resolver alertas.' USING ERRCODE = '42501';
  END IF;

  -- Buscar e bloquear a linha
  SELECT * INTO v_alert
  FROM public.alert_logs
  WHERE id = p_alert_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alerta com ID % não localizado.', p_alert_id USING ERRCODE = 'P0012';
  END IF;

  -- Atualizar o alerta
  UPDATE public.alert_logs
  SET resolved = true,
      resolved_at = now(),
      resolved_by = v_user_id,
      resolution_source = 'manual',
      resolution_note = p_resolution_note,
      updated_at = now()
  WHERE id = p_alert_id
  RETURNING * INTO v_alert;

  RETURN v_alert;
END;
$$;

-- Conceder permissão de execução
GRANT EXECUTE ON FUNCTION public.resolve_mes_alert(uuid, text) TO authenticated;

-- 6. RPC para Conciliação Transacional de Alertas MES
CREATE OR REPLACE FUNCTION public.reconcile_mes_alerts(
  p_alerts jsonb,
  p_active_signatures text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alert jsonb;
  v_signature text;
  v_cell text;
  v_message text;
  v_severity text;
  v_metadata jsonb;
  v_inserted_count integer := 0;
  v_resolved_count integer := 0;
  v_now timestamptz := now();
  v_user_id uuid;
BEGIN
  -- Validar usuário autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '42501';
  END IF;

  -- Obter permissão do perfil
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_user_id AND role IN ('admin', 'manager', 'supervisor')
  ) THEN
    RAISE EXCEPTION 'Permissão insuficiente para rodar diagnóstico.' USING ERRCODE = '42501';
  END IF;

  -- Upsert de alertas detectados
  FOR v_alert IN SELECT * FROM jsonb_array_elements(p_alerts) LOOP
    v_signature := v_alert->>'signature';
    v_cell := v_alert->>'cell';
    v_message := v_alert->>'message';
    v_severity := COALESCE(v_alert->>'severity', 'warning');
    v_metadata := COALESCE(v_alert->'metadata', '{}'::jsonb);

    INSERT INTO public.alert_logs (
      signature, cell, message, severity, metadata, source, resolved, triggered_at, date
    ) VALUES (
      v_signature, v_cell, v_message, v_severity, v_metadata, 'mes_diagnostic', false, v_now, v_now::date
    )
    ON CONFLICT (signature) DO UPDATE
    SET cell = EXCLUDED.cell,
        message = EXCLUDED.message,
        severity = EXCLUDED.severity,
        metadata = EXCLUDED.metadata,
        resolved = false -- Gatilho BEFORE decidirá se mantém resolvido ou reabre!
    ;
    v_inserted_count := v_inserted_count + 1;
  END LOOP;

  -- Resolver automaticamente alertas de 'mes_diagnostic' que NÃO estão nas assinaturas ativas
  UPDATE public.alert_logs
  SET resolved = true,
      resolved_at = v_now,
      resolution_source = 'automatic',
      resolution_note = 'Normalizado automaticamente no diagnóstico.',
      condition_active = false,
      updated_at = v_now
  WHERE source = 'mes_diagnostic'
    AND resolved = false
    AND NOT (signature = ANY(p_active_signatures));

  GET DIAGNOSTICS v_resolved_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_count', v_inserted_count,
    'resolved_count', v_resolved_count
  );
END;
$$;

-- Conceder permissão de execução
GRANT EXECUTE ON FUNCTION public.reconcile_mes_alerts(jsonb, text[]) TO authenticated;
