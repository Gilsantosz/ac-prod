-- Migration: 20260725040000_fix_alert_logs_before_trigger.sql
-- Atualiza a função do gatilho handle_alert_logs_before para permitir a reabertura de alertas quando detectados pelo diagnóstico.

CREATE OR REPLACE FUNCTION public.handle_alert_logs_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Diagnóstico tenta reabrir ou manter como não resolvido
    IF NEW.resolved = false THEN
      NEW.condition_active := true;
      NEW.last_detected_at := now();
      IF OLD.resolved = true THEN
        -- Reabre o alerta pois a condição problemática continua ativa no chão de fábrica
        NEW.resolved_at := NULL;
        NEW.resolved_by := NULL;
        NEW.resolution_source := NULL;
        NEW.resolution_note := NULL;
        NEW.occurrence_count := COALESCE(OLD.occurrence_count, 1) + 1;
        NEW.triggered_at := now();
      END IF;
    ELSIF NEW.resolved = true AND OLD.resolved = false THEN
      -- Alerta foi marcado como resolvido
      NEW.resolved_at := COALESCE(NEW.resolved_at, now());
      NEW.resolution_source := COALESCE(NEW.resolution_source, 'manual');
      IF NEW.resolution_source = 'automatic' THEN
        NEW.condition_active := false;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
