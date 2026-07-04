#!/usr/bin/env bash
# dev/matrix-script-parity.sh — drift guard for the version-support classifier.
#
# `dev/magento-support-matrix.sh` is vendored byte-for-byte from the vanilla
# `two-inc/magento-plugin` repo (its `staging` branch is the source of truth —
# TWO-24998 chose a vendored copy + this guard over a submodule/subtree for a
# single shell script). Any divergence between the two copies is CI red, so a
# fix to the classifier in one repo can't silently rot in the other.
#
# To update: change the canonical copy on magento-plugin first, land it on
# `staging`, then copy the identical file here in a follow-up PR.
#
# Mirrors dev/agents-convention-parity.sh (the AGENTS.md drift guard).

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
local_script="${repo_root}/dev/magento-support-matrix.sh"
canonical_repo="two-inc/magento-plugin"
canonical_ref="staging"
canonical_path="dev/magento-support-matrix.sh"

if [ ! -f "$local_script" ]; then
    echo "::error::matrix-script-parity: local $canonical_path missing at $local_script"
    exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
    echo "::error::matrix-script-parity: gh CLI required for the cross-repo parity check."
    exit 1
fi

canonical=$(mktemp)
trap 'rm -f "$canonical"' EXIT

# Fetch the raw file via the GitHub raw media type — avoids the JSON+base64
# round-trip (and `base64 -d`'s GNU/BSD flag portability quirk). Retry a few
# times so a transient API blip reds the check only for genuine drift, not a
# one-off network hiccup — parity with the classifier's own fetch_json retry
# (review: brtkwr on #153).
fetched=0
for attempt in 1 2 3; do
    if gh api -H "Accept: application/vnd.github.raw" \
           "repos/${canonical_repo}/contents/${canonical_path}?ref=${canonical_ref}" \
           > "$canonical" 2>/dev/null; then
        fetched=1
        break
    fi
    [ "$attempt" -lt 3 ] && sleep 3
done
if [ "$fetched" -ne 1 ]; then
    echo "::error::matrix-script-parity: failed to fetch canonical ${canonical_path} from ${canonical_repo}@${canonical_ref} after 3 attempts."
    exit 1
fi

l_sha=$(sha256sum "$local_script" | cut -d' ' -f1)
c_sha=$(sha256sum "$canonical"    | cut -d' ' -f1)

if [ "$l_sha" != "$c_sha" ]; then
    echo "::error::matrix-script-parity: dev/magento-support-matrix.sh has drifted from ${canonical_repo}@${canonical_ref}."
    echo "  local sha256:     $l_sha"
    echo "  canonical sha256: $c_sha"
    echo "  Re-sync from the source of truth (magento-plugin is canonical)."
    diff "$canonical" "$local_script" | head -80
    exit 1
fi

echo "matrix-script-parity OK: dev/magento-support-matrix.sh matches ${canonical_repo}@${canonical_ref} (sha256=$l_sha)."
