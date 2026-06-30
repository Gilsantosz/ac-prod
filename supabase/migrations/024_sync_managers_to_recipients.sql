-- Migration: 024_sync_managers_to_recipients.sql
-- Sincroniza automaticamente gestores criados/atualizados na tabela profiles para a tabela report_recipients.

CREATE OR REPLACE FUNCTION public.sync_profile_to_report_recipient()
RETURNS trigger AS $$
DECLARE
  v_cell_filter text[] := '{}'::text[];
BEGIN
  -- Se for inserção ou atualização de um perfil com papel 'manager'
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.role = 'manager' THEN
    -- Converter o campo cell (JSON array string ou string simples) para text[]
    IF NEW.cell IS NOT NULL AND NEW.cell <> '' THEN
      BEGIN
        -- Tentar decodificar como JSON array
        IF NEW.cell ~ '^\s*\[.*\]\s*$' THEN
          SELECT ARRAY(SELECT jsonb_array_elements_text(NEW.cell::jsonb)) INTO v_cell_filter;
        ELSE
          -- Caso contrário, assumir string simples
          v_cell_filter := ARRAY[TRIM(NEW.cell)];
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Fallback para string simples se falhar a conversão JSON
        v_cell_filter := ARRAY[TRIM(NEW.cell)];
      END;
    END IF;

    -- Inserir ou atualizar na tabela report_recipients
    INSERT INTO public.report_recipients (name, email, role_label, recipient_group, cell_filter, active, created_by)
    VALUES (NEW.name, NEW.email, 'Gestor', 'manager', v_cell_filter, NEW.active, NEW.id)
    ON CONFLICT (email, recipient_group) DO UPDATE SET
      name = EXCLUDED.name,
      cell_filter = EXCLUDED.cell_filter,
      active = EXCLUDED.active,
      updated_at = now();
      
  -- Se for atualização e o papel deixou de ser 'manager'
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'manager' AND NEW.role <> 'manager' THEN
    DELETE FROM public.report_recipients WHERE email = OLD.email AND recipient_group = 'manager';
     
  -- Se for exclusão de um perfil
  ELSIF TG_OP = 'DELETE' AND OLD.role = 'manager' THEN
    DELETE FROM public.report_recipients WHERE email = OLD.email AND recipient_group = 'manager';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Criar trigger
DROP TRIGGER IF EXISTS trg_sync_profile_to_report_recipient ON public.profiles;
CREATE TRIGGER trg_sync_profile_to_report_recipient
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_to_report_recipient();

-- Sincronizar gestores existentes de profiles para report_recipients
DO $$
DECLARE
  r record;
  v_cell_filter text[];
BEGIN
  FOR r IN SELECT * FROM public.profiles WHERE role = 'manager' LOOP
    v_cell_filter := '{}'::text[];
    IF r.cell IS NOT NULL AND r.cell <> '' THEN
      BEGIN
        IF r.cell ~ '^\s*\[.*\]\s*$' THEN
          SELECT ARRAY(SELECT jsonb_array_elements_text(r.cell::jsonb)) INTO v_cell_filter;
        ELSE
          v_cell_filter := ARRAY[TRIM(r.cell)];
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_cell_filter := ARRAY[TRIM(r.cell)];
      END;
    END IF;

    INSERT INTO public.report_recipients (name, email, role_label, recipient_group, cell_filter, active, created_by)
    VALUES (r.name, r.email, 'Gestor', 'manager', v_cell_filter, r.active, r.id)
    ON CONFLICT (email, recipient_group) DO UPDATE SET
      name = EXCLUDED.name,
      cell_filter = EXCLUDED.cell_filter,
      active = EXCLUDED.active,
      updated_at = now();
  END LOOP;
END $$;
