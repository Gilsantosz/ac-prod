"""Dashboard MES: leitura protegida de indicadores calculados no PostgreSQL."""

import hashlib
import hmac
import math
import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import psycopg2
import streamlit as st
from streamlit.errors import StreamlitSecretNotFoundError


SQL_OEE = "SELECT * FROM public.oee_tempo_real ORDER BY oee_percentual DESC;"
METRICAS = (
    ("Disponibilidade", "disponibilidade_percentual"),
    ("Desempenho", "desempenho_percentual"),
    ("Qualidade", "qualidade_percentual"),
    ("OEE Final", "oee_percentual"),
)
FUSO_EXIBICAO = ZoneInfo("America/Sao_Paulo")


class ConfiguracaoIncompleta(ValueError):
    """Configuração ausente; a mensagem exibida nunca inclui credenciais."""


def ler_secrets() -> dict:
    try:
        return dict(st.secrets)
    except StreamlitSecretNotFoundError:
        return {}


def senha_configurada() -> str:
    senha = os.environ.get("MES_DASHBOARD_PASSWORD")
    if senha is None:
        senha = ler_secrets().get("MES_DASHBOARD_PASSWORD", "")
    return senha if isinstance(senha, str) else ""


def identificador_senha(senha: str) -> str:
    # A sessão não armazena a senha. Trocar o segredo invalida sessões anteriores.
    return hashlib.sha256(senha.encode("utf-8")).hexdigest()


def sessao_autenticada() -> bool:
    senha = senha_configurada()
    identificador = st.session_state.get("mes_autenticacao", "")
    return bool(senha) and hmac.compare_digest(
        identificador, identificador_senha(senha)
    )


def exigir_autenticacao() -> None:
    senha = senha_configurada()
    if not senha:
        st.error("O acesso ao painel ainda não foi habilitado pelo administrador.")
        st.stop()

    if sessao_autenticada():
        if st.sidebar.button("Sair", key="mes_sair"):
            st.session_state.pop("mes_autenticacao", None)
            st.rerun()
        return

    st.subheader("Acesso ao painel de produção")
    with st.form("mes_login", clear_on_submit=True):
        fornecida = st.text_input("Senha de acesso", type="password")
        entrar = st.form_submit_button("Entrar")
    if entrar:
        if hmac.compare_digest(fornecida.encode("utf-8"), senha.encode("utf-8")):
            st.session_state["mes_autenticacao"] = identificador_senha(senha)
            st.rerun()
        st.error("Senha de acesso inválida.")
    st.stop()


def configuracao_banco() -> tuple[str | None, dict]:
    """Aceita DATABASE_URL ou o bloco connections.postgresql do Streamlit."""
    secrets = ler_secrets()
    database_url = os.environ.get("DATABASE_URL") or secrets.get("DATABASE_URL")
    bloco = dict(secrets.get("connections", {}).get("postgresql", {}))
    certificado = os.environ.get("PGSSLROOTCERT") or bloco.get("sslrootcert") or "system"
    if certificado != "system":
        caminho = Path(certificado).expanduser()
        if not caminho.is_absolute():
            caminho = Path(__file__).resolve().parent / caminho
        certificado = str(caminho)
    parametros = {
        "connect_timeout": 5,
        "application_name": "mes-dashboard-oee",
        # Verificação de certificado e hostname é obrigatória mesmo se o DSN
        # solicitar um modo SSL mais fraco.
        "sslmode": "verify-full",
        # Community Cloud executa o app a partir da raiz do repositório.
        # Caminhos relativos de CA pertencem à pasta deste arquivo.
        "sslrootcert": certificado,
        "options": (
            "-c statement_timeout=5000 "
            "-c lock_timeout=2000 "
            "-c default_transaction_read_only=on "
            "-c search_path=pg_catalog,public"
        ),
    }
    if database_url:
        if not isinstance(database_url, str):
            raise ConfiguracaoIncompleta()
        return database_url, parametros

    campos = ("host", "database", "username", "password")
    if not all(bloco.get(campo) for campo in campos):
        raise ConfiguracaoIncompleta()
    parametros.update(
        host=bloco["host"],
        port=bloco.get("port", 5432),
        dbname=bloco["database"],
        user=bloco["username"],
        password=bloco["password"],
    )
    # "dialect" existe no exemplo de secrets do Streamlit, mas não é enviado
    # ao driver psycopg2: não utilizamos SQLAlchemy ou qualquer ORM.
    return None, parametros


def consultar_oee() -> pd.DataFrame:
    """Consulta somente a materialized view; encerra a conexão em toda saída."""
    database_url, parametros = configuracao_banco()
    conexao = None
    try:
        conexao = psycopg2.connect(database_url, **parametros)
        conexao.set_session(readonly=True, autocommit=True)
        with conexao.cursor() as cursor:
            cursor.execute(SQL_OEE)
            colunas = [coluna.name for coluna in cursor.description]
            return pd.DataFrame.from_records(cursor.fetchall(), columns=colunas)
    finally:
        if conexao is not None:
            conexao.close()


def numero_para_exibicao(valor) -> float | None:
    """Conversão para apresentação; não altera a escala fornecida pelo banco."""
    try:
        numero = float(valor)
    except (TypeError, ValueError, OverflowError):
        return None
    return numero if math.isfinite(numero) else None


def percentual(valor) -> str:
    numero = numero_para_exibicao(valor)
    return "N/D" if numero is None else f"{numero:.2f}%"


def horario_banco(valor) -> str:
    if valor is None or pd.isna(valor):
        return "N/D"
    if isinstance(valor, datetime):
        if valor.tzinfo is not None:
            valor = valor.astimezone(FUSO_EXIBICAO)
        return valor.strftime("%d/%m/%Y %H:%M:%S %Z").strip()
    if isinstance(valor, date):
        return valor.strftime("%d/%m/%Y")
    return str(valor)


@st.fragment(run_every="60s")
def atualizar_dashboard() -> None:
    # Fragmentos também verificam a sessão antes de acessar dados industriais.
    if not sessao_autenticada():
        st.rerun()
    st.button("Atualizar agora", key="atualizar_oee")
    try:
        dados = consultar_oee()
    except (ConfiguracaoIncompleta, ValueError, TypeError):
        st.error("A conexão do painel ainda não foi configurada corretamente.")
        return
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        st.error(
            "O banco está indisponível ou demorou para responder. "
            "Uma nova tentativa ocorrerá em 60 segundos."
        )
        return
    except psycopg2.Error:
        st.error("Não foi possível ler os indicadores de produção.")
        return

    if not {"equipamento_id", "oee_percentual"}.issubset(dados.columns):
        st.error("A fonte de dados não forneceu a identificação e o OEE dos equipamentos.")
        return
    if dados.empty:
        st.info("Ainda não há indicadores de equipamentos disponíveis.")
        return

    barras = []
    tem_indicadores = False
    for registro in dados.to_dict(orient="records"):
        equipamento_id = str(registro["equipamento_id"])
        nome = registro.get("equipamento_nome")
        nome = str(nome) if nome is not None and not pd.isna(nome) else equipamento_id
        tem_producao = registro.get("tem_producao") is True
        tem_indicadores = tem_indicadores or tem_producao
        with st.container(border=True):
            st.subheader(nome)
            if nome != equipamento_id:
                st.caption(f"Equipamento: {equipamento_id}")
            st.caption(
                f"Referência: {horario_banco(registro.get('data_referencia'))} · "
                f"Atualizado no banco: {horario_banco(registro.get('atualizado_em'))}"
            )
            if not tem_producao:
                st.caption("Sem apontamentos nesta camada para a data de referência.")
            for coluna, (rotulo, campo) in zip(st.columns(4), METRICAS):
                coluna.metric(rotulo, percentual(registro.get(campo)) if tem_producao else "N/D")
        oee = numero_para_exibicao(registro["oee_percentual"])
        if tem_producao and oee is not None:
            # O ID diferencia nomes repetidos; não agregamos equipamentos.
            barras.append({"Equipamentos": f"{nome} ({equipamento_id})", "OEE Final (%)": oee})

    if not tem_indicadores:
        st.info(
            "Ainda não há apontamentos de produção nesta camada para a data de referência. "
            "Os indicadores serão exibidos quando houver dados com tempo de ciclo cadastrado."
        )
    st.subheader("OEE por equipamento")
    if barras:
        st.bar_chart(
            pd.DataFrame(barras),
            x="Equipamentos",
            y="OEE Final (%)",
            sort=False,
            stack=False,
            color="#168AAD",
            height=400,
        )
    else:
        st.info("Não há valores de OEE disponíveis para o gráfico.")


st.set_page_config(page_title="AC.Prod | OEE", page_icon="🏭", layout="wide")
st.title("OEE das linhas de produção")
exigir_autenticacao()
st.caption("Atualização automática a cada 60 segundos enquanto o painel estiver aberto.")
atualizar_dashboard()
