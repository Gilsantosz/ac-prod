"""AppTest sem acesso externo: autenticação, contrato e falhas de leitura."""

import os
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import psycopg2
from streamlit.testing.v1 import AppTest


APP = Path(__file__).resolve().parents[1] / "dashboard.py"
SENHA = "teste-senha-industrial-2026"
COLUNAS = [
    "equipamento_id", "equipamento_nome", "disponibilidade_percentual",
    "desempenho_percentual", "qualidade_percentual", "oee_percentual",
    "atualizado_em", "data_referencia", "tem_producao",
]
REGISTRO = [
    "00000000-0000-4000-8000-000000000001", "Linha 1", 90, 80, 95, 68.4,
    datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc), date(2026, 9, 7), True,
]


class ConexaoSimulada:
    def __init__(self, dados, erro=None):
        self.dados = dados
        self.erro = erro
        self.closed = False
        self.sql = None
        self.description = [SimpleNamespace(name=coluna) for coluna in COLUNAS]

    def set_session(self, **kwargs):
        assert kwargs == {"readonly": True, "autocommit": True}

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def execute(self, sql):
        self.sql = sql
        if self.erro:
            raise self.erro

    def fetchall(self):
        return self.dados

    def close(self):
        self.closed = True


class DashboardTest(unittest.TestCase):
    def setUp(self):
        self.ambiente = patch.dict(os.environ, {
            "MES_DASHBOARD_PASSWORD": SENHA,
            "DATABASE_URL": "postgresql://leitura@db.example.test:5432/postgres?sslmode=disable",
        })
        self.ambiente.start()

    def tearDown(self):
        self.ambiente.stop()

    def entrar(self, app):
        app.text_input[0].set_value(SENHA)
        app.button[0].click().run()
        self.assertFalse(app.exception)
        return app

    def test_autenticacao_impede_qualquer_consulta(self):
        with patch("psycopg2.connect") as conectar:
            app = AppTest.from_file(APP).run()
            self.assertFalse(app.metric)
            conectar.assert_not_called()
            app.text_input[0].set_value("senha-incorreta")
            app.button[0].click().run()
            self.assertTrue(app.error)
            conectar.assert_not_called()

    def test_credencial_ausente_fecha_acesso(self):
        with patch.dict(os.environ, {"MES_DASHBOARD_PASSWORD": ""}), patch("psycopg2.connect") as conectar:
            app = AppTest.from_file(APP).run()
            self.assertTrue(app.error)
            self.assertFalse(app.text_input)
            conectar.assert_not_called()

    def test_metricas_tls_consulta_e_refresh(self):
        conexoes = []
        def conectar(dsn, **kwargs):
            self.assertIn("sslmode=disable", dsn)
            self.assertEqual(kwargs["sslmode"], "verify-full")
            self.assertEqual(kwargs["connect_timeout"], 5)
            self.assertIn("statement_timeout=5000", kwargs["options"])
            conexao = ConexaoSimulada([REGISTRO])
            conexoes.append(conexao)
            return conexao
        with patch("psycopg2.connect", side_effect=conectar):
            app = self.entrar(AppTest.from_file(APP).run())
            self.assertEqual([metrica.value for metrica in app.metric], ["90.00%", "80.00%", "95.00%", "68.40%"])
            self.assertEqual(conexoes[0].sql, "SELECT * FROM public.oee_tempo_real ORDER BY oee_percentual DESC;")
            self.assertTrue(conexoes[0].closed)
            self.assertTrue(app.get("vega_lite_chart"))
            self.assertTrue(any("07/09/2026 09:00:00" in legenda.value for legenda in app.caption))
            app.button(key="atualizar_oee").click().run()
            self.assertEqual(len(conexoes), 2)
            self.assertTrue(all(conexao.closed for conexao in conexoes))
            app.button(key="mes_sair").click().run()
            self.assertFalse(app.metric)
            self.assertEqual(len(conexoes), 2)

    def test_sem_producao_nao_exibe_zero_como_medicao(self):
        registro = REGISTRO.copy()
        registro[2:6] = [100, 0, 0, 0]
        registro[-1] = False
        with patch("psycopg2.connect", return_value=ConexaoSimulada([registro])):
            app = self.entrar(AppTest.from_file(APP).run())
            self.assertEqual([metrica.value for metrica in app.metric], ["N/D"] * 4)
            self.assertFalse(app.get("vega_lite_chart"))
            self.assertTrue(any("Ainda não há apontamentos" in mensagem.value for mensagem in app.info))

    def test_zero_real_permanece_zero(self):
        registro = REGISTRO.copy()
        registro[5] = 0
        with patch("psycopg2.connect", return_value=ConexaoSimulada([registro])):
            app = self.entrar(AppTest.from_file(APP).run())
            self.assertEqual(app.metric[3].value, "0.00%")
            self.assertTrue(app.get("vega_lite_chart"))

    def test_erro_de_consulta_fecha_conexao_sem_vazar_detalhes(self):
        conexao = ConexaoSimulada([], psycopg2.OperationalError("senha-super-secreta"))
        with patch("psycopg2.connect", return_value=conexao):
            app = self.entrar(AppTest.from_file(APP).run())
            self.assertTrue(conexao.closed)
            self.assertTrue(app.error)
            self.assertNotIn("senha-super-secreta", app.error[0].value)

    def test_secrets_toml_usa_driver_direto(self):
        with patch.dict(os.environ, {"DATABASE_URL": ""}), patch("psycopg2.connect", return_value=ConexaoSimulada([])) as conectar:
            app = AppTest.from_file(APP)
            app.secrets["connections"] = {"postgresql": {
                "dialect": "postgresql", "host": "pooler.example.test", "port": 5432,
                "database": "postgres", "username": "leitura.projeto", "password": "exemplo",
                "sslrootcert": "supabase-ca.crt",
            }}
            self.entrar(app.run())
            args, kwargs = conectar.call_args
            self.assertIsNone(args[0])
            self.assertEqual(kwargs["user"], "leitura.projeto")
            self.assertEqual(kwargs["dbname"], "postgres")
            self.assertEqual(kwargs["sslmode"], "verify-full")
            self.assertEqual(kwargs["sslrootcert"], str(APP.parent / "supabase-ca.crt"))
            self.assertNotIn("dialect", kwargs)


if __name__ == "__main__":
    unittest.main()
