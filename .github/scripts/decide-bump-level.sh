#!/usr/bin/env bash
#
# Compute the version this pull request should land on `staging` with.
#
# The version describes the CHANGE, not the branch it is landing on. It is
# derived from the conventional-commit types of the commits this PR adds, which
# is what semver actually asks for. The previous scheme ("patch on staging,
# minor on main") made the number describe the branch rule instead, so the same
# change got a different version depending on where it merged.
#
#   M = version on `origin/main`          - the last released version
#   C = version on this PR's head         - what the tree currently declares
#   L = conventional-commit classification of `<base>..<head> --no-merges`
#
#   breaking  ->  candidate = (M.major + 1).0.0
#   feat      ->  candidate = M.major.(M.minor + 1).0
#   otherwise ->  candidate = M.major.M.minor.(M.patch + 1)
#
#   new = max(C, candidate)            # version_compare semantics
#   new == C  ->  nothing to do
#
# Four properties this shape has deliberately, none of them incidental:
#
#  1. THE RANGE IS THIS PR'S COMMITS ONLY (`origin/staging..HEAD`), never the
#     cumulative `main..staging`. The cumulative range currently contains
#     `feat!:` commits in several of these repos, so every PR would keep
#     re-discovering the same break and re-proposing a major.
#
#  2. THE `max()` CLAMP, not "bump by one from C". This makes the computation
#     idempotent by construction - re-running on the same head is a no-op, a
#     second fix commit on the same PR is a no-op, and the version can NEVER
#     REGRESS. That last part is load-bearing because `main` sits behind
#     `staging` in these repos: with a stale main the raw candidate can compute
#     BELOW the version already on staging, and on PrestaShop that would
#     resurrect an already-run `upgrade/upgrade-<version>.php` filename.
#
#  3. ONLY `feat` EARNS A MINOR. `chore`, `docs`, `ci`, `test`, `refactor`,
#     `build`, `perf`, `style` all take a patch. The obvious-looking "minor
#     unless every commit is a fix" rule would send a docs-only PR to a minor.
#
#  4. `.next-major` IS COMPARED AGAINST MAIN'S MAJOR, not the head's. A
#     declaration below the released major is always stale, and is a hard error
#     rather than a silent no-op:
#
#         target_major = max(declared, M.major + breaking)
#
# PrestaShop-only clause: PrestaShop discovers upgrade scripts BY FILENAME and
# runs `upgrade/upgrade-<version>.php` only for versions strictly above the
# installed one. Appending a second migration to an already-installed version's
# script therefore never runs on a shop that already reached that version -
# silently, `number_upgraded=0`. So if this PR ADDS a new upgrade script and the
# rule above produced no version change, force a patch bump so the script gets a
# filename of its own. Editing an EXISTING script does not trigger this. The
# clause is inert in the repos that have no `upgrade/upgrade-*.php` at all.
#
# Usage:  decide-bump-level.sh [<base-ref>] [<head-ref>]
#         defaults: origin/staging HEAD
#         MAIN_REF overrides the released-version ref (default origin/main).
#
# Writes `set_version=`, `changed=` and `reason=` to stdout as `key=value`
# lines, and appends the same to $GITHUB_OUTPUT when running under Actions.
# `set_version` is ABSOLUTE and always populated; consumers pass it straight to
# `bumpver update --set-version`. There is no bump "level" any more - a level
# cannot express "clamp to what the tree already has".
set -euo pipefail

base_ref="${1:-origin/staging}"
head_ref="${2:-HEAD}"
main_ref="${MAIN_REF:-origin/main}"

repo_root=$(git rev-parse --show-toplevel)

die() {
    echo "::error::$*" >&2
    exit 1
}

# --- reading a version out of a ref ------------------------------------------
#
# bumpver.toml is the source of truth everywhere it exists. It does NOT exist on
# `main` in the PrestaShop repo (it was only ever added on `staging`), so fall
# back to the module's own declarations rather than crashing - reading M is not
# optional, it is the base of every candidate below.
read_version() {
    local ref="$1" v=""

    v=$(git show "${ref}:bumpver.toml" 2>/dev/null |
        sed -n 's/^[[:space:]]*current_version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | head -1) || true
    [ -n "$v" ] && {
        printf '%s' "$v"
        return 0
    }

    v=$(git show "${ref}:config.xml" 2>/dev/null |
        sed -n 's/.*<version><!\[CDATA\[\([^]]*\)\]\]><\/version>.*/\1/p' | head -1) || true
    [ -n "$v" ] && {
        printf '%s' "$v"
        return 0
    }

    v=$(git show "${ref}:twopayment.php" 2>/dev/null |
        sed -n "s/.*this->version[[:space:]]*=[[:space:]]*'\([^']*\)'.*/\1/p" | head -1) || true
    [ -n "$v" ] && {
        printf '%s' "$v"
        return 0
    }

    return 1
}

# MAJOR MINOR PATCH out of a version string, ignoring any -TAGNUM suffix.
split_version() {
    local v="${1%%-*}"
    [[ $v =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
    printf '%s %s %s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

# `version_compare` semantics: echo the greater of the two versions. Ties echo
# the first argument, which is why callers pass the head version first - a tie
# means "the tree already has it" and must not read as a change.
version_max() {
    local am ai ap bm bi bp
    read -r am ai ap <<<"$(split_version "$1")"
    read -r bm bi bp <<<"$(split_version "$2")"
    if [ "$am" -ne "$bm" ]; then
        if [ "$am" -gt "$bm" ]; then printf '%s' "$1"; else printf '%s' "$2"; fi
        return
    fi
    if [ "$ai" -ne "$bi" ]; then
        if [ "$ai" -gt "$bi" ]; then printf '%s' "$1"; else printf '%s' "$2"; fi
        return
    fi
    if [ "$ap" -ne "$bp" ]; then
        if [ "$ap" -gt "$bp" ]; then printf '%s' "$1"; else printf '%s' "$2"; fi
        return
    fi
    printf '%s' "$1"
}

main_version=$(read_version "$main_ref") ||
    die "could not read a version from ${main_ref} (tried bumpver.toml, config.xml, twopayment.php)"
head_version=$(read_version "$head_ref") ||
    die "could not read a version from ${head_ref} (tried bumpver.toml, config.xml, twopayment.php)"

main_parts=$(split_version "$main_version") ||
    die "unparseable version '${main_version}' on ${main_ref}"
read -r M_major M_minor M_patch <<<"$main_parts"
split_version "$head_version" >/dev/null ||
    die "unparseable version '${head_version}' on ${head_ref}"

# --- classify this PR's commits ----------------------------------------------
range="${base_ref}..${head_ref}"
subject_re='^([A-Z]+-[0-9]+/)?[a-z]+(\([^)]+\))?!:'
footer_re='^BREAKING[ -]CHANGE:'
feat_re='^([A-Z]+-[0-9]+/)?feat(\([^)]+\))?:'

breaking=0
breaking_reason=""
feat=0
feat_reason=""

while IFS= read -r subject; do
    [ -n "$subject" ] || continue
    if printf '%s' "$subject" | grep -qE "$subject_re"; then
        breaking=1
        breaking_reason="$subject"
        break
    fi
    if [ "$feat" -eq 0 ] && printf '%s' "$subject" | grep -qE "$feat_re"; then
        feat=1
        feat_reason="$subject"
    fi
done < <(git log "$range" --no-merges --format='%s')

if [ "$breaking" -eq 0 ]; then
    footer=$(git log "$range" --no-merges --format='%B' | grep -m1 -E "$footer_re" || true)
    if [ -n "$footer" ]; then
        breaking=1
        breaking_reason="$footer"
    fi
fi

# --- declared major (`.next-major`) ------------------------------------------
declared=0
declared_reason=""
next_major_file="${repo_root}/.next-major"
if [ -f "$next_major_file" ]; then
    raw=$(head -1 "$next_major_file")
    declared=$(printf '%s' "$raw" | awk '{print $1}')
    declared_reason=$(printf '%s' "$raw" | sed 's/^[^[:space:]]*[[:space:]]*//; s/^#[[:space:]]*//')
    case "$declared" in
        '' | *[!0-9]*)
            die ".next-major must start with the target major version as a bare integer; got '${raw}'"
            ;;
    esac
    # A declaration that has fallen behind the RELEASED major is always stale -
    # the major it declared has already shipped some other way. Ignoring it
    # silently lets it rot; honouring it would regress. Fail.
    if [ "$declared" -lt "$M_major" ]; then
        die ".next-major declares major ${declared} but ${main_ref} is at ${main_version} (major ${M_major}). A declaration below the released major is always stale - delete or raise it."
    fi
fi

target_major=$declared
discovered_major=$((M_major + breaking))
[ "$discovered_major" -gt "$target_major" ] && target_major=$discovered_major

# --- candidate ---------------------------------------------------------------
if [ "$target_major" -gt "$M_major" ]; then
    candidate="${target_major}.0.0"
    if [ "$declared" -ge "$target_major" ]; then
        why="declared .next-major=${declared}"
        [ -n "$declared_reason" ] && why="${why} (${declared_reason})"
    else
        why="breaking change: ${breaking_reason}"
    fi
elif [ "$feat" -eq 1 ]; then
    candidate="${M_major}.$((M_minor + 1)).0"
    why="feature: ${feat_reason}"
else
    candidate="${M_major}.${M_minor}.$((M_patch + 1))"
    why="no feature or breaking commit in this PR -> patch"
fi

new=$(version_max "$head_version" "$candidate")
if [ "$new" != "$candidate" ]; then
    why="${why}; clamped to the version already on the head (${head_version} >= candidate ${candidate})"
fi

# --- PrestaShop-only: a NEW upgrade script needs a filename of its own -------
#
# `--diff-filter=A` against the merge base, so an EDIT to an existing script
# never triggers this - only a genuinely new file does.
added_upgrade_scripts=""
if git rev-parse -q --verify "$base_ref" >/dev/null 2>&1; then
    added_upgrade_scripts=$(git diff --diff-filter=A --name-only \
        "${base_ref}...${head_ref}" -- 'upgrade/upgrade-*.php' 2>/dev/null || true)
fi

if [ -n "$added_upgrade_scripts" ] && [ "$new" = "$head_version" ]; then
    # ...unless one of the added scripts is ALREADY named for the head version.
    # That is the converged state: the script has a filename of its own and
    # forcing again on the next `synchronize` would bump forever.
    owns_its_filename=0
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        v=${path##*/upgrade-}
        v=${v%.php}
        [ "$v" = "$head_version" ] && owns_its_filename=1
    done <<<"$added_upgrade_scripts"

    if [ "$owns_its_filename" -eq 0 ]; then
        read -r n_major n_minor n_patch <<<"$(split_version "$new")"
        new="${n_major}.${n_minor}.$((n_patch + 1))"
        why="${why}; forced a patch because this PR adds a new upgrade script and PrestaShop discovers upgrade scripts by filename"
    else
        why="${why}; the new upgrade script is already named for this version"
    fi
fi

changed=false
[ "$new" != "$head_version" ] && changed=true

reason=$(printf '%s' "$why" | tr '\n' ' ')

{
    echo "----- version decision -----"
    echo "main (${main_ref})     : ${main_version}"
    echo "head (${head_ref})     : ${head_version}"
    echo "range                  : ${range}"
    if [ -f "$next_major_file" ]; then
        echo "declared major         : ${declared}${declared_reason:+  - ${declared_reason}}"
    else
        echo "declared major         : (no .next-major)"
    fi
    echo "breaking commit        : ${breaking_reason:-none}"
    echo "feature commit         : ${feat_reason:-none}"
    echo "added upgrade scripts  : $(printf '%s' "${added_upgrade_scripts:-none}" | tr '\n' ' ')"
    echo "candidate              : ${candidate}"
    echo "set_version            : ${new}  (changed=${changed})"
    echo "reason                 : ${reason}"
    echo "----------------------------"
} >&2

echo "set_version=${new}"
echo "changed=${changed}"
echo "reason=${reason}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "set_version=${new}"
        echo "changed=${changed}"
        echo "reason=${reason}"
    } >>"$GITHUB_OUTPUT"
fi
