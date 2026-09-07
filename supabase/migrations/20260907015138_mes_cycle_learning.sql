-- Aprendizado usa duração de operação medida, nunca intervalo entre INSERTs,
-- leituras RFID, atraso de rede ou tempo de processamento da API.
-- Referências: https://www.postgresql.org/docs/17/functions-aggregate.html
--              https://www.postgresql.org/docs/17/sql-refreshmaterializedview.html

ALTER TABLE public.produtos ALTER COLUMN tempo_ciclo_padrao DROP NOT NULL;
COMMENT ON COLUMN public.produtos.tempo_ciclo_padrao IS
    'Minutos por unidade definidos pela engenharia; NULL quando ainda não existe padrão. O aprendizado não sobrescreve este campo.';

-- O contrato antigo de quatro campos continua aceito. A medição opcional
-- exige intervalo e procedência explícitos, incluindo interrupção/retrabalho.
ALTER TABLE public.apontamentos_producao
    ADD COLUMN inicio_operacao timestamptz,
    ADD COLUMN fim_operacao timestamptz,
    ADD COLUMN origem_tempo text,
    ADD COLUMN teve_interrupcao boolean,
    ADD COLUMN retrabalho boolean,
    ADD CONSTRAINT ck_apontamento_medicao_completa CHECK (
        num_nonnulls(inicio_operacao, fim_operacao, origem_tempo, teve_interrupcao, retrabalho) = 0
        OR (
            num_nonnulls(inicio_operacao, fim_operacao, origem_tempo, teve_interrupcao, retrabalho) = 5
            AND origem_tempo IN ('sensor', 'operador')
            AND isfinite(inicio_operacao) AND isfinite(fim_operacao)
            AND fim_operacao > inicio_operacao AND fim_operacao <= data_hora
            AND (qte_boa::bigint + qte_refugo::bigint) > 0
        )
    );

ALTER TABLE public.historico_operacoes
    ADD COLUMN origem_tempo text,
    ADD COLUMN teve_interrupcao boolean,
    ADD COLUMN retrabalho boolean,
    ADD CONSTRAINT ck_historico_fonte_tempo CHECK (
        num_nonnulls(origem_tempo, teve_interrupcao, retrabalho) = 0
        OR (
            num_nonnulls(origem_tempo, teve_interrupcao, retrabalho) = 3
            AND origem_tempo IN ('sensor', 'operador')
        )
    );
COMMENT ON COLUMN public.historico_operacoes.origem_tempo IS
    'Informar apenas se entrada/saída representam o ciclo completo de uma peça no equipamento. Leituras RFID e tempos de rede não são medição de ciclo.';

-- Um catálogo pequeno permite buscar amostras pelo índice de cada par,
-- sem ordenar novamente todo o histórico industrial a cada minuto.
CREATE TABLE public.ciclo_produto_equipamento (
    equipamento_id uuid NOT NULL REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
    criado_em timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY (equipamento_id, produto_id)
);
CREATE INDEX idx_ciclo_par_produto ON public.ciclo_produto_equipamento (produto_id);

CREATE TABLE public.amostras_ciclo (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipamento_id uuid NOT NULL REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE RESTRICT,
    apontamento_id uuid UNIQUE REFERENCES public.apontamentos_producao(id) ON DELETE CASCADE,
    historico_id uuid UNIQUE REFERENCES public.historico_operacoes(id) ON DELETE CASCADE,
    inicio_operacao timestamptz NOT NULL,
    fim_operacao timestamptz NOT NULL,
    dia_operacional date GENERATED ALWAYS AS ((fim_operacao AT TIME ZONE 'America/Sao_Paulo')::date) STORED,
    quantidade bigint NOT NULL CHECK (quantidade > 0),
    origem_tempo text NOT NULL CHECK (origem_tempo IN ('sensor', 'operador')),
    ciclo_minutos numeric GENERATED ALWAYS AS (
        EXTRACT(epoch FROM (fim_operacao - inicio_operacao)) / (60.0 * quantidade)
    ) STORED,
    criado_em timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_amostra_origem_unica CHECK (num_nonnulls(apontamento_id, historico_id) = 1),
    CONSTRAINT ck_amostra_intervalo CHECK (
        isfinite(inicio_operacao) AND isfinite(fim_operacao) AND fim_operacao > inicio_operacao
    )
);
CREATE INDEX idx_amostras_ciclo_par_dia
    ON public.amostras_ciclo (equipamento_id, produto_id, dia_operacional, fim_operacao DESC, id)
    INCLUDE (ciclo_minutos, inicio_operacao);
CREATE INDEX idx_amostras_ciclo_produto ON public.amostras_ciclo (produto_id);
COMMENT ON TABLE public.amostras_ciclo IS
    'Amostras derivadas de operações aprovadas, sem refugo, retrabalho ou interrupção declarados. Uma linha por apontamento ou histórico; lote usa sua quantidade explícita, histórico representa uma peça. Fontes distintas não devem representar a mesma operação física.';

-- Só o trigger deriva amostras: clientes não escrevem ciclos calculados.
CREATE FUNCTION public.mes_sincronizar_amostra_ciclo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
    v_produto uuid;
    v_quantidade bigint;
    v_inicio timestamptz;
    v_fim timestamptz;
    v_aprovada boolean;
BEGIN
    IF TG_TABLE_NAME = 'apontamentos_producao' THEN
        v_produto := NEW.produto_id;
        v_quantidade := NEW.qte_boa::bigint + NEW.qte_refugo::bigint;
        v_inicio := NEW.inicio_operacao;
        v_fim := NEW.fim_operacao;
        v_aprovada := NEW.qte_refugo = 0;
    ELSE
        SELECT produto_id INTO STRICT v_produto
        FROM public.rastreabilidade_pecas WHERE id = NEW.rastreabilidade_id;
        v_quantidade := 1;
        v_inicio := NEW.data_hora_entrada;
        v_fim := NEW.data_hora_saida;
        v_aprovada := NEW.aprovado IS TRUE;
    END IF;

    INSERT INTO public.ciclo_produto_equipamento (equipamento_id, produto_id)
    VALUES (NEW.equipamento_id, v_produto) ON CONFLICT DO NOTHING;

    IF NEW.origem_tempo IS NOT NULL AND v_fim > clock_timestamp() THEN
        RAISE EXCEPTION 'O fim da operação medida não pode estar no futuro' USING ERRCODE = '23514';
    END IF;

    -- Revalida correções posteriores: uma amostra antes válida pode deixar
    -- de ser válida. Não acumulamos versões duplicadas da mesma medição.
    IF NEW.origem_tempo IS NOT NULL AND NEW.teve_interrupcao IS FALSE
       AND NEW.retrabalho IS FALSE AND v_aprovada AND v_quantidade > 0
       AND v_fim > v_inicio THEN
        IF TG_TABLE_NAME = 'apontamentos_producao' THEN
            INSERT INTO public.amostras_ciclo (
                equipamento_id, produto_id, apontamento_id, inicio_operacao,
                fim_operacao, quantidade, origem_tempo
            ) VALUES (NEW.equipamento_id, v_produto, NEW.id, v_inicio,
                      v_fim, v_quantidade, NEW.origem_tempo)
            ON CONFLICT (apontamento_id) DO UPDATE SET
                equipamento_id = EXCLUDED.equipamento_id, produto_id = EXCLUDED.produto_id,
                inicio_operacao = EXCLUDED.inicio_operacao, fim_operacao = EXCLUDED.fim_operacao,
                quantidade = EXCLUDED.quantidade, origem_tempo = EXCLUDED.origem_tempo;
        ELSE
            INSERT INTO public.amostras_ciclo (
                equipamento_id, produto_id, historico_id, inicio_operacao,
                fim_operacao, quantidade, origem_tempo
            ) VALUES (NEW.equipamento_id, v_produto, NEW.id, v_inicio,
                      v_fim, v_quantidade, NEW.origem_tempo)
            ON CONFLICT (historico_id) DO UPDATE SET
                equipamento_id = EXCLUDED.equipamento_id, produto_id = EXCLUDED.produto_id,
                inicio_operacao = EXCLUDED.inicio_operacao, fim_operacao = EXCLUDED.fim_operacao,
                quantidade = EXCLUDED.quantidade, origem_tempo = EXCLUDED.origem_tempo;
        END IF;
    ELSIF TG_TABLE_NAME = 'apontamentos_producao' THEN
        DELETE FROM public.amostras_ciclo WHERE apontamento_id = NEW.id;
    ELSE
        DELETE FROM public.amostras_ciclo WHERE historico_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mes_sincronizar_amostra_ciclo() FROM PUBLIC, anon, authenticated, mes_api, mes_leitura;
CREATE TRIGGER trg_apontamento_amostra_ciclo
    AFTER INSERT OR UPDATE ON public.apontamentos_producao
    FOR EACH ROW EXECUTE FUNCTION public.mes_sincronizar_amostra_ciclo();
CREATE TRIGGER trg_historico_amostra_ciclo
    AFTER INSERT OR UPDATE ON public.historico_operacoes
    FOR EACH ROW EXECUTE FUNCTION public.mes_sincronizar_amostra_ciclo();

-- A correção da identidade de uma peça também corrige suas amostras.
CREATE FUNCTION public.mes_corrigir_produto_amostras()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.produto_id IS DISTINCT FROM OLD.produto_id THEN
        INSERT INTO public.ciclo_produto_equipamento (equipamento_id, produto_id)
        SELECT DISTINCT h.equipamento_id, NEW.produto_id
        FROM public.historico_operacoes h WHERE h.rastreabilidade_id = NEW.id
        ON CONFLICT DO NOTHING;
        UPDATE public.amostras_ciclo a SET produto_id = NEW.produto_id
        FROM public.historico_operacoes h
        WHERE a.historico_id = h.id AND h.rastreabilidade_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mes_corrigir_produto_amostras() FROM PUBLIC, anon, authenticated, mes_api, mes_leitura;
CREATE TRIGGER trg_rastreabilidade_produto_amostras
    AFTER UPDATE OF produto_id ON public.rastreabilidade_pecas
    FOR EACH ROW EXECUTE FUNCTION public.mes_corrigir_produto_amostras();

INSERT INTO public.ciclo_produto_equipamento (equipamento_id, produto_id)
SELECT equipamento_id, produto_id FROM public.apontamentos_producao
UNION
SELECT h.equipamento_id, r.produto_id
FROM public.historico_operacoes h JOIN public.rastreabilidade_pecas r ON r.id = h.rastreabilidade_id
ON CONFLICT DO NOTHING;

ALTER TABLE public.ciclo_produto_equipamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amostras_ciclo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ciclo_produto_equipamento, public.amostras_ciclo FROM PUBLIC, anon, authenticated, mes_api, mes_leitura;

-- Uma mediana resiste a valores extremos isolados. A janela contém os últimos
-- 30 dias industriais e, em cada dia/par, no máximo as 100 amostras mais recentes.
-- Limiares de implantação: 20 operações válidas em pelo menos 3 dias distintos.
-- Não são certificação estatística nem substituem um ciclo ideal de engenharia.
CREATE MATERIALIZED VIEW public.ciclos_observados AS
WITH Dias AS (
    SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - n AS dia
    FROM generate_series(0, 29) AS g(n)
), Amostras_Recentes AS (
    SELECT par.equipamento_id, par.produto_id, amostra.*
    FROM public.ciclo_produto_equipamento par
    CROSS JOIN Dias d
    CROSS JOIN LATERAL (
        SELECT a.id, a.ciclo_minutos, a.dia_operacional, a.fim_operacao
        FROM (
            SELECT candidate.* FROM public.amostras_ciclo candidate
            WHERE candidate.equipamento_id = par.equipamento_id
              AND candidate.produto_id = par.produto_id
              AND candidate.dia_operacional = d.dia AND candidate.fim_operacao <= NOW()
            ORDER BY candidate.fim_operacao DESC, candidate.id
            LIMIT 100
        ) a
        WHERE
          -- Não aprender tempos que atravessam uma parada já registrada,
          -- mesmo que a interrupção não tenha sido marcada na coleta.
          NOT EXISTS (
              SELECT 1 FROM public.paradas_equipamento p
              WHERE p.equipamento_id = a.equipamento_id
                AND p.inicio < a.fim_operacao
                AND COALESCE(p.fim, 'infinity'::timestamptz) > a.inicio_operacao
          )
    ) amostra
), Estatisticas AS (
    SELECT equipamento_id, produto_id, count(*) AS quantidade_amostras,
           count(DISTINCT dia_operacional) AS dias_observados,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ciclo_minutos)::numeric AS ciclo_mediano_minutos,
           max(fim_operacao) AS ultima_amostra_em
    FROM Amostras_Recentes GROUP BY equipamento_id, produto_id
)
SELECT par.equipamento_id, par.produto_id,
       COALESCE(e.quantidade_amostras, 0) AS quantidade_amostras,
       COALESCE(e.dias_observados, 0) AS dias_observados,
       e.ciclo_mediano_minutos,
       CASE WHEN e.quantidade_amostras >= 20 AND e.dias_observados >= 3
            THEN e.ciclo_mediano_minutos END AS ciclo_estimado_minutos,
       CASE WHEN e.quantidade_amostras >= 20 AND e.dias_observados >= 3
            THEN 'estimado' ELSE 'aprendendo' END AS estado_aprendizado,
       e.ultima_amostra_em, NOW() AS atualizado_em
FROM public.ciclo_produto_equipamento par
LEFT JOIN Estatisticas e USING (equipamento_id, produto_id)
WITH DATA;
CREATE UNIQUE INDEX uq_ciclos_observados_par
    ON public.ciclos_observados (equipamento_id, produto_id);
REVOKE ALL ON public.ciclos_observados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ciclos_observados TO mes_api, mes_leitura;
COMMENT ON MATERIALIZED VIEW public.ciclos_observados IS
    'Referência observada por equipamento/produto: mediana de até 100 operações por dia nos últimos 30 dias industriais; exige 20 amostras em 3 dias. É estimativa, não tempo ideal confirmado.';

-- Recria o snapshot no mesmo contrato e acrescenta o estado do aprendizado.
-- A migration deve ser aplicada em transação; nenhum dado de produção é apagado.
DROP MATERIALIZED VIEW public.oee_tempo_real;
CREATE MATERIALIZED VIEW public.oee_tempo_real AS
WITH Periodo AS (
    SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS data_referencia
), Tempo_Programado AS (
    SELECT id AS equipamento_id, nome AS equipamento_nome, 480::numeric AS minutos_programados
    FROM public.equipamentos
), Disponibilidade_Data AS (
    SELECT equipamento_id, COALESCE(SUM(duracao_minutos), 0::numeric) AS minutos_parados
    FROM public.paradas_equipamento, Periodo
    WHERE inicio >= data_referencia::timestamp AT TIME ZONE 'America/Sao_Paulo'
      AND inicio < (data_referencia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
    GROUP BY equipamento_id
), Producao_Por_Produto AS (
    SELECT a.equipamento_id, a.produto_id, SUM(a.qte_boa::numeric) AS pecas_boas,
           SUM(a.qte_boa::numeric + a.qte_refugo::numeric) AS total_produzido
    FROM public.apontamentos_producao a CROSS JOIN Periodo
    WHERE a.data_hora >= data_referencia::timestamp AT TIME ZONE 'America/Sao_Paulo'
      AND a.data_hora < (data_referencia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
    GROUP BY a.equipamento_id, a.produto_id
), Referencias AS (
    SELECT pp.*, COALESCE(p.tempo_ciclo_padrao, c.ciclo_estimado_minutos) AS ciclo_referencia,
           p.tempo_ciclo_padrao IS NULL AND c.ciclo_estimado_minutos IS NOT NULL AS estimado
    FROM Producao_Por_Produto pp
    JOIN public.produtos p ON p.id = pp.produto_id
    LEFT JOIN public.ciclos_observados c USING (equipamento_id, produto_id)
), Producao_Data AS (
    SELECT equipamento_id, SUM(pecas_boas) AS pecas_boas, SUM(total_produzido) AS total_produzido,
           SUM(total_produzido * ciclo_referencia) AS minutos_referencia,
           SUM(CASE WHEN ciclo_referencia IS NOT NULL THEN total_produzido ELSE 0 END) AS quantidade_com_ciclo,
           BOOL_OR(estimado AND total_produzido > 0) AS referencia_estimada,
           COUNT(*) FILTER (WHERE ciclo_referencia IS NULL AND total_produzido > 0) AS produtos_em_aprendizado
    FROM Referencias GROUP BY equipamento_id
), Base AS (
    SELECT tp.*, periodo.data_referencia,
           GREATEST(tp.minutos_programados - COALESCE(dd.minutos_parados, 0), 0) AS minutos_operacionais,
           COALESCE(pd.pecas_boas, 0) AS pecas_boas,
           COALESCE(pd.total_produzido, 0) AS total_produzido,
           pd.minutos_referencia, COALESCE(pd.quantidade_com_ciclo, 0) AS quantidade_com_ciclo,
           COALESCE(pd.referencia_estimada, false) AS referencia_estimada,
           COALESCE(pd.produtos_em_aprendizado, 0) AS produtos_em_aprendizado
    FROM Tempo_Programado tp CROSS JOIN Periodo
    LEFT JOIN Disponibilidade_Data dd USING (equipamento_id)
    LEFT JOIN Producao_Data pd USING (equipamento_id)
), Fatores AS (
    SELECT *, minutos_operacionais / NULLIF(minutos_programados, 0) AS disponibilidade,
           CASE WHEN total_produzido > 0 AND quantidade_com_ciclo = total_produzido
                THEN COALESCE(minutos_referencia / NULLIF(minutos_operacionais, 0), 0) END AS desempenho,
           pecas_boas / NULLIF(total_produzido, 0) AS qualidade
    FROM Base
)
SELECT equipamento_id, equipamento_nome, data_referencia, minutos_programados,
       total_produzido > 0 AS tem_producao,
       ROUND(COALESCE(disponibilidade, 0) * 100, 2) AS disponibilidade_percentual,
       ROUND(desempenho * 100, 2) AS desempenho_percentual,
       ROUND(COALESCE(qualidade, 0) * 100, 2) AS qualidade_percentual,
       ROUND(disponibilidade * desempenho * qualidade * 100, 2) AS oee_percentual,
       NOW() AS atualizado_em,
       CASE WHEN total_produzido = 0 THEN 'sem_producao'
            WHEN quantidade_com_ciclo < total_produzido THEN 'aprendendo'
            WHEN referencia_estimada THEN 'estimado' ELSE 'padrao' END AS estado_ciclo,
       ROUND(quantidade_com_ciclo / NULLIF(total_produzido, 0) * 100, 2) AS cobertura_ciclo_percentual,
       referencia_estimada, produtos_em_aprendizado
FROM Fatores WITH DATA;
CREATE UNIQUE INDEX uq_oee_tempo_real_equipamento ON public.oee_tempo_real (equipamento_id);
REVOKE ALL ON public.oee_tempo_real FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oee_tempo_real TO mes_api, mes_leitura;
COMMENT ON MATERIALIZED VIEW public.oee_tempo_real IS
    'OEE diário, turno fixo de 480min, São Paulo. Usa padrão explícito ou referência observada sinalizada como estimada. Sem cobertura integral de ciclos, desempenho/OEE ficam NULL. Paradas abertas não entram até encerramento. Não converte metros/chapas nem tempos de RFID em ciclos de peças.';

-- Agendamento: aprendizado e OEE são atualizados na ordem, uma vez por minuto.
-- Leituras normais continuam disponíveis durante ambos os REFRESH CONCURRENTLY.
SELECT cron.schedule('atualiza_oee_minuto', '* * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY public.ciclos_observados; REFRESH MATERIALIZED VIEW CONCURRENTLY public.oee_tempo_real;');
