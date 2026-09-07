
-- PostgreSQL 14+: UUIDs gerados pelo banco, sem extensões adicionais.
-- [UUID no PostgreSQL](https://www.postgresql.org/docs/17/functions-uuid.html)
-- TIMESTAMPTZ representa instantes independentemente do fuso da conexão.
-- DEFAULT NOW() usa o início da transação; eventos atrasados podem informar seu horário original.

-- 1. Cadastros mestres.

CREATE TABLE public.produtos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT NOT NULL UNIQUE CHECK (btrim(sku) <> ''),
    descricao TEXT NOT NULL,
    tempo_ciclo_padrao NUMERIC(12,6) NOT NULL,
    CONSTRAINT ck_produtos_ciclo_valido CHECK (
        tempo_ciclo_padrao > 0
        AND tempo_ciclo_padrao <> 'NaN'::NUMERIC
    )
);

COMMENT ON COLUMN public.produtos.tempo_ciclo_padrao IS
    'Tempo de ciclo padrão por unidade, em minutos.';

CREATE TABLE public.equipamentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL CHECK (btrim(nome) <> ''),
    celula_linha TEXT NOT NULL CHECK (btrim(celula_linha) <> ''),
    status_atual TEXT NOT NULL CHECK (btrim(status_atual) <> '')
);

CREATE TABLE public.motivos_parada (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_falha TEXT NOT NULL UNIQUE CHECK (btrim(codigo_falha) <> ''),
    descricao TEXT NOT NULL,
    tipo TEXT NOT NULL,
    CONSTRAINT ck_motivos_parada_tipo CHECK (
        tipo IN ('Planejada', 'Não Planejada')
    )
);

-- 2. Apontamentos: contagens por evento ou lote, sem valores negativos.
-- RESTRICT preserva os vínculos com os cadastros usados no histórico.

CREATE TABLE public.apontamentos_producao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipamento_id UUID NOT NULL
        REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    produto_id UUID NOT NULL
        REFERENCES public.produtos(id) ON DELETE RESTRICT,
    qte_boa INTEGER NOT NULL DEFAULT 0 CHECK (qte_boa >= 0),
    qte_refugo INTEGER NOT NULL DEFAULT 0 CHECK (qte_refugo >= 0),
    data_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_apontamentos_data_finita CHECK (isfinite(data_hora))
);

-- A coluna gerada é recalculada ao alterar inicio ou fim.
-- [Colunas geradas no PostgreSQL](https://www.postgresql.org/docs/17/ddl-generated-columns.html)
CREATE TABLE public.paradas_equipamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipamento_id UUID NOT NULL
        REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    motivo_id UUID NOT NULL
        REFERENCES public.motivos_parada(id) ON DELETE RESTRICT,
    inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fim TIMESTAMPTZ,
    duracao_minutos NUMERIC(16,6) GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (fim - inicio)) / 60.0
    ) STORED,
    CONSTRAINT ck_paradas_inicio_finito CHECK (isfinite(inicio)),
    CONSTRAINT ck_paradas_intervalo CHECK (
        fim IS NULL OR (isfinite(fim) AND fim >= inicio)
    )
);

COMMENT ON COLUMN public.paradas_equipamento.duracao_minutos IS
    'Duração calculada em minutos; NULL enquanto a parada estiver aberta. Omitir em INSERT/UPDATE.';

-- 3. Rastreabilidade e operações.

CREATE TABLE public.rastreabilidade_pecas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_serial_rfid VARCHAR(255) NOT NULL
        CHECK (btrim(codigo_serial_rfid) <> ''),
    produto_id UUID NOT NULL
        REFERENCES public.produtos(id) ON DELETE RESTRICT,
    ordem_producao_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (btrim(status) <> '')
);

COMMENT ON COLUMN public.rastreabilidade_pecas.ordem_producao_id IS
    'Ordem do MES existente; vínculo preservado por chave estrangeira.';

CREATE TABLE public.historico_operacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rastreabilidade_id UUID NOT NULL
        REFERENCES public.rastreabilidade_pecas(id) ON DELETE RESTRICT,
    equipamento_id UUID NOT NULL
        REFERENCES public.equipamentos(id) ON DELETE RESTRICT,
    operador_id UUID REFERENCES public.operators(id) ON DELETE RESTRICT,
    data_hora_entrada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_hora_saida TIMESTAMPTZ,
    aprovado BOOLEAN,
    CONSTRAINT ck_historico_entrada_finita CHECK (isfinite(data_hora_entrada)),
    CONSTRAINT ck_historico_intervalo CHECK (
        data_hora_saida IS NULL OR (
            isfinite(data_hora_saida)
            AND data_hora_saida >= data_hora_entrada
        )
    )
);

COMMENT ON COLUMN public.historico_operacoes.operador_id IS
    'Operador do MES existente; NULL em operações automáticas.';

COMMENT ON COLUMN public.historico_operacoes.aprovado IS
    'TRUE: aprovado; FALSE: reprovado; NULL: avaliação pendente.';

-- 4. Índices. PRIMARY KEY e UNIQUE já criam índices B-tree automaticamente.
-- Índices compostos iniciados pela FK também atendem consultas somente por ela.

-- Eventos recentes e intervalos de tempo por equipamento.
CREATE INDEX idx_apontamentos_equipamento_data
    ON public.apontamentos_producao (equipamento_id, data_hora DESC);

CREATE INDEX idx_apontamentos_produto
    ON public.apontamentos_producao (produto_id);

-- BRIN reduz o tamanho do índice temporal em históricos volumosos.
-- Pressupõe correlação entre data_hora e a ordem física de inserção.
-- [Índices BRIN no PostgreSQL](https://www.postgresql.org/docs/17/brin.html)
CREATE INDEX idx_apontamentos_data_brin
    ON public.apontamentos_producao USING BRIN (data_hora)
    WITH (pages_per_range = 64, autosummarize = on);

CREATE INDEX idx_paradas_equipamento_inicio
    ON public.paradas_equipamento (equipamento_id, inicio DESC);

CREATE INDEX idx_paradas_motivo
    ON public.paradas_equipamento (motivo_id);

-- Índice menor para consultar as paradas ainda abertas.
CREATE INDEX idx_paradas_abertas
    ON public.paradas_equipamento (equipamento_id, inicio DESC)
    WHERE fim IS NULL;

-- Um único índice garante unicidade e acelera a busca por serial/RFID.
CREATE UNIQUE INDEX uq_rastreabilidade_serial_rfid
    ON public.rastreabilidade_pecas (codigo_serial_rfid);

CREATE INDEX idx_rastreabilidade_produto
    ON public.rastreabilidade_pecas (produto_id);

CREATE INDEX idx_rastreabilidade_ordem
    ON public.rastreabilidade_pecas (ordem_producao_id);

-- Sequência de operações da peça e histórico recente de cada equipamento.
CREATE INDEX idx_historico_peca_entrada
    ON public.historico_operacoes (rastreabilidade_id, data_hora_entrada);

CREATE INDEX idx_historico_equipamento_entrada
    ON public.historico_operacoes (equipamento_id, data_hora_entrada DESC);


CREATE INDEX idx_historico_operador ON public.historico_operacoes (operador_id);
CREATE INDEX idx_paradas_inicio_brin ON public.paradas_equipamento USING brin (inicio)
    WITH (autosummarize = on);

-- Papéis de serviço separados. Senhas e LOGIN são provisionados fora do Git.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mes_api') THEN
        CREATE ROLE mes_api NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mes_leitura') THEN
        CREATE ROLE mes_leitura NOLOGIN;
    END IF;
END $$;
ALTER ROLE mes_api CONNECTION LIMIT 30;
ALTER ROLE mes_api SET statement_timeout = '5s';
ALTER ROLE mes_api SET lock_timeout = '1s';
ALTER ROLE mes_api SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE mes_api SET timezone = 'America/Sao_Paulo';
ALTER ROLE mes_leitura CONNECTION LIMIT 5;
ALTER ROLE mes_leitura SET statement_timeout = '5s';
ALTER ROLE mes_leitura SET default_transaction_read_only = on;
ALTER ROLE mes_leitura SET timezone = 'America/Sao_Paulo';
GRANT CONNECT ON DATABASE postgres TO mes_api, mes_leitura;
GRANT USAGE ON SCHEMA public TO mes_api, mes_leitura;

-- Nenhuma tabela industrial nova é publicada anonimamente pela Data API.
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motivos_parada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apontamentos_producao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paradas_equipamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rastreabilidade_pecas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_operacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.produtos, public.equipamentos, public.motivos_parada,
    public.apontamentos_producao, public.paradas_equipamento,
    public.rastreabilidade_pecas, public.historico_operacoes
    FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.apontamentos_producao TO mes_api;
CREATE POLICY mes_api_insert ON public.apontamentos_producao
    FOR INSERT TO mes_api WITH CHECK (true);
CREATE POLICY mes_api_select ON public.apontamentos_producao
    FOR SELECT TO mes_api USING (true);

-- Reaproveita IDs das máquinas ativas sem alterar as tabelas já usadas na fábrica.
INSERT INTO public.equipamentos (id, nome, celula_linha, status_atual)
SELECT id, name, cell_name, 'Cadastrado'
FROM public.production_machines WHERE active;
-- Ciclos de produtos precisam ser os valores reais da engenharia industrial.
-- Não criar produtos fictícios nem converter automaticamente metros/chapas em peças.
