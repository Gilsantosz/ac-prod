FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PGSSLROOTCERT=/app/supabase-ca.crt \
    PORT=8501

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 dashboard

WORKDIR /app
COPY requirements.txt ./
RUN pip install --requirement requirements.txt
COPY --chown=dashboard:dashboard dashboard.py ./
COPY --chown=dashboard:dashboard supabase-ca.crt ./
COPY --chown=dashboard:dashboard .streamlit/config.toml ./.streamlit/config.toml

USER dashboard
EXPOSE 8501
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8501') + '/_stcore/health', timeout=3)"
CMD ["sh", "-c", "exec streamlit run dashboard.py --server.address=0.0.0.0 --server.port=${PORT:-8501}"]
