"""Integration checks on an EMPTY disposable PostgreSQL database only.
MES_TEST_DATABASE_URL must point to that database; never use production.
"""
import os
from pathlib import Path
from decimal import Decimal
import psycopg2

root = Path(__file__).resolve().parents[2]
conn = psycopg2.connect(os.environ['MES_TEST_DATABASE_URL'])
conn.autocommit = True
try:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'")
        if cur.fetchone()[0]:
            raise RuntimeError('Test database must be empty')
        cur.execute("""DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        END $$;
        CREATE TABLE public.production_orders (id uuid PRIMARY KEY);
        CREATE TABLE public.operators (id uuid PRIMARY KEY);
        CREATE TABLE public.production_machines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, cell_name text, active boolean);
        INSERT INTO public.production_machines (name,cell_name,active) VALUES ('M1','L1',true),('M2','L2',true),('M3','L3',true);""")
        cur.execute((root/'supabase/migrations/20260907011551_mes_layer1.sql').read_text())
        # pg_cron requires server preload; schema/math tested separately from hosted scheduling.
        sql = (root/'supabase/migrations/20260907011554_mes_layer2_oee.sql').read_text()
        cur.execute(sql.split('CREATE EXTENSION IF NOT EXISTS pg_cron;')[0])
        cur.execute("SELECT count(*) FROM public.oee_tempo_real WHERE NOT tem_producao")
        assert cur.fetchone()[0] == 3
        cur.execute("INSERT INTO produtos(sku,descricao,tempo_ciclo_padrao) VALUES ('A','A',1),('B','B',2)")
        cur.execute("INSERT INTO motivos_parada(codigo_falha,descricao,tipo) VALUES ('STOP','Stop','Não Planejada')")
        cur.execute("""INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,qte_refugo)
        SELECT e.id,p.id, CASE WHEN p.sku='A' THEN 90 ELSE 50 END, CASE WHEN p.sku='A' THEN 10 ELSE 0 END
        FROM equipamentos e CROSS JOIN produtos p WHERE e.nome='M1';
        INSERT INTO paradas_equipamento(equipamento_id,motivo_id,inicio,fim)
        SELECT e.id,m.id,(date_trunc('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
          (date_trunc('day',NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') + interval '60 minutes'
        FROM equipamentos e CROSS JOIN motivos_parada m WHERE e.nome='M1';
        INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,qte_refugo,data_hora)
        SELECT e.id,p.id,1000,0,now()-interval '2 days' FROM equipamentos e CROSS JOIN produtos p WHERE e.nome='M1';
        REFRESH MATERIALIZED VIEW CONCURRENTLY public.oee_tempo_real;""")
        cur.execute("SELECT disponibilidade_percentual,desempenho_percentual,qualidade_percentual,oee_percentual FROM oee_tempo_real WHERE equipamento_nome='M1'")
        assert cur.fetchone() == tuple(map(Decimal,['87.50','47.62','93.33','38.89']))
        cur.execute("SELECT duracao_minutos FROM paradas_equipamento")
        assert cur.fetchone()[0] == Decimal('60')
        # A zero operating period must return safely without division by zero.
        cur.execute("UPDATE paradas_equipamento SET fim=inicio+interval '480 minutes'")
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY public.oee_tempo_real")
        cur.execute("SELECT oee_percentual FROM oee_tempo_real WHERE equipamento_nome='M1'")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT has_table_privilege('anon','oee_tempo_real','SELECT'), has_table_privilege('mes_leitura','oee_tempo_real','SELECT'), has_table_privilege('mes_api','produtos','INSERT')")
        assert cur.fetchone() == (False,True,False)
        cur.execute("SET ROLE mes_api")
        cur.execute("SELECT count(*) FROM apontamentos_producao")
        assert cur.fetchone()[0] == 4
        cur.execute("RESET ROLE")
        print('PASS: seven tables, default timestamps, mixed-product OEE, daily window, zero division, concurrent refresh, restricted service access')
finally:
    conn.close()
