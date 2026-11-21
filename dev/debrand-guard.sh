#!/usr/bin/env bash
# dev/debrand-guard.sh: no hardcoded brand name on a surface a brand overlay
# cannot debrand (TWO-27218).
#
# The rule and its scanner belong to the base module (two-inc/magento-plugin,
# `dev/debrand-grep.sh` on `staging`, rationale in its brand-overlay guide).
# This repo runs that script unchanged rather than keeping a copy: the scanner
# analyses the tree one level above the directory it sits in, so it is placed
# in this repo's dev/ for the run and removed afterwards. One rule, one source.
#
# Usage: bash dev/debrand-guard.sh
#   TWO_MAGENTO_PLUGIN_DIR=<base checkout>  use a local base checkout instead
#                                           of fetching the staging copy.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
canonical_repo="two-inc/magento-plugin"
canonical_ref="staging"
canonical_path="dev/debrand-grep.sh"

scanner=$(mktemp -p "${repo_root}/dev" .base-debrand-grep.XXXXXX)
trap 'rm -f "$scanner"' EXIT

if [ -n "${TWO_MAGENTO_PLUGIN_DIR:-}" ]; then
    cp "${TWO_MAGENTO_PLUGIN_DIR}/${canonical_path}" "$scanner"
else
    if ! command -v gh >/dev/null 2>&1; then
        echo "::error::debrand-guard: gh CLI required to fetch ${canonical_path} from ${canonical_repo}."
        exit 1
    fi
    fetched=0
    fetch_error=""
    for attempt in 1 2 3; do
        if fetch_error=$(gh api -H "Accept: application/vnd.github.raw" \
               "repos/${canonical_repo}/contents/${canonical_path}?ref=${canonical_ref}" \
               2>&1 > "$scanner"); then
            fetched=1
            break
        fi
        [ "$attempt" -lt 3 ] && sleep 3
    done
    if [ "$fetched" -ne 1 ]; then
        echo "::error::debrand-guard: failed to fetch ${canonical_path} from ${canonical_repo}@${canonical_ref} after 3 attempts: ${fetch_error}"
        exit 1
    fi
fi

# An empty or truncated download must not pass as a clean scan.
if ! grep -q 'debrand-grep OK' "$scanner"; then
    echo "::error::debrand-guard: ${canonical_path} from ${canonical_repo} does not look like the scanner; refusing to report a pass."
    exit 1
fi

bash "$scanner"
