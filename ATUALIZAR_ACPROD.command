#!/usr/bin/env bash
# ==============================================================================
# ATUALIZAR_ACPROD.command
# Script seguro de atualização local para AC.Prod (macOS / Linux)
# ==============================================================================

set -e

# Garante a execução a partir do diretório onde o script está localizado
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "======================================================================"
echo "           ATUALIZADOR DE AMBIENTE LOCAL — AC.PROD                    "
echo "======================================================================"
echo "Diretório de execução: $DIR"
echo ""

# 1. Confirmar se está dentro de um repositório Git válido
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; stream; then
  echo "❌ ERRO: O diretório atual não é um repositório Git válido."
  echo "Atualização interrompida."
  exit 1
fi

# Confirmar se o remoto aponta para Gilsantosz/ac-prod
REMOTE_URL="$(git config --get remote.origin.url || true)"
if [[ "$REMOTE_URL" != *"Gilsantosz/ac-prod"* ]]; then
  echo "❌ ERRO: O remoto 'origin' ($REMOTE_URL) não aponta para Gilsantosz/ac-prod."
  echo "Atualização interrompida por segurança."
  exit 1
fi

# 2. Verificar se existem alterações locais não salvas
STASH_STATUS="$(git status --porcelain)"
if [ -n "$STASH_STATUS" ]; then
  echo "⚠️ ATENÇÃO: Foram encontradas alterações locais não commitadas:"
  echo ""
  git status --short
  echo ""
  echo "❌ ATUALIZAÇÃO BLOQUEADA."
  echo "Por segurança, preserve ou envie suas alterações locais antes de atualizar."
  echo "O script NUNCA apaga alterações ou executa reset --hard."
  exit 1
fi

echo "🔍 Buscando atualizações no repositório remoto (git fetch origin)..."
git fetch origin

# Obter commits
LOCAL_COMMIT="$(git rev-parse HEAD)"
REMOTE_COMMIT="$(git rev-parse origin/main)"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  echo "✅ O ambiente local já está 100% atualizado na branch main no commit:"
  echo "   $LOCAL_COMMIT"
  exit 0
fi

echo "📦 Atualizando código para origin/main..."
LOCK_HASH_BEFORE=""
if [ -f "package-lock.json" ]; then
  LOCK_HASH_BEFORE="$(shasum -a 256 package-lock.json | awk '{print $1}')"
fi

# 3. Atualizar com fast-forward estrito
git pull --ff-only origin main

NEW_COMMIT="$(git rev-parse HEAD)"

# 4. Verificar se package-lock.json foi modificado e rodar npm ci se necessário
LOCK_HASH_AFTER=""
if [ -f "package-lock.json" ]; then
  LOCK_HASH_AFTER="$(shasum -a 256 package-lock.json | awk '{print $1}')"
fi

if [ "$LOCK_HASH_BEFORE" != "$LOCK_HASH_AFTER" ]; then
  echo "🔄 Dependências alteradas no package-lock.json. Executando npm ci..."
  npm ci
fi

echo ""
echo "======================================================================"
echo "🎉 ATUALIZAÇÃO CONCLUÍDA COM SUCESSO!"
echo "----------------------------------------------------------------------"
echo "Commit instalado: $NEW_COMMIT"
echo "Versão do código: $(git log -1 --oneline)"
echo "Configurações (.env) e dados do navegador (IndexedDB) mantidos."
echo "======================================================================"
