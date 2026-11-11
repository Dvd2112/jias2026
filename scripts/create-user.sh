#!/usr/bin/env bash
# Cria um usuário já confirmado e define o papel (admin = sorteia/configura; scorer = mesário).
# Uso: SERVICE_ROLE_KEY=... ./scripts/create-user.sh <email> <senha> admin|scorer
# A service_role key fica em Project Settings > API. NUNCA a coloque no front nem no git.
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL=${1:?email}; PASS=${2:?senha}; ROLE=${3:?admin|scorer}
[ "$ROLE" = admin ] || [ "$ROLE" = scorer ] || { echo "papel deve ser admin ou scorer"; exit 1; }
: "${SERVICE_ROLE_KEY:?defina SERVICE_ROLE_KEY}"
URL=$(sed -n "s/.*SUPABASE_URL = '\(.*\)'.*/\1/p" config.js)
H=(-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json")
UID_=$(curl -sf "${H[@]}" -X POST "$URL/auth/v1/admin/users" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sf "${H[@]}" -H "Prefer: resolution=merge-duplicates" -X POST "$URL/rest/v1/profiles" \
  -d "{\"user_id\":\"$UID_\",\"role\":\"$ROLE\"}" >/dev/null
echo "Usuário $EMAIL criado como $ROLE."
