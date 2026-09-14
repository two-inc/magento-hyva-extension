#!/usr/bin/env bash
# dev/base-cache-tag-parity.sh — the gateway cache tag this module tags its
# API-key verdict with must keep matching the base module's constant.
#
# Test/Stubs/TwoGatewayCacheType.php stands in for that class in the unit suite,
# so ApiKeyVerificationStatusTest resolves the tag against the stub and passes
# whatever the stub says. A base rename or revalue would leave
# `cache:clean two_gateway` silently unable to drop the verdict — the ABN-534
# fault, restored invisibly. This compares the stub against the parent repo's
# `staging`, which is what the di-compile-staging legs build against.
#
# Both sides are read from their files; the expected value is never written here.
#
# Same cross-repo fetch pattern as dev/base-tile-copy-parity.sh.

set -euo pipefail

canonical_repo="two-inc/magento-plugin"
canonical_ref="staging"
canonical_path="Model/Cache/Type/TwoGateway.php"
stub_path="Test/Stubs/TwoGatewayCacheType.php"
constant="CACHE_TAG"

# const NAME = 'value'; — captures the value, and matches nothing if the base
# renames the constant.
const_pattern="const[[:space:]]+${constant}[[:space:]]*=[[:space:]]*'([^']*)'"

command -v gh >/dev/null 2>&1 \
    || { echo "::error::base-cache-tag-parity: gh CLI required for the cross-repo check."; exit 1; }

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
    echo "::error::base-cache-tag-parity: could not fetch ${canonical_path} from ${canonical_repo}@${canonical_ref}."
    exit 1
fi

if [ ! -s "$canonical" ]; then
    echo "::error::base-cache-tag-parity: fetched ${canonical_path} is empty."
    exit 1
fi

base_value=$(sed -nE "s/.*${const_pattern}.*/\1/p" "$canonical" | head -1)
if [ -z "$base_value" ]; then
    echo "::error::base-cache-tag-parity: the base no longer declares ${constant} as a string literal in ${canonical_path}; ${stub_path} and Service/ApiKeyVerificationStatus.php both need updating."
    exit 1
fi

stub_value=$(sed -nE "s/.*${const_pattern}.*/\1/p" "$stub_path" | head -1)
if [ -z "$stub_value" ]; then
    echo "::error::base-cache-tag-parity: ${stub_path} does not declare ${constant} as a string literal."
    exit 1
fi

if [ "$base_value" != "$stub_value" ]; then
    echo "::error::base-cache-tag-parity: ${stub_path} declares ${constant}='${stub_value}' but the base declares '${base_value}'; the unit suite cannot see this, and cache:clean would stop dropping the verdict."
    exit 1
fi

echo "base-cache-tag-parity OK (${constant}='${stub_value}' matches ${canonical_repo}@${canonical_ref})."
