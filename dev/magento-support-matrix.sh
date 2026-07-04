#!/usr/bin/env bash
# dev/magento-support-matrix.sh — discover AND CLASSIFY the CI version matrix
# dynamically from upstream.
#
# Usage:
#   ./dev/magento-support-matrix.sh                        # human-readable report
#   ./dev/magento-support-matrix.sh --emit-matrix          # GHA matrix JSON: RUNNABLE Magento × PHP combos
#   ./dev/magento-support-matrix.sh --emit-skips           # JSON: combos we CANNOT run, with reasons
#   ./dev/magento-support-matrix.sh --emit-php-lint-matrix # GHA matrix JSON: PHP-only (lint / phpunit jobs)
#
# This script CLASSIFIES every combination inside the current support window
# as run | skip, then splits the two:
#   --emit-matrix  → only runnable combos. These become real matrix legs, so a
#                    green leg genuinely means "tested" — a skipped combo is
#                    NEVER emitted here and so can never masquerade as a passed
#                    test (TWO-24998: the run/skip decision happens at
#                    matrix-assembly time, not inside a green job).
#   --emit-skips   → the combos we could not run, each with a skip_reason. The
#                    discover job renders these to $GITHUB_STEP_SUMMARY and
#                    emits a ::warning:: per combo so an untested combination is
#                    visible at a glance and cannot be mistaken for a pass.
# Nothing testable is silently green; nothing untestable silently vanishes.
#
# Strategy:
#   1. Query github.com/magento/magento2 tags for bare-semver 2.4.x.
#   2. Support window = current minor + (SUPPORT_WINDOW-1) previous minors,
#      taken over ALL minors. Image availability does NOT slide the window:
#      an in-policy minor with no CI image is surfaced as a skip, it is NOT
#      silently replaced by an older out-of-policy minor (TWO-24998 Defect 2 —
#      "the window silently trails a minor behind").
#   3. For each window minor: fetch composer.json, parse require.php → the
#      PHP minors it accepts (e.g. "~8.2.0||~8.3.0||~8.4.0" → 8.2 8.3 8.4).
#   4. php.net/releases → currently-supported PHP minors.
#   5. Classify each (window-minor × accepted-PHP) combo, first matching wins:
#        past upstream PHP support   — accepted by Magento but EOL per php.net
#        intentionally excluded: ... — on the manual list (usually empty now)
#        no CI image published       — deterministic image tag has no manifest
#        run                         — otherwise
#   6. Emit every combo with its status. The php-lint matrix is the union of
#      php.net-supported accepted PHP minors — image-independent, since the
#      lint / phpunit jobs use setup-php, not the Magento docker images.
#
# Replaces the hand-maintained EOL list AND the hand-maintained min-PHP map
# with upstream discovery (Doug 2026-05-22, r5 #10). TWO-24998 additionally
# retired the hand-maintained image-exclusion entries in favour of a docker
# manifest probe (see intentionally_excluded + probe_image below).

set -euo pipefail

# How many minor lines (current + previous) we support. Adobe's policy is
# "current + previous 2" → 3 total. This bounds the window over ALL published
# minors; it does NOT skip over image-less minors (see header note 2).
SUPPORT_WINDOW=${SUPPORT_WINDOW:-3}

CI_IMAGE_REPO="michielgerritsen/magento-project-community-edition"

# Combos we DELIBERATELY choose not to test even though a CI image exists.
# This is NOT the place for "no image published yet" — that case is detected
# automatically by the docker manifest probe (probe_image) and surfaced as a
# `no CI image published` skip. Expect this list to stay empty; add an entry
# only for a genuine "we will not test X" policy decision, documenting why.
#
#   "<magento>:<reason>"               whole-minor: every PHP pairing skips
#   "<magento>:php=<X.Y>:<reason>"     single combo: only that PHP pairing skips
intentionally_excluded=(
)

mode=report
case "${1:-}" in
    --emit-matrix) mode=matrix ;;
    --emit-skips) mode=skips ;;
    --emit-php-lint-matrix) mode=php_lint ;;
    # One classification, all three slices in a single object. The CI discover
    # step uses this so the run-list, skip-list and lint-list come from ONE run
    # of the classifier — not three independent runs that each re-fetch upstream
    # and re-probe every image. Prevents a transient `docker manifest inspect`
    # blip from putting a combo in one slice but not its mirror, and cuts the
    # anonymous Docker Hub rate-limit exposure 3x (review: brtkwr on #237).
    --emit-all) mode=all ;;
    "") mode=report ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
esac

log() {
    [ "$mode" = "report" ] || return 0
    echo "$@"
}

# Authorise GitHub API when a token is available to dodge anon rate-limit.
# NB: only ever sent to github.com hosts (see fetch_json's use_auth arg) — we
# do NOT leak the token to php.net.
gh_headers=()
[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ] \
    && gh_headers=(-H "Authorization: Bearer ${GH_TOKEN:-$GITHUB_TOKEN}")

# ---------------------------------------------------------------------------
# fetch_json <description> <url> <use_gh_auth:0|1> [validator-jq-expr]
#
# Fetches with one retry on transient failure. Validates HTTP 200 and
# (optionally) the JSON shape before returning the body — a rate-limited /
# 502 / HTML response would otherwise surface as a cryptic downstream jq
# error like `Cannot index string with string "name"` instead of the real
# upstream problem. `use_gh_auth=1` attaches the GitHub bearer token; pass 0
# for third-party hosts (php.net) so credentials never leave github.com.
# ---------------------------------------------------------------------------
fetch_json() {
    local desc="$1" url="$2" use_auth="$3" validator="${4:-}"
    local headers=() attempt response http_code body
    [ "$use_auth" = "1" ] && headers=("${gh_headers[@]}")
    for attempt in 1 2; do
        if ! response=$(curl -sS --max-time 30 -w '\n%{http_code}' \
                -H 'Cache-Control: no-cache' "${headers[@]}" "$url" 2>&1); then
            echo "::warning::${desc} attempt ${attempt}: curl failed: ${response}" >&2
            [ "$attempt" -lt 2 ] && { sleep 5; continue; }
            echo "::error::${desc} unreachable after retry" >&2
            return 2
        fi
        http_code="${response##*$'\n'}"
        body="${response%$'\n'*}"
        if [ "$http_code" != "200" ]; then
            echo "::warning::${desc} attempt ${attempt}: HTTP ${http_code}" >&2
            printf 'Response body (first 500 chars): ' >&2
            printf '%s' "$body" | head -c 500 >&2; echo >&2
            [ "$attempt" -lt 2 ] && { sleep 5; continue; }
            echo "::error::${desc} persistently returning HTTP ${http_code}" >&2
            return 2
        fi
        if [ -n "$validator" ] && ! printf '%s' "$body" | jq -e "$validator" >/dev/null 2>&1; then
            echo "::warning::${desc} attempt ${attempt}: response failed shape check ($validator)" >&2
            printf 'Response body (first 500 chars): ' >&2
            printf '%s' "$body" | head -c 500 >&2; echo >&2
            [ "$attempt" -lt 2 ] && { sleep 5; continue; }
            echo "::error::${desc} persistently malformed" >&2
            return 2
        fi
        printf '%s' "$body"
        return 0
    done
    return 2
}

# ---------------------------------------------------------------------------
# probe_image <image-tag> → prints one of: exists | missing | error
#
# Distinguishes a genuinely-unpublished image (skip) from a transient
# registry failure (fail TOWARD running the test, per TWO-24998 Phase 2 —
# a Docker Hub blip must not silently zero the matrix). `docker manifest
# inspect` returns non-zero for both cases, so we inspect stderr: a clear
# "not found"-class message → missing; anything else → retry once → error.
#
# Trade-off (by design, review: brtkwr on #237): because "error" maps to RUN,
# under degraded / rate-limited registry conditions a genuinely-missing image
# is classified `run` and surfaces as a RED matrix leg rather than the intended
# yellow (::warning::) skip. We prefer a loud red on a Docker Hub blip over a
# silent green that hides zero coverage. Every such case emits the ::warning::
# above, so the run/skip mismatch is greppable in the job log.
# ---------------------------------------------------------------------------
probe_image() {
    local img="$1" attempt out
    if ! command -v docker >/dev/null 2>&1; then
        echo "::warning::probe_image: docker CLI unavailable; treating '$img' as runnable" >&2
        echo error
        return 0
    fi
    for attempt in 1 2; do
        if out=$(DOCKER_CLI_EXPERIMENTAL=enabled docker manifest inspect "$img" 2>&1); then
            echo exists
            return 0
        fi
        if printf '%s' "$out" | grep -qiE 'no such manifest|manifest unknown|not found|does not exist'; then
            echo missing
            return 0
        fi
        [ "$attempt" -lt 2 ] && { sleep 3; continue; }
        echo "::warning::probe_image: '$img' inspect errored (not a clean 'missing'), defaulting to run: ${out}" >&2
        echo error
        return 0
    done
}

# ---------------------------------------------------------------------------
# Step 1: discover Magento minors from upstream tags; take the top-N window.
# ---------------------------------------------------------------------------
tags_json=$(fetch_json "GitHub tags API" \
    'https://api.github.com/repos/magento/magento2/tags?per_page=100' \
    1 'type == "array"') || exit 2

all_minors=$(printf '%s' "$tags_json" \
    | jq -r 'map(.name)
             | map(select(test("^2\\.4\\.[0-9]+$")))
             | sort_by(. | split(".") | map(tonumber))
             | reverse
             | .[]')

if [ -z "$all_minors" ]; then
    echo "::error::No bare-semver 2.4.x tags found on github.com/magento/magento2" >&2
    exit 2
fi

# Window = the SUPPORT_WINDOW most-recent minors, over ALL of them. We do NOT
# pre-filter image-less/excluded minors out before taking the top-N — doing so
# would let an older out-of-policy minor backfill the window and hide the fact
# that an in-policy minor is currently untestable (TWO-24998 Defect 2).
supported=$(echo "$all_minors" | head -n "$SUPPORT_WINDOW")
log "Magento support window ($SUPPORT_WINDOW most-recent minors):"
log "$supported" | sed 's/^/  /'

# Build intentional-exclusion maps. Two scopes:
#   excluded_minor_map[<magento>]       = reason    (whole-minor)
#   excluded_combo_map[<magento>|<php>] = reason    (single combo)
declare -A excluded_minor_map=()
declare -A excluded_combo_map=()
for entry in "${intentionally_excluded[@]:-}"; do
    [ -z "$entry" ] && continue
    ver="${entry%%:*}"
    rest="${entry#*:}"
    if [[ "$rest" == php=*:* ]]; then
        php_clause="${rest%%:*}"            # php=8.2
        reason="${rest#*:}"
        php_ver="${php_clause#php=}"        # 8.2
        excluded_combo_map["$ver|$php_ver"]="$reason"
    else
        excluded_minor_map["$ver"]="$rest"
    fi
done

# ---------------------------------------------------------------------------
# Step 2: discover currently-supported PHP minors from php.net.
# ---------------------------------------------------------------------------
php_releases_json=$(fetch_json "php.net releases feed" \
    'https://www.php.net/releases/?json' \
    0 'type == "object"') || exit 2

# Union of `supported_versions` across all majors, e.g. ["8.2","8.3","8.4","8.5"].
supported_php_minors=$(echo "$php_releases_json" \
    | jq -r '[.[].supported_versions[]?] | unique | .[]' \
    | sort -V)

if [ -z "$supported_php_minors" ]; then
    echo "::error::php.net/releases returned no currently-supported PHP minors" >&2
    exit 2
fi

log "Currently-supported PHP minors (php.net):"
log "$supported_php_minors" | sed 's/^/  /'

# ---------------------------------------------------------------------------
# Step 3: for each window minor, fetch composer.json and parse php constraint.
#
# Magento's constraint format is "~8.2.0||~8.3.0||~8.4.0" — one tilde range
# per supported minor, OR-joined. `~8.X.0` means ">=8.X.0,<8.(X+1).0", so each
# clause uniquely identifies one PHP minor.
# ---------------------------------------------------------------------------
declare -A magento_php_minors=()  # magento_minor → space-separated PHP minors
for minor in $supported; do
    composer_json=$(fetch_json "magento/magento2@$minor composer.json" \
        "https://raw.githubusercontent.com/magento/magento2/$minor/composer.json" \
        1 'type == "object"') || exit 2
    php_constraint=$(echo "$composer_json" | jq -r '.require.php // empty')
    if [ -z "$php_constraint" ]; then
        echo "::error::magento/magento2@$minor composer.json missing require.php" >&2
        exit 2
    fi
    # `|| true`: under `set -o pipefail`, grep exits 1 when a constraint has no
    # `~X.Y.0` clause (e.g. an unexpected format), which would terminate the
    # script here and bypass the diagnostic below. Swallow it so the empty-check
    # fires with a useful error instead.
    php_minors_for_magento=$(echo "$php_constraint" \
        | grep -oE '~[0-9]+\.[0-9]+\.0' \
        | sed -E 's/~([0-9]+\.[0-9]+)\.0/\1/' \
        | sort -V) || true
    if [ -z "$php_minors_for_magento" ]; then
        echo "::error::Could not parse php constraint '$php_constraint' for Magento $minor" >&2
        exit 2
    fi
    magento_php_minors["$minor"]=$(echo $php_minors_for_magento)
    log "  $minor accepts PHP: ${magento_php_minors[$minor]} (from '$php_constraint')"
done

# ---------------------------------------------------------------------------
# Step 4: classify every (window-minor × accepted-PHP) combo.
# ---------------------------------------------------------------------------
matrix_entries=()
declare -A php_lint_minors=()   # union of php.net-supported accepted PHP minors
run_count=0
skip_count=0

emit() {  # emit <magento> <php> <php_image> <status> <skip_reason>
    matrix_entries+=("$(jq -nc \
        --arg magento "$1" \
        --arg php "$2" \
        --arg php_image "$3" \
        --arg status "$4" \
        --arg skip_reason "$5" \
        '{magento:$magento, php:$php, php_image:$php_image, status:$status, skip_reason:$skip_reason}')")
    if [ "$4" = "run" ]; then run_count=$((run_count+1)); else skip_count=$((skip_count+1)); fi
}

for minor in $supported; do
    accepted="${magento_php_minors[$minor]:-}"
    [ -z "$accepted" ] && continue
    minor_excl="${excluded_minor_map[$minor]:-}"

    for php in $accepted; do
        php_image="php${php//./}-fpm"
        img_tag="${CI_IMAGE_REPO}:${php_image}-magento${minor}"

        # 1. Past upstream PHP support (php.net no longer lists this minor).
        if ! echo "$supported_php_minors" | grep -qxF "$php"; then
            emit "$minor" "$php" "$php_image" skip "past upstream PHP support"
            continue
        fi
        # php.net-supported → contributes to the (image-independent) lint set,
        # regardless of whether the Magento×PHP combo runs or skips below.
        php_lint_minors["$php"]=1

        # 2. Intentional exclusion (whole-minor, then single-combo).
        if [ -n "$minor_excl" ]; then
            emit "$minor" "$php" "$php_image" skip "intentionally excluded: $minor_excl"
            continue
        fi
        combo_excl="${excluded_combo_map[$minor|$php]:-}"
        if [ -n "$combo_excl" ]; then
            emit "$minor" "$php" "$php_image" skip "intentionally excluded: $combo_excl"
            continue
        fi

        # 3. CI image availability (auto-probed — no hand-maintained list).
        case "$(probe_image "$img_tag")" in
            missing)
                emit "$minor" "$php" "$php_image" skip "no CI image published ($img_tag)"
                continue
                ;;
        esac

        # 4. Runnable.
        emit "$minor" "$php" "$php_image" run ""
    done
done

if [ ${#matrix_entries[@]} -eq 0 ]; then
    echo "::error::No combos classified — window / constraint parsing failed" >&2
    exit 1
fi
if [ "$run_count" -eq 0 ]; then
    # Not fatal — an all-skip run is a legitimate (loud) signal that zero
    # combos are currently testable. The coverage-report job surfaces it.
    echo "::warning::Every in-window combo classified as SKIP — zero real version coverage this run" >&2
fi

# Full classified set, then split into the runnable matrix and the skip list.
# Runnable combos carry only the keys the test jobs consume ({magento, php,
# php_image}); skip combos carry their reason instead of an image.
classified_json=$(printf '%s\n' "${matrix_entries[@]}" | jq -sc '.')
run_json=$(echo "$classified_json" | jq -c '[.[] | select(.status == "run") | {magento, php, php_image}]')
skip_json=$(echo "$classified_json" | jq -c '[.[] | select(.status == "skip") | {magento, php, skip_reason}]')

if [ ${#php_lint_minors[@]} -eq 0 ]; then
    php_lint_json='[]'
else
    php_lint_json=$(printf '%s\n' "${!php_lint_minors[@]}" \
        | sort -V \
        | jq -R . | jq -sc 'map({php: .})')
fi

case "$mode" in
    matrix)
        echo "$run_json"
        ;;
    skips)
        echo "$skip_json"
        ;;
    php_lint)
        echo "$php_lint_json"
        ;;
    all)
        # Single-classification bundle for the CI discover step (see --emit-all).
        jq -nc \
            --argjson matrix "$run_json" \
            --argjson skips "$skip_json" \
            --argjson php_lint "$php_lint_json" \
            '{matrix: $matrix, skips: $skips, php_lint: $php_lint}'
        ;;
    report)
        echo ""
        echo "Classified Magento × PHP matrix ($run_count run, $skip_count skip):"
        echo "$classified_json" | jq -r '.[]
            | if .status == "skip"
              then "  SKIP  \(.magento) PHP \(.php) — \(.skip_reason)"
              else "  RUN   \(.magento) PHP \(.php)"
              end'
        echo ""
        echo "PHP lint matrix:"
        echo "$php_lint_json" | jq -r '.[].php | "  \(.)"'
        echo ""
        echo "magento-support-matrix OK."
        ;;
esac
