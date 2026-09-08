#!/usr/bin/env bash
# dev/base-tile-copy-parity.sh — the base module's tile-copy service must keep
# declaring the methods this checkout delegates the subtitle and about link to.
#
# Test/Stubs/CheckoutTileCopy.php stands in for that class in the unit suite, so
# the suite alone cannot notice the base renaming a method — the stub would keep
# answering. This resolves the names against the parent repo's `staging`, which
# is what the di-compile-staging legs build against.
#
# Same cross-repo fetch pattern as dev/matrix-script-parity.sh.

set -euo pipefail

canonical_repo="two-inc/magento-plugin"
canonical_ref="staging"
canonical_path="Model/Ui/CheckoutTileCopy.php"

required_methods=(
    getSubtitleHtml
    isAboutLinkVisible
    getAboutLinkUrl
    getAboutLinkText
)

command -v gh >/dev/null 2>&1 \
    || { echo "::error::base-tile-copy-parity: gh CLI required for the cross-repo check."; exit 1; }

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
    echo "::error::base-tile-copy-parity: could not fetch ${canonical_path} from ${canonical_repo}@${canonical_ref}."
    exit 1
fi

if [ ! -s "$canonical" ]; then
    echo "::error::base-tile-copy-parity: fetched ${canonical_path} is empty."
    exit 1
fi

status=0
for method in "${required_methods[@]}"; do
    if ! grep -qE "function[[:space:]]+${method}[[:space:]]*\(" "$canonical"; then
        echo "::error::base-tile-copy-parity: the base no longer declares ${method}(); this checkout and Test/Stubs/CheckoutTileCopy.php both need updating."
        status=1
    fi
done

[ "$status" -eq 0 ] \
    && echo "base-tile-copy-parity OK (${#required_methods[@]} methods declared on ${canonical_repo}@${canonical_ref})."
exit "$status"
