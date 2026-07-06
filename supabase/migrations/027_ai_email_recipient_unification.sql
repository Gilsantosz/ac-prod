-- ============================================================
-- AC.Prod - IA Operacional
-- Migration 027: unificacao de destinatarios de e-mail da IA
-- ============================================================
-- Objetivo:
-- 1) Fazer a IA usar Usuarios/Gestores como fonte oficial de e-mails.
-- 2) Manter report_recipients apenas como legado/fallback.
-- 3) Apontar agendamentos da IA para report_schedules, que ja e processada
--    pela Edge Function send-scheduled-reports.
-- 4) Desativar o sincronismo antigo que duplicava gestores em report_recipients.

ALTER TABLE IF EXISTS report_schedules
  ADD COLUMN IF NOT EXISTS report_types text[] DEFAULT '{}';

UPDATE report_schedules
SET report_types = ARRAY[report_type]
WHERE (report_types IS NULL OR array_length(report_types, 1) IS NULL)
  AND report_type IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sync_profile_to_report_recipient ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_profile_to_report_recipient();

CREATE OR REPLACE VIEW ai_email_recipients AS
SELECT
  ('profile:' || p.id::text)                  AS ref_id,
  p.id                                       AS profile_id,
  NULL::uuid                                 AS report_recipient_id,
  'profile'                                  AS source,
  COALESCE(NULLIF(p.name, ''), p.email)       AS name,
  lower(p.email)                             AS email,
  CASE WHEN p.role = 'admin' THEN 'Administrador' ELSE 'Gestor' END AS role_label,
  COALESCE(p.managed_cells, '{}'::text[])     AS cell_filter,
  COALESCE(p.active, true)                    AS active
FROM profiles p
WHERE p.role IN ('admin','manager')
  AND COALESCE(p.active, true) = true
  AND p.email IS NOT NULL
  AND p.email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'

UNION ALL

SELECT
  ('recipient:' || r.id::text)                AS ref_id,
  NULL::uuid                                  AS profile_id,
  r.id                                        AS report_recipient_id,
  'report_recipients'                         AS source,
  COALESCE(NULLIF(r.name, ''), r.email)        AS name,
  lower(r.email)                              AS email,
  COALESCE(r.role_label, 'Destinatario IA')    AS role_label,
  COALESCE(r.cell_filter, '{}'::text[])        AS cell_filter,
  COALESCE(r.active, true)                    AS active
FROM report_recipients r
WHERE COALESCE(r.active, true) = true
  AND r.email IS NOT NULL
  AND r.email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$';

GRANT SELECT ON ai_email_recipients TO authenticated;

COMMENT ON VIEW ai_email_recipients IS
  'Fonte unificada da IA: profiles/admins/gestores como origem oficial e report_recipients apenas como legado.';

-- A tabela scheduled_reports permanece por compatibilidade historica da IA,
-- mas o fluxo canonico de envio agendado e report_schedules + send-scheduled-reports.
