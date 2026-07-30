-- ============================================================
-- AC.Prod MES — Tabelas, RPCs e Políticas para Etiquetas & Relatórios de Reposição
-- Migration 20260730120000
-- ============================================================

-- 1. Tabela de Modelos de Etiquetas (label_templates)
CREATE TABLE IF NOT EXISTS public.label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  width_mm numeric(6,2) NOT NULL DEFAULT 100.00,
  height_mm numeric(6,2) NOT NULL DEFAULT 50.00,
  orientation text NOT NULL DEFAULT 'landscape',
  margin_top_mm numeric(4,2) NOT NULL DEFAULT 2.00,
  margin_right_mm numeric(4,2) NOT NULL DEFAULT 2.00,
  margin_bottom_mm numeric(4,2) NOT NULL DEFAULT 2.00,
  margin_left_mm numeric(4,2) NOT NULL DEFAULT 2.00,
  layout_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  barcode_config jsonb NOT NULL DEFAULT '{"symbology":"code128","height_mm":12,"dpi":203}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Inserção dos modelos padrão caso não existam
INSERT INTO public.label_templates (name, width_mm, height_mm, orientation, is_default, layout_config)
SELECT 'Reposição Promob 100 × 50 mm', 100.00, 50.00, 'landscape', true, '{"type":"promob_standard"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.label_templates WHERE name = 'Reposição Promob 100 × 50 mm');

INSERT INTO public.label_templates (name, width_mm, height_mm, orientation, is_default, layout_config)
SELECT 'Reposição Promob 100 × 70 mm', 100.00, 70.00, 'landscape', false, '{"type":"promob_expanded"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.label_templates WHERE name = 'Reposição Promob 100 × 70 mm');

INSERT INTO public.label_templates (name, width_mm, height_mm, orientation, is_default, layout_config)
SELECT 'Reposição Compacta 80 × 50 mm', 80.00, 50.00, 'landscape', false, '{"type":"compact_80x50"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.label_templates WHERE name = 'Reposição Compacta 80 × 50 mm');

INSERT INTO public.label_templates (name, width_mm, height_mm, orientation, is_default, layout_config)
SELECT 'Reposição Compacta 60 × 40 mm', 60.00, 40.00, 'landscape', false, '{"type":"compact_60x40"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.label_templates WHERE name = 'Reposição Compacta 60 × 40 mm');

INSERT INTO public.label_templates (name, width_mm, height_mm, orientation, is_default, layout_config)
SELECT 'Folha A4 Multi-Etiquetas', 210.00, 297.00, 'portrait', false, '{"type":"a4_sheet","rows":5,"cols":2}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.label_templates WHERE name = 'Folha A4 Multi-Etiquetas');

-- 2. Tabela de Registro de Etiquetas de Reposição (replacement_labels)
CREATE TABLE IF NOT EXISTS public.replacement_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  replacement_request_id uuid REFERENCES public.replacement_orders(id) ON DELETE CASCADE,
  replacement_piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  original_piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  promob_original_code text,
  replacement_trace_code text NOT NULL,
  template_id uuid REFERENCES public.label_templates(id) ON DELETE SET NULL,
  print_status text NOT NULL DEFAULT 'pending',
  copies integer NOT NULL DEFAULT 1,
  current_copy_number integer NOT NULL DEFAULT 0,
  last_printed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_replacement_labels_trace_code UNIQUE (replacement_trace_code)
);

-- 3. Tabela de Impressões e Reimpressões (replacement_label_prints)
CREATE TABLE IF NOT EXISTS public.replacement_label_prints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_id uuid REFERENCES public.replacement_labels(id) ON DELETE CASCADE,
  replacement_request_id uuid REFERENCES public.replacement_orders(id) ON DELETE CASCADE,
  replacement_piece_id uuid REFERENCES public.production_pieces(id) ON DELETE SET NULL,
  print_sequence integer NOT NULL DEFAULT 1,
  copy_number integer NOT NULL DEFAULT 1,
  is_reprint boolean NOT NULL DEFAULT false,
  reprint_reason text,
  reprint_reason_details text,
  printer_name text DEFAULT 'Padrão do Sistema / Navegador',
  printed_by uuid,
  printed_by_name text,
  printed_at timestamptz NOT NULL DEFAULT now(),
  device_information text,
  client_event_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Tabela de Relatórios Exportados em PDF (replacement_report_exports)
CREATE TABLE IF NOT EXISTS public.replacement_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code text NOT NULL UNIQUE,
  report_type text NOT NULL DEFAULT 'filtered',
  filters jsonb DEFAULT '{}'::jsonb,
  replacement_ids uuid[] DEFAULT '{}',
  file_path text,
  generated_by uuid,
  generated_by_name text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  checksum text,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para otimização de consultas
CREATE INDEX IF NOT EXISTS idx_repl_labels_req ON public.replacement_labels(replacement_request_id);
CREATE INDEX IF NOT EXISTS idx_repl_labels_trace ON public.replacement_labels(replacement_trace_code);
CREATE INDEX IF NOT EXISTS idx_repl_prints_req ON public.replacement_label_prints(replacement_request_id);
CREATE INDEX IF NOT EXISTS idx_repl_prints_label ON public.replacement_label_prints(label_id);
CREATE INDEX IF NOT EXISTS idx_repl_reports_code ON public.replacement_report_exports(report_code);
CREATE INDEX IF NOT EXISTS idx_repl_reports_date ON public.replacement_report_exports(generated_at DESC);

-- Habilitar RLS
ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replacement_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replacement_label_prints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replacement_report_exports ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS permissivas para usuários autenticados e serviço
DROP POLICY IF EXISTS "Permitir leitura de templates" ON public.label_templates;
CREATE POLICY "Permitir leitura de templates" ON public.label_templates
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "Permitir escrita de templates para autenticados" ON public.label_templates;
CREATE POLICY "Permitir escrita de templates para autenticados" ON public.label_templates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso geral a replacement_labels" ON public.replacement_labels;
CREATE POLICY "Permitir acesso geral a replacement_labels" ON public.replacement_labels
  FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso geral a replacement_label_prints" ON public.replacement_label_prints;
CREATE POLICY "Permitir acesso geral a replacement_label_prints" ON public.replacement_label_prints
  FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso geral a replacement_report_exports" ON public.replacement_report_exports;
CREATE POLICY "Permitir acesso geral a replacement_report_exports" ON public.replacement_report_exports
  FOR ALL TO authenticated, anon USING (true) WITH CHECK (true);

-- RPC para registrar impressão de etiqueta com controle de via e auditoria
CREATE OR REPLACE FUNCTION public.register_replacement_label_print(
  p_replacement_request_id uuid,
  p_reprint_reason text DEFAULT NULL,
  p_reprint_reason_details text DEFAULT NULL,
  p_printer_name text DEFAULT 'Impressora Padrão',
  p_user_name text DEFAULT 'Operador MES',
  p_client_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order record;
  v_orig_piece record;
  v_repl_piece record;
  v_label record;
  v_trace_code text;
  v_orig_code text;
  v_print_count integer := 0;
  v_is_reprint boolean := false;
  v_print_id uuid;
  v_label_id uuid;
  v_template_id uuid;
BEGIN
  -- 1. Buscar Ordem de Reposição
  SELECT * INTO v_order FROM public.replacement_orders WHERE id = p_replacement_request_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ordem de reposição não encontrada.');
  END IF;

  -- 2. Validar se a reposição está aprovada ou posterior
  IF v_order.status IN ('requested', 'under_review', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Etiqueta não liberada para impressão. A reposição precisa estar APROVADA.');
  END IF;

  -- 3. Obter Peça Original
  IF v_order.original_piece_id IS NOT NULL THEN
    SELECT * INTO v_orig_piece FROM public.production_pieces WHERE id = v_order.original_piece_id;
  END IF;

  -- 4. Obter Peça Substituta
  IF v_order.replacement_piece_id IS NOT NULL THEN
    SELECT * INTO v_repl_piece FROM public.production_pieces WHERE id = v_order.replacement_piece_id;
  END IF;

  -- Determinar códigos de rastreio e Promob
  v_orig_code := COALESCE(v_orig_piece.promob_barcode, v_orig_piece.piece_code, v_orig_piece.traceability_code, '00000000');
  
  IF v_repl_piece.id IS NOT NULL THEN
    v_trace_code := COALESCE(v_repl_piece.traceability_code, v_repl_piece.piece_uid, v_orig_code || '-REP-R01');
  ELSE
    v_trace_code := v_orig_code || '-REP-R01';
  END IF;

  -- Obter modelo padrão
  SELECT id INTO v_template_id FROM public.label_templates WHERE is_default = true LIMIT 1;

  -- 5. Localizar ou criar registro em replacement_labels
  SELECT * INTO v_label FROM public.replacement_labels WHERE replacement_request_id = p_replacement_request_id;
  
  IF v_label.id IS NULL THEN
    INSERT INTO public.replacement_labels (
      replacement_request_id,
      replacement_piece_id,
      original_piece_id,
      promob_original_code,
      replacement_trace_code,
      template_id,
      print_status,
      current_copy_number,
      last_printed_at
    ) VALUES (
      p_replacement_request_id,
      v_order.replacement_piece_id,
      v_order.original_piece_id,
      v_orig_code,
      v_trace_code,
      v_template_id,
      'printed',
      1,
      now()
    ) RETURNING * INTO v_label;
    
    v_print_count := 1;
    v_is_reprint := false;
  ELSE
    v_print_count := COALESCE(v_label.current_copy_number, 0) + 1;
    v_is_reprint := (v_print_count > 1);

    IF v_is_reprint AND (p_reprint_reason IS NULL OR trim(p_reprint_reason) = '') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Toda reimpressão (2ª via em diante) exige motivo obrigatório.');
    END IF;

    UPDATE public.replacement_labels
    SET current_copy_number = v_print_count,
        print_status = 'printed',
        last_printed_at = now(),
        updated_at = now()
    WHERE id = v_label.id
    RETURNING * INTO v_label;
  END IF;

  -- 6. Registrar a impressão na tabela auditável replacement_label_prints
  INSERT INTO public.replacement_label_prints (
    label_id,
    replacement_request_id,
    replacement_piece_id,
    print_sequence,
    copy_number,
    is_reprint,
    reprint_reason,
    reprint_reason_details,
    printer_name,
    printed_by,
    printed_by_name,
    printed_at,
    client_event_id
  ) VALUES (
    v_label.id,
    p_replacement_request_id,
    v_order.replacement_piece_id,
    v_print_count,
    v_print_count,
    v_is_reprint,
    p_reprint_reason,
    p_reprint_reason_details,
    p_printer_name,
    v_user_id,
    p_user_name,
    now(),
    p_client_event_id
  ) RETURNING id INTO v_print_id;

  RETURN jsonb_build_object(
    'success', true,
    'print_id', v_print_id,
    'label_id', v_label.id,
    'copy_number', v_print_count,
    'is_reprint', v_is_reprint,
    'via_label', CASE WHEN v_print_count = 1 THEN '1ª VIA' ELSE v_print_count || 'ª VIA' END,
    'replacement_trace_code', v_trace_code
  );
END;
$$;
