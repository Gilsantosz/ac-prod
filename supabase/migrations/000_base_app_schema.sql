-- ============================================================
-- AC.Prod — Base application schema
-- Tabelas principais usadas pelo app antes dos módulos Promob/MES.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS profiles (
  id                         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                       text DEFAULT '',
  email                      text UNIQUE,
  role                       text NOT NULL DEFAULT 'operator'
                             CHECK (role IN ('admin','manager','operator','viewer','user')),
  cell                       text DEFAULT '',
  permissions                jsonb DEFAULT '{}'::jsonb,
  dashboard_layout           jsonb,
  active                     boolean DEFAULT true,
  receives_alerts            boolean DEFAULT true,
  receives_daily_report      boolean DEFAULT false,
  receives_trace_report      boolean DEFAULT false,
  receives_shipping_report   boolean DEFAULT false,
  report_send_time           time,
  report_frequency           text DEFAULT 'daily',
  extra_emails               text[] DEFAULT '{}',
  managed_cells              text[] DEFAULT '{}',
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text AS $$
  SELECT COALESCE(role, 'operator')
  FROM profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_cells()
RETURNS text[] AS $$
  SELECT COALESCE(managed_cells, '{}')
  FROM profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_first_user boolean;
  default_permissions jsonb;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first_user;

  default_permissions := CASE
    WHEN is_first_user THEN
      '{"view_dashboards":true,"register_production":true,"manage_occurrences":true,"manage_cells":true,"manage_operators":true,"view_reports":true,"manage_automations":true,"manage_users":true}'::jsonb
    ELSE
      '{"view_dashboards":true,"register_production":true,"manage_occurrences":true,"manage_cells":false,"manage_operators":false,"view_reports":false,"manage_automations":false,"manage_users":false}'::jsonb
  END;

  INSERT INTO public.profiles (id, email, name, role, cell, permissions)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(COALESCE(NEW.email, ''), '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', CASE WHEN is_first_user THEN 'admin' ELSE 'operator' END),
    COALESCE(NEW.raw_user_meta_data->>'cell', ''),
    default_permissions
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(NULLIF(EXCLUDED.name, ''), profiles.name),
    updated_at = now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE TABLE IF NOT EXISTS cells (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  description  text,
  active       boolean DEFAULT true,
  notes        text,
  shift_hours  jsonb DEFAULT '{"shift1":8,"shift2":8,"shift3":8}'::jsonb,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_goals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  shift       text NOT NULL,
  cell        text NOT NULL,
  target      numeric DEFAULT 0,
  hours       numeric DEFAULT 8,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (date, shift, cell)
);

CREATE TABLE IF NOT EXISTS production_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  shift       text NOT NULL,
  cell        text NOT NULL,
  hour        text NOT NULL,
  produced    numeric DEFAULT 0,
  target      numeric DEFAULT 0,
  scrap       numeric DEFAULT 0,
  downtime    numeric DEFAULT 0,
  operator    text,
  notes       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS occurrences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  shift       text NOT NULL,
  cell        text NOT NULL,
  reason      text NOT NULL,
  downtime    numeric DEFAULT 0,
  operator    text,
  notes       text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operators (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  role        text,
  active      boolean DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  active              boolean DEFAULT true,
  metric              text,
  operator            text,
  threshold           numeric DEFAULT 0,
  cell                text,
  action              text,
  "occurrenceReason"  text,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date,
  cell                text,
  signature           text UNIQUE,
  "currentEff"        numeric,
  "consecutiveHours"  numeric,
  recipients          text[] DEFAULT '{}',
  rule_id             uuid,
  message             text,
  severity            text DEFAULT 'warning',
  resolved            boolean DEFAULT false,
  resolved_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at         timestamptz,
  triggered_at        timestamptz DEFAULT now(),
  metadata            jsonb DEFAULT '{}'::jsonb,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month            text NOT NULL,
  cell             text NOT NULL,
  shift            text NOT NULL,
  "monthlyTarget"  numeric DEFAULT 0,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (month, cell, shift)
);

CREATE TABLE IF NOT EXISTS notification_configs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url            text,
  webhook_enabled        boolean DEFAULT false,
  email_enabled          boolean DEFAULT true,
  daily_closure_enabled  boolean DEFAULT false,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON production_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_entries_cell ON production_entries(cell);
CREATE INDEX IF NOT EXISTS idx_occurrences_date ON occurrences(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_goals_date ON daily_goals(date DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','cells','daily_goals','production_entries','occurrences',
    'operators','automation_rules','alert_logs','monthly_goals',
    'notification_configs'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      t, t, t, t
    );
  END LOOP;
END $$;

ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cells                ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_goals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE occurrences          ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators            ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_goals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_auth" ON profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR get_my_role() = 'admin');
CREATE POLICY "profiles_update_own_admin" ON profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() OR get_my_role() = 'admin')
  WITH CHECK (id = auth.uid() OR get_my_role() = 'admin');
CREATE POLICY "profiles_delete_admin" ON profiles
  FOR DELETE TO authenticated USING (get_my_role() = 'admin');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'production_entries','occurrences','operators','alert_logs'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "%s_select_auth" ON %I FOR SELECT TO authenticated USING (true);
       CREATE POLICY "%s_insert_auth" ON %I FOR INSERT TO authenticated WITH CHECK (true);
       CREATE POLICY "%s_update_auth" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
       CREATE POLICY "%s_delete_admin" ON %I FOR DELETE TO authenticated USING (get_my_role() = ''admin'');',
      t, t, t, t, t, t, t, t
    );
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cells','daily_goals','automation_rules','monthly_goals','notification_configs'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "%s_select_auth" ON %I FOR SELECT TO authenticated USING (true);
       CREATE POLICY "%s_write_admin_manager" ON %I FOR ALL TO authenticated
         USING (get_my_role() IN (''admin'',''manager''))
         WITH CHECK (get_my_role() IN (''admin'',''manager''));',
      t, t, t, t
    );
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('productive-backups', 'productive-backups', false)
ON CONFLICT (id) DO NOTHING;
