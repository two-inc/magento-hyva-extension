#!/usr/bin/env bash
# dev/matrix-script-parity.sh — drift guard for the CI scripts vendored from
# the vanilla `two-inc/magento-plugin` repo:
#
#   dev/magento-support-matrix.sh  the version-support classifier (TWO-24998)
#   dev/check-php-patch.sh         the image PHP-patch check (TWO-27174)
#
# Both are vendored byte-for-byte (TWO-24998 chose a vendored copy + this guard
# over a submodule/subtree for single shell scripts). Any divergence between
# the two copies is CI red, so a fix in one repo can't silently rot in the
# other.
#
# The canonical copy is read from magento-plugin's `staging`, except on a pull
# request whose branch name also exists on magento-plugin: then it is read from
# that paired branch, so a change to both copies can land as two PRs under the
# same branch name. Merge the magento-plugin side first; once its branch is
# deleted, this repo's next run compares against `staging` again.
#
# To update without a paired branch: change the canonical copy on
# magento-plugin first, land it on `staging`, then copy the identical file here
# in a follow-up PR.
#
# Mirrors dev/agents-convention-parity.sh (the AGENTS.md drift guard).

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
canonical_repo="two-inc/magento-plugin"
vendored=(dev/magento-support-matrix.sh dev/check-php-patch.sh)

if ! command -v gh >/dev/null 2>&1; then
    echo "::error::matrix-script-parity: gh CLI required for the cross-repo parity check."
    exit 1
fi

canonical_ref="staging"
paired="${GITHUB_HEAD_REF:-}"
if [ -n "$paired" ] && gh api "repos/${canonical_repo}/branches/${paired}" >/dev/null 2>&1; then
    canonical_ref="$paired"
fi
echo "matrix-script-parity: comparing with ${canonical_repo}@${canonical_ref}"

canonical=$(mktemp)
trap 'rm -f "$canonical"' EXIT

failed=0
for path in "${vendored[@]}"; do
    local_script="${repo_root}/${path}"
    if [ ! -f "$local_script" ]; then
        echo "::error::matrix-script-parity: local $path missing at $local_script"
        failed=1
        continue
    fi

    # Fetch the raw file via the GitHub raw media type — avoids the JSON+base64
    # round-trip (and `base64 -d`'s GNU/BSD flag portability quirk). Retry a
    # few times so a transient API blip reds the check only for genuine drift,
    # not a one-off network hiccup — parity with the classifier's own
    # fetch_json retry.
    fetched=0
    for attempt in 1 2 3; do
        if gh api -H "Accept: application/vnd.github.raw" \
               "repos/${canonical_repo}/contents/${path}?ref=${canonical_ref}" \
               > "$canonical" 2>/dev/null; then
            fetched=1
            break
        fi
        [ "$attempt" -lt 3 ] && sleep 3
    done
    if [ "$fetched" -ne 1 ]; then
        echo "::error::matrix-script-parity: failed to fetch canonical ${path} from ${canonical_repo}@${canonical_ref} after 3 attempts."
        failed=1
        continue
    fi

    l_sha=$(sha256sum "$local_script" | cut -d' ' -f1)
    c_sha=$(sha256sum "$canonical"    | cut -d' ' -f1)

    if [ "$l_sha" != "$c_sha" ]; then
        echo "::error::matrix-script-parity: ${path} has drifted from ${canonical_repo}@${canonical_ref}."
        echo "  local sha256:     $l_sha"
        echo "  canonical sha256: $c_sha"
        echo "  Re-sync from the source of truth (magento-plugin is canonical)."
        diff "$canonical" "$local_script" | head -80 || true
        failed=1
        continue
    fi

    echo "matrix-script-parity OK: ${path} matches ${canonical_repo}@${canonical_ref} (sha256=$l_sha)."
done

exit "$failed"
