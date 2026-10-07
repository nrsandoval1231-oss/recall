#!/bin/sh
set -eu

fail=0
check_file() {
    file=$1
    if [ ! -f "$file" ]; then
        printf '%s\n' "Missing $file" >&2
        fail=1
    fi
}

check_value() {
    file=$1
    key=$2
    # Strip a terminal CR so Windows-transferred env files cannot turn an empty
    # assignment into a non-empty value. Keep the check POSIX-shell compatible.
    value=$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$file")
    trimmed=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [ -z "$trimmed" ] || printf '%s' "$trimmed" | grep -Eiq '^(paste[_-]?the[_-]?key[_-]?here|change[_-]?me|replace[_-]?me|your[_-].*|<[^>]+>|example\.com)$'; then
        printf '%s\n' "Missing $key in $file" >&2
        fail=1
    fi
}

check_database_role() {
    file=$1
    key=$2
    value=$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$file")
    user=$(printf '%s' "$value" | sed -n 's#^[A-Za-z][A-Za-z0-9+.-]*://\([^:@/]*\).*#\1#p')
    case "$user" in
        postgres|supabase_admin)
            printf '%s\n' "Owner database username '$user' is not allowed in $file:$key" >&2
            fail=1
            ;;
    esac
}

check_file api.env
check_file worker.env
check_file pilot.https.env

if [ "$fail" -eq 0 ]; then
    for pair in \
        "api.env DATABASE_URL" \
        "api.env RECALL_AUTH_ISSUER" \
        "api.env RECALL_AUTH_JWKS_URL" \
        "api.env RECALL_SIGNING_SECRET" \
        "api.env SUPABASE_URL" \
        "api.env SUPABASE_SERVICE_ROLE_KEY" \
        "worker.env DATABASE_URL" \
        "worker.env RECALL_WORKER_DATABASE_URL" \
        "worker.env RECALL_AUTH_ISSUER" \
        "worker.env RECALL_AUTH_JWKS_URL" \
        "worker.env RECALL_SIGNING_SECRET" \
        "worker.env SUPABASE_URL" \
        "worker.env SUPABASE_SERVICE_ROLE_KEY" \
        "pilot.https.env RECALL_PILOT_HOSTNAME"; do
        set -- $pair
        check_value "$1" "$2"
    done

    check_database_role api.env DATABASE_URL
    check_database_role worker.env DATABASE_URL
    check_database_role worker.env RECALL_WORKER_DATABASE_URL

    for file in api.env worker.env; do
        if grep -Eiq '(^|_)(OWNER|TABLE_OWNER|BYPASSRLS|SERVICE_ROLE_ROLE)(_|=)' "$file"; then
            printf '%s\n' "Owner/BYPASSRLS credential marker found in $file" >&2
            fail=1
        fi
    done

    # AI stays disabled until consent, budget, and provider configuration are reviewed.
    for file in api.env worker.env; do
        if grep -Eiq '^(AI_API_KEY|AI_MODEL_ID|RECALL_EMBEDDING_API_KEY)=[^[:space:]]' "$file"; then
            printf '%s\n' "AI configuration is present in $file; remove it until consent review" >&2
            fail=1
        fi
    done
fi

if [ "$fail" -ne 0 ]; then
    exit 1
fi

printf '%s\n' 'Pilot secret preflight passed. Review consent and budget before enabling AI.'
printf '%s\n' 'Role-name checks do not prove server-side ownership or BYPASSRLS flags.'
