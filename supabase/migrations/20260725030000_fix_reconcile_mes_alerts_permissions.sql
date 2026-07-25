-- Migration: 20260725030000_fix_reconcile_mes_alerts_permissions.sql
-- Permite que qualquer operador ou usuário ativo autenticado execute o diagnóstico e conciliação de alertas industriais.

CREATE OR REPLACE FUNCTION public.reconcile_mes_alerts(
  p_alerts jsonb,
  p_active_signatures text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Obter permissão do perfil (permite qualquer usuário ativo no sistema)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = v_user_id AND (active IS NULL OR active = true)
  ) THEN
    RAISE EXCEPTION 'Usuário inativo ou não autorizado para sincronizar alertas.' USING ERRCODE = '42501';
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
        resolved = false
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

GRANT EXECUTE ON FUNCTION public.reconcile_mes_alerts(jsonb, text[]) TO authenticated;
