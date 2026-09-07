-- Cálculo centralizado: cada atualização usa o dia industrial em São Paulo,
-- independentemente do fuso da conexão que executa REFRESH.
CREATE MATERIALIZED VIEW public.oee_tempo_real AS
WITH
Periodo AS (
    SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date AS data_referencia
),
-- Padrão solicitado: um turno de 480 minutos por equipamento por dia.
Tempo_Programado AS (
    SELECT id AS equipamento_id, nome AS equipamento_nome,
           480::numeric AS minutos_programados
    FROM public.equipamentos
),
-- Agrega paradas antes do JOIN com produção, evitando multiplicar durações.
-- Paradas abertas têm duração NULL; só as encerradas entram neste contrato.
Disponibilidade_Data AS (
    SELECT equipamento_id,
           COALESCE(SUM(duracao_minutos), 0::numeric) AS minutos_parados
    FROM public.paradas_equipamento, Periodo
    WHERE inicio >= data_referencia::timestamp AT TIME ZONE 'America/Sao_Paulo'
      AND inicio < (data_referencia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
    GROUP BY equipamento_id
),
-- Cada produto contribui com seu próprio ciclo ideal, em minutos por peça.
Producao_Data AS (
    SELECT a.equipamento_id,
           SUM(a.qte_boa::numeric) AS pecas_boas,
           SUM(a.qte_boa::numeric + a.qte_refugo::numeric) AS total_produzido,
           SUM((a.qte_boa::numeric + a.qte_refugo::numeric) * p.tempo_ciclo_padrao)
               AS minutos_ideais
    FROM public.apontamentos_producao a
    JOIN public.produtos p ON p.id = a.produto_id
    CROSS JOIN Periodo
    WHERE a.data_hora >= data_referencia::timestamp AT TIME ZONE 'America/Sao_Paulo'
      AND a.data_hora < (data_referencia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'
    GROUP BY a.equipamento_id
),
Base AS (
    SELECT tp.*, periodo.data_referencia,
           GREATEST(tp.minutos_programados - COALESCE(dd.minutos_parados, 0), 0)
               AS minutos_operacionais,
           COALESCE(pd.pecas_boas, 0) AS pecas_boas,
           COALESCE(pd.total_produzido, 0) AS total_produzido,
           COALESCE(pd.minutos_ideais, 0) AS minutos_ideais
    FROM Tempo_Programado tp
    CROSS JOIN Periodo
    LEFT JOIN Disponibilidade_Data dd USING (equipamento_id)
    LEFT JOIN Producao_Data pd USING (equipamento_id)
),
-- NULLIF protege todos os divisores; arredondamento ocorre somente na saída.
Fatores AS (
    SELECT *,
           minutos_operacionais / NULLIF(minutos_programados, 0) AS disponibilidade,
           minutos_ideais / NULLIF(minutos_operacionais, 0) AS desempenho,
           pecas_boas / NULLIF(total_produzido, 0) AS qualidade
    FROM Base
)
SELECT equipamento_id, equipamento_nome, data_referencia, minutos_programados,
       total_produzido > 0 AS tem_producao,
       ROUND(COALESCE(disponibilidade, 0) * 100, 2) AS disponibilidade_percentual,
       ROUND(COALESCE(desempenho, 0) * 100, 2) AS desempenho_percentual,
       ROUND(COALESCE(qualidade, 0) * 100, 2) AS qualidade_percentual,
       ROUND(COALESCE(disponibilidade * desempenho * qualidade, 0) * 100, 2)
           AS oee_percentual,
       NOW() AS atualizado_em
FROM Fatores
WITH DATA;

-- Unicidade sem filtro é requisito de REFRESH CONCURRENTLY.
CREATE UNIQUE INDEX uq_oee_tempo_real_equipamento
    ON public.oee_tempo_real (equipamento_id);
REVOKE ALL ON public.oee_tempo_real FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.oee_tempo_real TO mes_api, mes_leitura;
COMMENT ON MATERIALIZED VIEW public.oee_tempo_real IS
    'Snapshot diário com turno fixo de 480min. Sem produção é ausência de medição. Paradas abertas não entram até encerramento. Não agrega entradas legadas sem SKU/ciclo. Percentuais não são limitados artificialmente a 100.';

-- O cron atualiza o snapshot no banco uma vez por minuto; leituras continuam.
-- O refresh inicial já aconteceu em WITH DATA, antes do agendamento concorrente.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
    'atualiza_oee_minuto',
    '* * * * *',
    'REFRESH MATERIALIZED VIEW CONCURRENTLY public.oee_tempo_real;'
);
