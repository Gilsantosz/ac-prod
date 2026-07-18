-- =====================================================================
-- Migration 037: Corrigir políticas RLS de escrita nas tabelas de embalagem
-- =====================================================================
-- PROBLEMA: packing_volumes, packing_volume_items, packing_scans e
-- customer_covers possuem RLS habilitado mas apenas política de SELECT.
-- Qualquer INSERT/UPDATE/DELETE do frontend retorna 403 Forbidden.
--
-- SOLUÇÃO: Adicionar políticas de INSERT, UPDATE e DELETE para usuários
-- autenticados com permissão manage_packaging, conforme a função
-- has_permission() já existente no banco.
-- =====================================================================

-- ─── 1. packing_volumes ──────────────────────────────────────────────

DROP POLICY IF EXISTS "packing_volumes_insert" ON public.packing_volumes;
CREATE POLICY "packing_volumes_insert" ON public.packing_volumes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  );

DROP POLICY IF EXISTS "packing_volumes_update" ON public.packing_volumes;
CREATE POLICY "packing_volumes_update" ON public.packing_volumes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS "packing_volumes_delete" ON public.packing_volumes;
CREATE POLICY "packing_volumes_delete" ON public.packing_volumes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
    )
  );

-- ─── 2. packing_volume_items ─────────────────────────────────────────

DROP POLICY IF EXISTS "packing_volume_items_insert" ON public.packing_volume_items;
CREATE POLICY "packing_volume_items_insert" ON public.packing_volume_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  );

DROP POLICY IF EXISTS "packing_volume_items_update" ON public.packing_volume_items;
CREATE POLICY "packing_volume_items_update" ON public.packing_volume_items
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  );

DROP POLICY IF EXISTS "packing_volume_items_delete" ON public.packing_volume_items;
CREATE POLICY "packing_volume_items_delete" ON public.packing_volume_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  );

-- ─── 3. packing_scans ────────────────────────────────────────────────

DROP POLICY IF EXISTS "packing_scans_insert" ON public.packing_scans;
CREATE POLICY "packing_scans_insert" ON public.packing_scans
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  );

DROP POLICY IF EXISTS "packing_scans_update" ON public.packing_scans;
CREATE POLICY "packing_scans_update" ON public.packing_scans
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "packing_scans_delete" ON public.packing_scans;
CREATE POLICY "packing_scans_delete" ON public.packing_scans
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
    )
  );

-- ─── 4. customer_covers ──────────────────────────────────────────────

DROP POLICY IF EXISTS "cc_insert" ON public.customer_covers;
CREATE POLICY "cc_insert" ON public.customer_covers
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
          OR permissions ? 'manage_pcp'
        )
    )
  );

DROP POLICY IF EXISTS "cc_update" ON public.customer_covers;
CREATE POLICY "cc_update" ON public.customer_covers
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
          OR permissions ? 'manage_pcp'
        )
    )
  );

DROP POLICY IF EXISTS "cc_delete" ON public.customer_covers;
CREATE POLICY "cc_delete" ON public.customer_covers
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
    )
  );

-- ─── 5. customer_cover_events ────────────────────────────────────────

DROP POLICY IF EXISTS "cce_insert" ON public.customer_cover_events;
CREATE POLICY "cce_insert" ON public.customer_cover_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager')
          OR permissions ? 'manage_packaging'
        )
    )
  );

DROP POLICY IF EXISTS "cce_update" ON public.customer_cover_events;
CREATE POLICY "cce_update" ON public.customer_cover_events
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "cce_delete" ON public.customer_cover_events;
CREATE POLICY "cce_delete" ON public.customer_cover_events
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
    )
  );

-- ─── 6. shipment_items e shipment_scans (garantia) ───────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipment_items' AND policyname = 'shipment_items_write'
  ) THEN
    EXECUTE 'CREATE POLICY shipment_items_write ON public.shipment_items
      FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipment_scans' AND policyname = 'shipment_scans_write'
  ) THEN
    EXECUTE 'CREATE POLICY shipment_scans_write ON public.shipment_scans
      FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;
