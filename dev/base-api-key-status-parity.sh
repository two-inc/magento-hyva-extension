#!/usr/bin/env bash
# dev/base-api-key-status-parity.sh: the base module's API-key verdict service
# must keep declaring the members this module reads, with the values the unit
# suite's stub gives them.
#
# Test/Stubs/ApiKeyStatus.php stands in for that class in the unit suite, so the
# suite alone cannot notice the base renaming a method or revaluing a category:
# the stub would keep answering. This resolves both against the parent repo's
# `staging`, which is what the di-compile-staging legs build against.
#
# Both sides' constant values are read from their files; none is written here.
#
# Same cross-repo fetch pattern as dev/base-tile-copy-parity.sh.

set -euo pipefail

canonical_repo="two-inc/magento-plugin"
canonical_ref="staging"
canonical_path="Service/Merchant/ApiKeyStatus.php"
stub_path="Test/Stubs/ApiKeyStatus.php"

required_methods=(
    getStatus
    isDefinitiveFailure
)

required_constants=(
    OK
    INVALID_KEY
    SERVICE_ERROR
    UNREACHABLE
    ERROR
    MALFORMED_RESPONSE
    NOT_CONFIGURED
)

command -v gh >/dev/null 2>&1 \
    || { echo "::error::base-api-key-status-parity: gh CLI required for the cross-repo check."; exit 1; }

canonical=$(mktemp)
trap 'rm -f "$canonical"' EXIT

fetched=0
for attempt in 1 2 3; do
    if gh api -H "Accept: application/vnd.github.raw" \
        "repos/${canonical_repo}/contents/${canonical_path}?ref=${canonical_ref}" \
        > "$canonical" 2>/dev/null; then
        fetched=1
        break
    fi
    sleep $((attempt * 2))
done
if [ "$fetched" -ne 1 ]; then
    echo "::error::base-api-key-status-parity: could not fetch ${canonical_path} from ${canonical_repo}@${canonical_ref}."
    exit 1
fi

if [ ! -s "$canonical" ]; then
    echo "::error::base-api-key-status-parity: fetched ${canonical_path} is empty."
    exit 1
fi

# const NAME = 'value'; prints the value, or nothing if NAME is not declared.
const_value() {
    sed -nE "s/.*const[[:space:]]+$1[[:space:]]*=[[:space:]]*'([^']*)'.*/\\1/p" "$2" | head -n 1
}

status=0
for method in "${required_methods[@]}"; do
    if ! grep -qE "function[[:space:]]+${method}[[:space:]]*\(" "$canonical"; then
        echo "::error::base-api-key-status-parity: the base no longer declares ${method}(); this module and ${stub_path} both need updating."
        status=1
    fi
done
# Call sites read getStatus()['status'], so its array return is part of what we rely on.
if ! tr '\n' ' ' < "$canonical" | grep -qE "function[[:space:]]+getStatus[[:space:]]*\([^)]*\)[[:space:]]*:[[:space:]]*array\b"; then
    echo "::error::base-api-key-status-parity: the base getStatus() no longer declares an array return; this module and ${stub_path} both need updating."
    status=1
fi
for constant in "${required_constants[@]}"; do
    base_value=$(const_value "$constant" "$canonical")
    stub_value=$(const_value "$constant" "$stub_path")
    if [ -z "$base_value" ]; then
        echo "::error::base-api-key-status-parity: the base no longer declares ${constant} as a string literal; this module and ${stub_path} both need updating."
        status=1
    elif [ "$stub_value" != "$base_value" ]; then
        echo "::error::base-api-key-status-parity: ${stub_path} declares ${constant}='${stub_value}' but the base declares '${base_value}'."
        status=1
    fi
done

[ "$status" -eq 0 ] \
    && echo "base-api-key-status-parity OK (${#required_methods[@]} methods, ${#required_constants[@]} constants match ${canonical_repo}@${canonical_ref})."
exit "$status"
