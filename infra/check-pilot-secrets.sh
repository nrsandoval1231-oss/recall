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

read_value() {
    file=$1
    key=$2
    awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$file"
}

check_reviewed_activation() {
    record=pilot.activation.reviewed.env
    check_file "$record"
    if [ ! -f "$record" ]; then return 0; fi

    for key in \
        RECALL_PILOT_ACTIVATION_APPROVED \
        RECALL_PILOT_NEW_PRODUCTION_APPROVAL \
        RECALL_PILOT_ACTIVATION_REVIEW_ID \
        RECALL_PILOT_ACTIVATION_REVIEWED_AT \
        RECALL_PILOT_ACTIVATION_OWNER_ID \
        RECALL_PILOT_ACTIVATION_WORKSPACE_ID \
        RECALL_PILOT_ACTIVATION_DEVICE_ID \
        RECALL_PILOT_ACTIVATION_VAULT_ID \
        RECALL_PILOT_ACTIVATION_SCOPE \
        RECALL_PILOT_ACTIVATION_CONSENT_VERSION \
        RECALL_PILOT_ACTIVATION_PROVIDER_ACCOUNT \
        RECALL_PILOT_ACTIVATION_PROVIDER \
        RECALL_PILOT_ACTIVATION_MODEL_ID \
        RECALL_PILOT_ACTIVATION_INPUT_USD_PER_MTOK \
        RECALL_PILOT_ACTIVATION_OUTPUT_USD_PER_MTOK \
        RECALL_PILOT_ACTIVATION_DAILY_BUDGET_USD \
        RECALL_PILOT_ACTIVATION_MONTHLY_BUDGET_USD \
        RECALL_PILOT_PAIRING_ORIGIN; do
        check_value "$record" "$key"
    done

    [ "$(read_value "$record" RECALL_PILOT_ACTIVATION_APPROVED)" = true ] || fail=1
    [ "$(read_value "$record" RECALL_PILOT_NEW_PRODUCTION_APPROVAL)" = approved ] || fail=1
    [ "$(read_value "$record" RECALL_PILOT_ACTIVATION_SCOPE)" = inference-only ] || fail=1
    reviewed_at=$(read_value "$record" RECALL_PILOT_ACTIVATION_REVIEWED_AT)
    if ! printf '%s\n' "$reviewed_at" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then fail=1; fi
    for key in RECALL_PILOT_ACTIVATION_OWNER_ID RECALL_PILOT_ACTIVATION_WORKSPACE_ID RECALL_PILOT_ACTIVATION_DEVICE_ID RECALL_PILOT_ACTIVATION_VAULT_ID; do
        value=$(read_value "$record" "$key")
        if ! printf '%s\n' "$value" | grep -Eiq '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
            printf '%s\n' "Activation record $key must be a UUID" >&2
            fail=1
        fi
    done

    pairing_origin=$(read_value "$record" RECALL_PILOT_PAIRING_ORIGIN)
    hostname=$(read_value pilot.https.env RECALL_PILOT_HOSTNAME)
    if [ "$(read_value api.env RECALL_DEVICE_PAIRING_ENABLED)" != true ] || \
        [ "$pairing_origin" != "https://$hostname" ]; then
        printf '%s\n' "Activation record pairing origin/flag must match the HTTPS pilot hostname and enabled API setting" >&2
        fail=1
    fi
}

check_bounded_ai_configuration() {
    check_reviewed_activation

    for key in AI_PROVIDER AI_MODEL_ID AI_API_KEY AI_INPUT_USD_PER_MTOK AI_OUTPUT_USD_PER_MTOK RECALL_AI_DAILY_BUDGET_USD RECALL_AI_MONTHLY_BUDGET_USD; do
        check_value api.env "$key"
        check_value worker.env "$key"
        api_value=$(read_value api.env "$key")
        worker_value=$(read_value worker.env "$key")
        if [ "$api_value" != "$worker_value" ]; then
            printf '%s\n' "AI setting $key must match in api.env and worker.env" >&2
            fail=1
        fi
    done

    [ "$(read_value api.env AI_PROVIDER)" = anthropic ] || fail=1
    for key in AI_INPUT_USD_PER_MTOK AI_OUTPUT_USD_PER_MTOK; do
        value=$(read_value api.env "$key")
        if ! awk -v value="$value" 'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]{1,4})?$/ && value > 0) }'; then
            printf '%s\n' "$key must be a positive numeric price" >&2
            fail=1
        fi
    done
    for pair in \
        "RECALL_PILOT_ACTIVATION_PROVIDER AI_PROVIDER" \
        "RECALL_PILOT_ACTIVATION_MODEL_ID AI_MODEL_ID" \
        "RECALL_PILOT_ACTIVATION_INPUT_USD_PER_MTOK AI_INPUT_USD_PER_MTOK" \
        "RECALL_PILOT_ACTIVATION_OUTPUT_USD_PER_MTOK AI_OUTPUT_USD_PER_MTOK" \
        "RECALL_PILOT_ACTIVATION_DAILY_BUDGET_USD RECALL_AI_DAILY_BUDGET_USD" \
        "RECALL_PILOT_ACTIVATION_MONTHLY_BUDGET_USD RECALL_AI_MONTHLY_BUDGET_USD"; do
        set -- $pair
        if [ "$(read_value pilot.activation.reviewed.env "$1")" != "$(read_value api.env "$2")" ]; then
            printf '%s\n' "Activation review value $1 must exactly match $2 in api.env" >&2
            fail=1
        fi
    done
    for key in RECALL_AI_DAILY_BUDGET_USD RECALL_AI_MONTHLY_BUDGET_USD; do
        value=$(read_value api.env "$key")
        if ! awk -v value="$value" 'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]{1,2})?$/ && value > 0) }'; then
            printf '%s\n' "$key must be a positive numeric runtime budget" >&2
            fail=1
        fi
    done
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

    # Configuration stays default-denied. Any provider key/model/price requires a
    # complete owner-reviewed record plus matched, bounded API/worker settings.
    if grep -Eiq '^(AI_API_KEY|AI_MODEL_ID|AI_INPUT_USD_PER_MTOK|AI_OUTPUT_USD_PER_MTOK|RECALL_EMBEDDING_[A-Z0-9_]+)=[^[:space:]]' api.env worker.env || \
        [ "$(read_value api.env RECALL_DEVICE_PAIRING_ENABLED)" = true ]; then
        check_bounded_ai_configuration
        if grep -Eiq '^RECALL_EMBEDDING_[A-Z0-9_]+=[^[:space:]]' api.env worker.env; then
            printf '%s\n' 'Embedding-provider activation is outside the reviewed photo-inference pilot' >&2
            fail=1
        fi
    elif [ -f pilot.activation.reviewed.env ]; then
        printf '%s\n' 'Activation record present while AI/pairing is disabled; remove the unused approval record' >&2
        fail=1
    fi
fi

if [ "$fail" -ne 0 ]; then
    exit 1
fi

printf '%s\n' 'Pilot secret preflight passed. AI/pairing activation requires a complete owner-reviewed record.'
printf '%s\n' 'Role-name checks do not prove server-side ownership or BYPASSRLS flags.'
