-- ============================================================
-- AC.Prod — Script de Seed de Dados de Teste
-- Gerado em: 2026-06-06
-- 5 células, 10 dias, 3 turnos, ~8h/turno
-- ============================================================

-- ── 1. Inserir Células ───────────────────────────────────────
INSERT INTO public.cells (name, description, active, notes, shift_hours)
VALUES
  ('Célula A', 'Linha de montagem alpha', true, '', '{"shift1": 8, "shift2": 8, "shift3": 6}'::jsonb),
  ('Célula B', 'Linha de montagem beta',  true, '', '{"shift1": 8, "shift2": 8, "shift3": 6}'::jsonb),
  ('Célula C', 'Fresagem CNC',            true, '', '{"shift1": 8, "shift2": 8, "shift3": 0}'::jsonb),
  ('Célula D', 'Soldagem MIG',            true, '', '{"shift1": 8, "shift2": 8, "shift3": 6}'::jsonb),
  ('Célula E', 'Acabamento e pintura',    true, '', '{"shift1": 8, "shift2": 8, "shift3": 0}'::jsonb)
ON CONFLICT DO NOTHING;

-- ── 2. Metas Diárias (daily_goals) ──────────────────────────
-- Formato: date, shift, cell, target (peças/turno), hours
INSERT INTO public.daily_goals (date, shift, cell, target, hours)
SELECT
  (CURRENT_DATE - s.n)::date AS date,
  sh.shift,
  c.cell,
  c.target,
  8 AS hours
FROM generate_series(0, 9) AS s(n)
CROSS JOIN (VALUES
  ('1º Turno'), ('2º Turno'), ('3º Turno')
) AS sh(shift)
CROSS JOIN (VALUES
  ('Célula A', 400),
  ('Célula B', 360),
  ('Célula C', 480),
  ('Célula D', 320),
  ('Célula E', 440)
) AS c(cell, target)
-- Célula C e E não têm 3º turno
WHERE NOT (sh.shift = '3º Turno' AND c.cell IN ('Célula C', 'Célula E'))
ON CONFLICT (date, shift, cell) DO NOTHING;

-- ── 3. Entradas de Produção (production_entries) ────────────
-- Cria entradas por hora com variações realistas de eficiência
DO $$
DECLARE
  v_date    DATE;
  v_shift   TEXT;
  v_cell    TEXT;
  v_hour    TEXT;
  v_target  INT;
  v_eff     NUMERIC;
  v_produced INT;
  v_scrap   INT;
  v_downtime INT;
  v_reason  TEXT;
  
  shifts TEXT[] := ARRAY['1º Turno', '2º Turno', '3º Turno'];
  
  -- Horas por turno
  hours_shift1 TEXT[] := ARRAY['6','7','8','9','10','11','12','13'];
  hours_shift2 TEXT[] := ARRAY['14','15','16','17','18','19','20','21'];
  hours_shift3 TEXT[] := ARRAY['22','23','0','1','2','3','4','5'];
  
  -- Perfil de eficiência por célula: (média, variância)
  -- A=92±8, B=78±15, C=85±10, D=65±20, E=95±5
  cells_data TEXT[][] := ARRAY[
    ARRAY['Célula A', '50', '92', '8'],
    ARRAY['Célula B', '45', '78', '15'],
    ARRAY['Célula C', '60', '85', '10'],
    ARRAY['Célula D', '40', '65', '20'],
    ARRAY['Célula E', '55', '95', '5']
  ];
  
  downtime_reasons TEXT[] := ARRAY[
    'Setup de máquina',
    'Manutenção preventiva',
    'Falta de material',
    'Ajuste de processo',
    'Troca de ferramenta',
    'Quebra de equipamento',
    'Pausa programada'
  ];
  
  n_days    INT := 10;
  i_day     INT;
  i_shift   INT;
  i_cell    INT;
  i_hour    INT;
  n_hours   INT;
  cur_hours TEXT[];
  base_eff  NUMERIC;
  variance  NUMERIC;
  base_tgt  INT;
  hour_idx  INT;
BEGIN
  FOR i_day IN 0..n_days-1 LOOP
    v_date := CURRENT_DATE - i_day;
    
    FOR i_shift IN 1..3 LOOP
      v_shift := shifts[i_shift];
      
      -- Define as horas do turno
      IF i_shift = 1 THEN cur_hours := hours_shift1;
      ELSIF i_shift = 2 THEN cur_hours := hours_shift2;
      ELSE cur_hours := hours_shift3;
      END IF;
      
      FOR i_cell IN 1..array_length(cells_data, 1) LOOP
        v_cell    := cells_data[i_cell][1];
        base_tgt  := cells_data[i_cell][2]::INT;
        base_eff  := cells_data[i_cell][3]::NUMERIC;
        variance  := cells_data[i_cell][4]::NUMERIC;
        
        -- Células C e E não têm 3º turno
        IF i_shift = 3 AND v_cell IN ('Célula C', 'Célula E') THEN
          CONTINUE;
        END IF;
        
        -- Número de horas ativas (5 a 8)
        n_hours := 5 + floor(random() * 4)::INT;
        
        FOR i_hour IN 1..n_hours LOOP
          v_hour := cur_hours[i_hour];
          hour_idx := i_hour;
          
          -- Eficiência com padrão realista:
          -- Início do turno: -10%, segunda hora: -5%, final do turno: -5%
          v_eff := base_eff;
          IF hour_idx = 1 THEN v_eff := v_eff - 10;
          ELSIF hour_idx = 2 THEN v_eff := v_eff - 5;
          ELSIF hour_idx = n_hours THEN v_eff := v_eff - 5;
          END IF;
          
          -- Variação aleatória
          v_eff := v_eff + (random() - 0.5) * variance * 2;
          
          -- Clamp entre 30% e 110%
          v_eff := GREATEST(30, LEAST(110, v_eff));
          
          -- Alvo por hora com pequena variação
          v_target := base_tgt + floor((random() - 0.5) * 10)::INT;
          
          -- Produção efetiva
          v_produced := GREATEST(0, round((v_target * v_eff / 100))::INT);
          
          -- Refugo: maior quando eficiência baixa
          IF v_eff < 60 THEN
            v_scrap := floor(random() * 8 + 2)::INT;
          ELSIF v_eff < 80 THEN
            v_scrap := floor(random() * 4)::INT;
          ELSE
            v_scrap := floor(random() * 2)::INT;
          END IF;
          
          -- Parada (downtime em minutos)
          IF v_eff < 60 THEN
            v_downtime := floor(random() * 25 + 10)::INT;
          ELSIF v_eff < 75 THEN
            v_downtime := floor(random() * 12)::INT;
          ELSE
            v_downtime := 0;
          END IF;
          
          -- Motivo da parada
          IF v_downtime > 0 THEN
            v_reason := downtime_reasons[floor(random() * array_length(downtime_reasons, 1) + 1)::INT];
          ELSE
            v_reason := NULL;
          END IF;
          
          INSERT INTO public.production_entries (date, shift, cell, hour, produced, target, scrap, downtime, operator, notes)
          VALUES (
            v_date,
            v_shift,
            v_cell,
            v_hour,
            v_produced,
            v_target,
            v_scrap,
            v_downtime,
            'Operador ' || (floor(random() * 5 + 1)::INT)::TEXT,
            v_reason
          );
        END LOOP; -- horas
      END LOOP; -- células
    END LOOP; -- turnos
  END LOOP; -- dias
  
  RAISE NOTICE 'Seed concluído com sucesso!';
END $$;
