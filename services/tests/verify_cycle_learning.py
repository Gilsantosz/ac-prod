"""Exercise cycle learning in an EMPTY disposable PostgreSQL database only.

Never point MES_TEST_DATABASE_URL at production. The script refuses any public table.
"""
import os
from pathlib import Path
from decimal import Decimal

import psycopg2

ROOT = Path(__file__).resolve().parents[2]
conn = psycopg2.connect(os.environ['MES_TEST_DATABASE_URL'])
conn.autocommit = True


def assert_rejected(cur, sql, code='23514'):
    try:
        cur.execute(sql)
    except psycopg2.Error as exc:
        assert exc.pgcode == code, (exc.pgcode, code)
    else:
        raise AssertionError('Expected invalid measurement to be rejected')


try:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
        if cur.fetchone()[0]:
            raise RuntimeError('Test database must be empty')
        cur.execute("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
              IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
            END $$;
            CREATE TABLE public.production_orders (id uuid PRIMARY KEY);
            CREATE TABLE public.operators (id uuid PRIMARY KEY);
            CREATE TABLE public.production_machines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, cell_name text, active boolean);
            INSERT INTO public.production_machines (name, cell_name, active) VALUES ('M1','L1',true), ('M2','L2',true);
        """)
        cur.execute((ROOT / 'supabase/migrations/20260907011551_mes_layer1.sql').read_text())
        cur.execute((ROOT / 'supabase/migrations/20260907011554_mes_layer2_oee.sql').read_text().split('CREATE EXTENSION IF NOT EXISTS pg_cron;')[0])
        cur.execute((ROOT / 'supabase/migrations/20260907015138_mes_cycle_learning.sql').read_text().split('-- Agendamento:')[0])
        cur.execute("""
            INSERT INTO produtos(id,sku,descricao) VALUES
              ('00000000-0000-0000-0000-000000000001','LEARN','Learning'),
              ('00000000-0000-0000-0000-000000000002','UNKNOWN','No observation');
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa)
              SELECT id,'00000000-0000-0000-0000-000000000001',10 FROM equipamentos WHERE nome='M1';
            REFRESH MATERIALIZED VIEW CONCURRENTLY ciclos_observados;
            REFRESH MATERIALIZED VIEW CONCURRENTLY oee_tempo_real;
        """)
        cur.execute("SELECT estado_ciclo,cobertura_ciclo_percentual,oee_percentual,desempenho_percentual,qualidade_percentual FROM oee_tempo_real WHERE equipamento_nome='M1'")
        assert cur.fetchone() == ('aprendendo', Decimal('0'), None, None, Decimal('100'))
        cur.execute("SELECT count(*) FROM amostras_ciclo")
        assert cur.fetchone()[0] == 0, 'Network insertion timestamps must never become cycle samples'

        # 19 clean, explicitly timed operations + 1 extreme value across 3 days.
        # The first cohort has 19 samples, so it must still be learning.
        for count in (19, 1):
            if count == 19:
                range_sql = 'generate_series(1,19) AS g(n)'
                duration_sql = "interval '20 minutes'"
                ending_sql = "now() - ((n % 3) || ' days')::interval - (n || ' hours')::interval - interval '1 hour'"
            else:
                range_sql = 'generate_series(20,20) AS g(n)'
                duration_sql = "interval '9990 minutes'"
                ending_sql = "now() - interval '2 hours'"
            cur.execute(f"""
                INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
                SELECT e.id,'00000000-0000-0000-0000-000000000001',10,
                       ends_at - {duration_sql}, ends_at, 'sensor',false,false
                FROM equipamentos e CROSS JOIN (SELECT {ending_sql} AS ends_at FROM {range_sql}) times
                WHERE e.nome='M1';
                REFRESH MATERIALIZED VIEW CONCURRENTLY ciclos_observados;
                REFRESH MATERIALIZED VIEW CONCURRENTLY oee_tempo_real;
            """)
            cur.execute("SELECT quantidade_amostras,ciclo_estimado_minutos FROM ciclos_observados WHERE produto_id='00000000-0000-0000-0000-000000000001'")
            samples, estimate = cur.fetchone()
            assert samples == (19 if count == 19 else 20)
            assert estimate == (None if count == 19 else Decimal('2'))
        cur.execute("SELECT estado_ciclo,cobertura_ciclo_percentual,referencia_estimada,oee_percentual FROM oee_tempo_real WHERE equipamento_nome='M1'")
        state, coverage, estimated, oee = cur.fetchone()
        assert (state, coverage, estimated) == ('estimado', Decimal('100'), True)
        assert oee == Decimal('87.50'), oee  # 210 pieces * observed 2min / 480min.
        cur.execute("SELECT tempo_ciclo_padrao FROM produtos WHERE sku='LEARN'")
        assert cur.fetchone()[0] is None, 'Learning must not silently write an engineering standard'

        # Same canonical event is updated without multiplying observations.
        cur.execute("UPDATE apontamentos_producao SET qte_boa=qte_boa WHERE origem_tempo IS NOT NULL")
        cur.execute("SELECT count(*) FROM amostras_ciclo")
        assert cur.fetchone()[0] == 20
        cur.execute("""
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
              SELECT id,'00000000-0000-0000-0000-000000000001',1,now()-interval '3 minutes',now()-interval '2 minutes','operador',true,false FROM equipamentos WHERE nome='M1';
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
              SELECT id,'00000000-0000-0000-0000-000000000001',1,now()-interval '3 minutes',now()-interval '2 minutes','operador',false,true FROM equipamentos WHERE nome='M1';
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,qte_refugo,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
              SELECT id,'00000000-0000-0000-0000-000000000001',1,1,now()-interval '3 minutes',now()-interval '2 minutes','operador',false,false FROM equipamentos WHERE nome='M1';
        """)
        cur.execute("SELECT count(*) FROM amostras_ciclo")
        assert cur.fetchone()[0] == 20, 'Rework, interruption and rejected output are not baseline samples'
        assert_rejected(cur, """INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao)
            SELECT id,'00000000-0000-0000-0000-000000000001',1,now()-interval '1 minute' FROM equipamentos LIMIT 1""")
        assert_rejected(cur, """INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
            SELECT id,'00000000-0000-0000-0000-000000000001',1,now()-interval '1 minute',now()-interval '2 minutes','sensor',false,false FROM equipamentos LIMIT 1""")
        assert_rejected(cur, """INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,data_hora,origem_tempo,teve_interrupcao,retrabalho)
            SELECT id,'00000000-0000-0000-0000-000000000001',1,now(),now()+interval '1 hour',now()+interval '2 hours','sensor',false,false FROM equipamentos LIMIT 1""")

        # A second product without a reference invalidates the complete OEE,
        # instead of quietly treating its ideal minutes as zero.
        cur.execute("""
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa)
              SELECT id,'00000000-0000-0000-0000-000000000002',10 FROM equipamentos WHERE nome='M1';
            REFRESH MATERIALIZED VIEW CONCURRENTLY ciclos_observados;
            REFRESH MATERIALIZED VIEW CONCURRENTLY oee_tempo_real;
        """)
        cur.execute("SELECT estado_ciclo,oee_percentual,produtos_em_aprendizado FROM oee_tempo_real WHERE equipamento_nome='M1'")
        assert cur.fetchone() == ('aprendendo', None, 1)
        cur.execute("""
            UPDATE produtos SET tempo_ciclo_padrao=1;
            REFRESH MATERIALIZED VIEW CONCURRENTLY oee_tempo_real;
        """)
        cur.execute("SELECT estado_ciclo,referencia_estimada FROM oee_tempo_real WHERE equipamento_nome='M1'")
        assert cur.fetchone() == ('padrao', False), 'Explicit standard must override estimated reference'

        # Natural genealogy operations use explicit timing and exactly one piece.
        cur.execute("""
            INSERT INTO production_orders VALUES ('00000000-0000-0000-0000-000000000003');
            INSERT INTO rastreabilidade_pecas(id,codigo_serial_rfid,produto_id,ordem_producao_id,status)
              VALUES ('00000000-0000-0000-0000-000000000004','REAL-OP','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','em_producao');
            INSERT INTO historico_operacoes(rastreabilidade_id,equipamento_id,data_hora_entrada,data_hora_saida,aprovado,origem_tempo,teve_interrupcao,retrabalho)
              SELECT '00000000-0000-0000-0000-000000000004',id,now()-interval '4 minutes',now()-interval '1 minute',true,'operador',false,false FROM equipamentos WHERE nome='M2';
        """)
        cur.execute("SELECT quantidade,ciclo_minutos FROM amostras_ciclo WHERE historico_id IS NOT NULL")
        assert cur.fetchone() == (1, Decimal('3'))
        cur.execute("UPDATE historico_operacoes SET aprovado=false")
        cur.execute("SELECT count(*) FROM amostras_ciclo WHERE historico_id IS NOT NULL")
        assert cur.fetchone()[0] == 0, 'A corrected rejection must remove the baseline sample'
        cur.execute("UPDATE historico_operacoes SET aprovado=true; UPDATE rastreabilidade_pecas SET produto_id='00000000-0000-0000-0000-000000000001'")
        cur.execute("SELECT produto_id::text FROM amostras_ciclo WHERE historico_id IS NOT NULL")
        assert cur.fetchone()[0] == '00000000-0000-0000-0000-000000000001'
        cur.execute("SELECT has_table_privilege('mes_api','amostras_ciclo','INSERT'),has_table_privilege('anon','ciclos_observados','SELECT'),has_table_privilege('mes_leitura','ciclos_observados','SELECT')")
        assert cur.fetchone() == (False,False,True)
        # A large same-day cohort alone cannot pass the minimum-day threshold.
        # Sampling stays bounded to 100 observations per pair/day.
        cur.execute("""
            INSERT INTO produtos(id,sku,descricao) VALUES ('00000000-0000-0000-0000-000000000005','CAP','Bounded sample');
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
              SELECT e.id,'00000000-0000-0000-0000-000000000005',1,
                today - interval '1 day' + interval '12 hours' + n * interval '3 minutes',
                today - interval '1 day' + interval '12 hours' + n * interval '3 minutes' + interval '2 minutes',
                'sensor',false,false
              FROM equipamentos e CROSS JOIN generate_series(1,120) g(n)
              CROSS JOIN (SELECT date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS today) bounds
              WHERE e.nome='M2';
            REFRESH MATERIALIZED VIEW CONCURRENTLY ciclos_observados;
        """)
        cur.execute("SELECT quantidade_amostras,dias_observados,ciclo_estimado_minutos FROM ciclos_observados WHERE produto_id='00000000-0000-0000-0000-000000000005'")
        assert cur.fetchone() == (100, 1, None)
        cur.execute("""
            INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
              SELECT e.id,'00000000-0000-0000-0000-000000000005',1,
                today - n * interval '1 day' + interval '12 hours',
                today - n * interval '1 day' + interval '12 hours 2 minutes','sensor',false,false
              FROM equipamentos e CROSS JOIN (VALUES (2),(3),(31)) g(n)
              CROSS JOIN (SELECT date_trunc('day',now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' AS today) bounds
              WHERE e.nome='M2';
            REFRESH MATERIALIZED VIEW CONCURRENTLY ciclos_observados;
        """)
        cur.execute("SELECT quantidade_amostras,dias_observados,ciclo_estimado_minutos FROM ciclos_observados WHERE produto_id='00000000-0000-0000-0000-000000000005'")
        assert cur.fetchone() == (102, 3, Decimal('2')), 'Old samples must not enter the reference window'

        # Recorded downtime invalidates overlapping measured cycles, including
        # downtime entered after the original observation was received.
        cur.execute("""
            INSERT INTO motivos_parada(codigo_falha,descricao,tipo) VALUES ('P','Stop','Não Planejada');
            INSERT INTO paradas_equipamento(equipamento_id,motivo_id,inicio,fim)
              SELECT e.id,p.id,now()-interval '5 minutes',now() FROM equipamentos e CROSS JOIN motivos_parada p WHERE e.nome='M2';
            REFRESH MATERIALIZED VIEW CONCURRENTLY ciclos_observados;
        """)
        cur.execute("SELECT quantidade_amostras FROM ciclos_observados c JOIN equipamentos e ON e.id=c.equipamento_id WHERE c.produto_id='00000000-0000-0000-0000-000000000001' AND e.nome='M2'")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT id FROM equipamentos WHERE nome='M1'")
        machine_id = cur.fetchone()[0]
        cur.execute("SET ROLE mes_api")
        cur.execute("""INSERT INTO apontamentos_producao(equipamento_id,produto_id,qte_boa,inicio_operacao,fim_operacao,origem_tempo,teve_interrupcao,retrabalho)
            VALUES (%s,'00000000-0000-0000-0000-000000000001',1,now()-interval '3 minutes',now()-interval '2 minutes','sensor',false,false) RETURNING id""", (machine_id,))
        event_id = cur.fetchone()[0]
        cur.execute("RESET ROLE")
        cur.execute("SELECT quantidade FROM amostras_ciclo WHERE apontamento_id=%s", (event_id,))
        assert cur.fetchone()[0] == 1, 'Restricted service insertion must derive a sample successfully'
        # The identity bridge reuses real product codes and physical piece IDs,
        # without inserting production or replacing an already confirmed cycle.
        cur.execute("""
            CREATE TABLE production_lot_items(id uuid PRIMARY KEY,product_code text,product_name text);
            CREATE TABLE production_pieces(id uuid PRIMARY KEY,legacy_production_lot_item_id uuid,production_order_id uuid,traceability_code text,status text);
            INSERT INTO production_lot_items VALUES
              ('10000000-0000-0000-0000-000000000001','LEARN','Existing standard'),
              ('10000000-0000-0000-0000-000000000002','ACTUAL-SKU','Actual product'),
              ('10000000-0000-0000-0000-000000000003','ACTUAL-SKU','Duplicate SKU item'),
              ('10000000-0000-0000-0000-000000000004','','Unidentified');
            INSERT INTO production_pieces VALUES
              ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','BRIDGE-1','approved'),
              ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','BRIDGE-2','approved'),
              ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',NULL,'BRIDGE-NO-ORDER','approved'),
              ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','BRIDGE-NO-SKU','approved');
        """)
        cur.execute("SELECT count(*) FROM apontamentos_producao")
        count_before_seed = cur.fetchone()[0]
        seed_sql = (ROOT / 'supabase/migrations/20260907015149_mes_existing_piece_identities.sql').read_text()
        cur.execute(seed_sql)
        cur.execute(seed_sql)
        cur.execute("SELECT id::text,tempo_ciclo_padrao FROM produtos WHERE sku='ACTUAL-SKU'")
        assert cur.fetchone() == ('10000000-0000-0000-0000-000000000002', None)
        cur.execute("SELECT tempo_ciclo_padrao FROM produtos WHERE sku='LEARN'")
        assert cur.fetchone()[0] == Decimal('1')
        cur.execute("SELECT count(*) FROM rastreabilidade_pecas WHERE codigo_serial_rfid LIKE 'BRIDGE-%'")
        assert cur.fetchone()[0] == 2
        cur.execute("SELECT produto_id::text FROM rastreabilidade_pecas WHERE codigo_serial_rfid='BRIDGE-1'")
        assert cur.fetchone()[0] == '00000000-0000-0000-0000-000000000001'
        cur.execute("SELECT count(*) FROM apontamentos_producao")
        assert cur.fetchone()[0] == count_before_seed
        cur.execute("SELECT count(*) FROM production_pieces")
        assert cur.fetchone()[0] == 4
        print('PASS: measured cycle learning, 20 samples / 3 days, bounded 30-day window, robust median, unknown coverage, standard precedence, genealogy corrections, downtime exclusion, idempotent derivation restricted service insertion and additive identity bridge')
finally:
    conn.close()
