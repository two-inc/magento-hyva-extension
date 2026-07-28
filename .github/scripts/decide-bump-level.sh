#!/usr/bin/env bash
#
# Decide the semantic-version bump level for a version-bump / release run.
#
# Convention:
#   patch  — change landing anywhere other than `main` (i.e. `staging`)
#   minor  — change landing on `main`
#   major  — escape hatch. Two independent signals, the higher wins:
#
#     Declared  a root `.next-major` file whose first whitespace-delimited
#               token is the target major, with a short human reason on the
#               same line. Human-editable and reviewable in the PR that
#               decides it, so a *planned* major with no single breaking
#               commit still lands as a major:
#
#                   3  # overlay migration, 3.0.0 release
#
#     Discovered  a `!` on a conventional-commit type (`feat!:`,
#                 `TWO-1/fix(scope)!:`) or a `BREAKING CHANGE:` footer in the
#                 commits under consideration. Covers a break that actually
#                 happened.
#
#   target = max(declared, current_major + (breaking ? 1 : 0))
#   target > current_major  ->  major, new version is exactly <target>.0.0
#   otherwise               ->  the branch rule above
#
# `.next-major` is deliberately NEVER cleared by CI. The `target >
# current_major` condition disarms it on its own once the major has shipped,
# and leaving the file in place keeps the declared intent reviewable. The one
# thing this scheme can still get wrong is a declaration that has fallen
# BEHIND the current major, so that is a hard failure (see below) rather than
# a silent no-op.
#
# Usage:  decide-bump-level.sh <branch> [<git-rev-range>]
#
# With no range, it is derived as "everything not already accounted for" — see
# the anchor list below. Deriving it carefully matters: a naive
# `<last-tag>..HEAD` would re-discover the same breaking commit on every single
# staging PR and major-bump over and over, because `staging` is only tagged
# when it reaches `main`.
#
# Writes `level=`, `set_version=` and `reason=` to stdout as `key=value`
# lines, and appends the same to $GITHUB_OUTPUT when running under Actions.
# The full decision — including the declared reason string — is logged on
# every run, so a stale `.next-major` is visible without digging.
set -euo pipefail

branch="${1:?usage: decide-bump-level.sh <branch> [<git-rev-range>]}"
range="${2:-}"

repo_root=$(git rev-parse --show-toplevel)
toml="${repo_root}/bumpver.toml"
[ -f "$toml" ] || { echo "::error::no bumpver.toml at ${toml}" >&2; exit 1; }

current=$(sed -n 's/^[[:space:]]*current_version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$toml" | head -1)
[ -n "$current" ] || { echo "::error::could not read current_version from ${toml}" >&2; exit 1; }
current_major=${current%%.*}
case "$current_major" in
    '' | *[!0-9]*) echo "::error::unparseable current_version '${current}' in ${toml}" >&2; exit 1 ;;
esac

# --- derive the range, if not given ------------------------------------------
#
# The base is the closest-to-HEAD of three anchors, each meaning "everything
# before this is already accounted for":
#
#   1. the last version-bump commit — the normal steady-state anchor;
#   2. the newest semver tag reachable from HEAD — covers a release cut
#      without a bump commit on this branch;
#   3. the commit that first added THIS script — the activation floor.
#
# (3) is what stops the very first run from re-discovering years of already
# shipped `feat!:` commits and jumping several majors. Without it, four of the
# six plugin repos would have gone straight to 3.0.0 the moment this landed.
# It costs nothing afterwards: once a bump commit exists it is always closer
# to HEAD, so (1) takes over and (3) never binds again.
if [ -z "$range" ]; then
    # Subject prefix of a bump commit, taken from bumpver's own configured
    # commit_message so the two can't drift — the capitalisation of "bump"
    # is not consistent across repos, so it must not be hardcoded here.
    bump_msg=$(sed -n 's/^[[:space:]]*commit_message[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$toml" | head -1)
    bump_prefix=${bump_msg%%\{*}
    bump_prefix=${bump_prefix%% }
    [ -n "$bump_prefix" ] || bump_prefix="chore: Bump version"

    self_rel=".github/scripts/decide-bump-level.sh"

    candidates=""
    add_candidate() {
        [ -n "$1" ] || return 1
        # Only anchors on this history are usable as a range base.
        git merge-base --is-ancestor "$1" HEAD 2>/dev/null || return 1
        candidates="${candidates}${1}
"
    }

    add_candidate "$(git log -1 --format='%H' --fixed-strings --grep="$bump_prefix" HEAD || true)" || true
    # Version-sorted, so the first tag that is actually reachable is the newest.
    for t in $(git tag --list --sort=-v:refname | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' || true); do
        if add_candidate "$(git rev-parse -q --verify "refs/tags/${t}^{commit}" || true)"; then
            break
        fi
    done
    add_candidate "$(git -C "$repo_root" log --diff-filter=A --format='%H' -1 -- "$self_rel" || true)" || true

    # Closest to HEAD wins — fewest commits between it and HEAD.
    base=""
    best=""
    while IFS= read -r c; do
        [ -n "$c" ] || continue
        n=$(git rev-list --count "${c}..HEAD")
        if [ -z "$best" ] || [ "$n" -lt "$best" ]; then
            best="$n"
            base="$c"
        fi
    done <<EOF
${candidates}
EOF

    if [ -n "$base" ]; then
        range="${base}..HEAD"
    else
        range="HEAD"
    fi
fi

# --- signal 1: declared major -------------------------------------------------
declared=0
declared_reason=""
next_major_file="${repo_root}/.next-major"
if [ -f "$next_major_file" ]; then
    raw=$(head -1 "$next_major_file")
    declared=$(printf '%s' "$raw" | awk '{print $1}')
    declared_reason=$(printf '%s' "$raw" | sed 's/^[^[:space:]]*[[:space:]]*//; s/^#[[:space:]]*//')
    case "$declared" in
        '' | *[!0-9]*)
            echo "::error::.next-major must start with the target major version as a bare integer; got '${raw}'" >&2
            exit 1
            ;;
    esac
    # The failure mode this scheme can still get wrong: a declaration left
    # behind by a major that has already shipped some other way. Silently
    # ignoring it would let it rot; regressing to it would be worse. Fail.
    if [ "$declared" -lt "$current_major" ]; then
        echo "::error::.next-major declares major ${declared} but the current version is ${current} (major ${current_major}). A declaration below the current major is always stale — delete or raise it." >&2
        exit 1
    fi
fi

# --- signal 2: discovered breaking change ------------------------------------
breaking=0
breaking_reason=""
subject_re='^([A-Z]+-[0-9]+/)?[a-z]+(\([^)]+\))?!:'
footer_re='^BREAKING[ -]CHANGE:'

while IFS= read -r subject; do
    if printf '%s' "$subject" | grep -qE "$subject_re"; then
        breaking=1
        breaking_reason="$subject"
        break
    fi
done < <(git log "$range" --no-merges --format='%s')

if [ "$breaking" -eq 0 ]; then
    footer=$(git log "$range" --no-merges --format='%B' | grep -m1 -E "$footer_re" || true)
    if [ -n "$footer" ]; then
        breaking=1
        breaking_reason="$footer"
    fi
fi

# --- combine ------------------------------------------------------------------
discovered=$current_major
[ "$breaking" -eq 1 ] && discovered=$((current_major + 1))

target=$declared
[ "$discovered" -gt "$target" ] && target=$discovered

set_version=""
if [ "$target" -gt "$current_major" ]; then
    level=major
    # `--set-version` rather than `--major`: a declaration may skip more than
    # one major (current 2, declared 4), which `bumpver --major` cannot express.
    set_version="${target}.0.0"
    if [ "$declared" -ge "$target" ]; then
        why="declared .next-major=${declared}"
        [ -n "$declared_reason" ] && why="${why} (${declared_reason})"
    else
        why="discovered breaking change: ${breaking_reason}"
    fi
elif [ "$branch" = "main" ]; then
    level=minor
    why="branch rule: main -> minor"
else
    level=patch
    why="branch rule: ${branch} -> patch"
fi

reason=$(printf '%s' "$why" | tr '\n' ' ')

# Always log the whole decision, not just the outcome — a stale declaration or
# an unexpected breaking commit is only visible if the inputs are printed too.
{
    echo "----- bump level decision -----"
    echo "branch          : ${branch}"
    echo "range           : ${range}"
    echo "current version : ${current} (major ${current_major})"
    if [ -f "$next_major_file" ]; then
        echo "declared major  : ${declared}${declared_reason:+  — ${declared_reason}}"
    else
        echo "declared major  : (no .next-major)"
    fi
    echo "breaking commit : ${breaking_reason:-none}"
    echo "target major    : ${target}"
    echo "level           : ${level}${set_version:+  -> ${set_version}}"
    echo "reason          : ${reason}"
    echo "-------------------------------"
} >&2

echo "level=${level}"
echo "set_version=${set_version}"
echo "reason=${reason}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "level=${level}"
        echo "set_version=${set_version}"
        echo "reason=${reason}"
    } >> "$GITHUB_OUTPUT"
fi
