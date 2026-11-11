#!/usr/bin/env bash
# Cria o schema no Supabase e gera o config.js.
# Uso:
#   Projeto existente:  ./scripts/setup.sh <project-ref>
#   Projeto novo:       ./scripts/setup.sh --new <nome> <org-id> [regiao]   (ex.: sa-east-1)
# Requer a Supabase CLI (https://supabase.com/docs/guides/cli) e `supabase login` feito.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v supabase >/dev/null || { echo "Instale a Supabase CLI: npm i -g supabase  (ou brew install supabase/tap/supabase)"; exit 1; }

if [ "${1:-}" = "--new" ]; then
  NAME=${2:?nome}; ORG=${3:?org-id}; REGION=${4:-sa-east-1}
  read -r -s -p "Senha do banco (guarde-a): " DBPASS; echo
  supabase projects create "$NAME" --org-id "$ORG" --region "$REGION" --db-password "$DBPASS"
  REF=$(supabase projects list -o json | python3 -c "import sys,json; print(next(p['id'] for p in json.load(sys.stdin) if p['name']=='$NAME'))")
  echo "Projeto criado: $REF — aguardando ficar saudável (~2 min)…"; sleep 120
else
  REF=${1:?informe o project-ref (Project Settings > General) ou use --new}
  read -r -s -p "Senha do banco: " DBPASS; echo
fi

[ -f supabase/config.toml ] || supabase init </dev/null
export SUPABASE_DB_PASSWORD="$DBPASS"
supabase link --project-ref "$REF"
# versões da CLI diferem: --linked (antiga) ou --remote (nova)
supabase db push --linked || supabase db push --remote

ANON=$(supabase projects api-keys --project-ref "$REF" -o json | python3 -c "import sys,json; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")
cat > public/config.js <<EOC
// Chave "anon" é pública por design: a segurança vem das políticas RLS da migration.
export const SUPABASE_URL = 'https://$REF.supabase.co';
export const SUPABASE_ANON_KEY = '$ANON';
EOC
echo "OK. public/config.js gerado. Agora crie os usuários: ./scripts/create-user.sh <email> <senha> admin|scorer"
