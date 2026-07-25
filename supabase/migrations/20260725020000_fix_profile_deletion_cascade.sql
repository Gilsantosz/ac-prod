-- Migration: 20260725020000_fix_profile_deletion_cascade.sql
-- Atualiza restrições de chaves estrangeiras e a RPC delete_user_from_auth para permitir a exclusão segura de colaboradores.

-- 1. Alterar chaves estrangeiras de report_schedule_recipients para ON DELETE CASCADE
ALTER TABLE public.report_schedule_recipients
  DROP CONSTRAINT IF EXISTS report_schedule_recipients_profile_id_fkey;

ALTER TABLE public.report_schedule_recipients
  ADD CONSTRAINT report_schedule_recipients_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 2. Alterar chaves estrangeiras de email_recipient_group_members para ON DELETE CASCADE
ALTER TABLE public.email_recipient_group_members
  DROP CONSTRAINT IF EXISTS email_recipient_group_members_profile_id_fkey;

ALTER TABLE public.email_recipient_group_members
  ADD CONSTRAINT email_recipient_group_members_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 3. Atualizar a RPC delete_user_from_auth para realizar a exclusão de forma transacional e limpa
CREATE OR REPLACE FUNCTION public.delete_user_from_auth(target_user_id UUID)
RETURNS VOID AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- Obter o papel do usuário autenticado que chamou a função
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();

  IF caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir usuários do sistema.';
  END IF;

  -- Limpar referências em tabelas de relatórios/grupos/alertas
  DELETE FROM public.report_schedule_recipients WHERE profile_id = target_user_id;
  DELETE FROM public.email_recipient_group_members WHERE profile_id = target_user_id;
  UPDATE public.alert_logs SET created_by = NULL WHERE created_by = target_user_id;
  UPDATE public.alert_logs SET resolved_by = NULL WHERE resolved_by = target_user_id;
  UPDATE public.report_schedule_runs SET requested_by = NULL WHERE requested_by = target_user_id;
  UPDATE public.report_deliveries SET profile_id = NULL WHERE profile_id = target_user_id;

  -- Excluir da tabela auth.users (que exclui profiles via cascade)
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.delete_user_from_auth(UUID) TO authenticated;
