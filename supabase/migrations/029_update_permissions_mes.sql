-- Migration 029: Atualização de permissões MES para os perfis existentes no sistema
UPDATE profiles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'view_pcp', CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
    'manage_pcp', CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
    'manage_routes', CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
    'traceability_collect', true,
    'view_traceability', true,
    'manage_packaging', CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
    'manage_shipping', CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END,
    'view_mes_alerts', CASE WHEN role IN ('admin', 'manager') THEN true ELSE false END
  );
