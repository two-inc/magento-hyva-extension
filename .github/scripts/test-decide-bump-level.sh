#!/usr/bin/env bash
#
# Unit tests for decide-bump-level.sh.
#
# Each case builds a throwaway git repo with a real `origin/main` and
# `origin/staging` (as remote-tracking refs, so `git show origin/main:...` and
# `origin/staging..HEAD` behave exactly as they do in CI), lays the PR's commits
# on top of staging, runs the script and asserts `set_version` / `changed`.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/decide-bump-level.sh"
CHECKER="$(cd "$(dirname "$0")" && pwd)/check-upgrade-script-version.sh"
TMPROOT=$(mktemp -d)
trap 'rm -rf "$TMPROOT"' EXIT

pass=0
fail=0

# write_version <version>  — bumpver.toml as the repos have it
write_version() {
    cat >bumpver.toml <<EOF
[tool.bumpver]
current_version = "$1"
version_pattern = "MAJOR.MINOR.PATCH[-TAGNUM]"
commit_message = "chore: Bump version {old_version} -> {new_version}"
EOF
}

# new_repo <name> <main-version> <staging-version> [next-major] [--no-main-bumpver]
new_repo() {
    local name=$1 mainv=$2 stagingv=$3 nextmajor=${4:-2} nomain=${5:-}
    local d="$TMPROOT/$name"
    mkdir -p "$d"
    cd "$d" || exit 1
    git init -q -b main .
    git config user.email t@t.t
    git config user.name t
    git config commit.gpgsign false

    if [ "$nomain" = "--no-main-bumpver" ]; then
        # PrestaShop's `main`: no bumpver.toml, version only in the module files.
        cat >config.xml <<EOF
<?xml version="1.0" encoding="UTF-8" ?>
<module>
    <version><![CDATA[${mainv}]]></version>
</module>
EOF
    else
        write_version "$mainv"
    fi
    [ -n "$nextmajor" ] && echo "$nextmajor  # declared" >.next-major
    git add -A
    git commit -qm "chore: initial main at ${mainv}"
    git update-ref refs/remotes/origin/main HEAD

    # staging carries bumpver.toml in every repo.
    write_version "$stagingv"
    git add -A
    git commit -q --allow-empty -m "chore: Bump version ${mainv} -> ${stagingv}"
    git update-ref refs/remotes/origin/staging HEAD
}

# commit <subject> [body]
commit() {
    echo "$RANDOM$RANDOM" >>"work-$(date +%s%N).txt"
    git add -A
    if [ -n "${2:-}" ]; then
        git commit -qm "$1" -m "$2"
    else
        git commit -qm "$1"
    fi
}

# set_head_version <version> — simulates a bump commit already on the PR head
set_head_version() {
    write_version "$1"
    git add -A
    git commit -qm "chore: Bump version x -> $1"
}

check() {
    local label=$1 want_version=$2 want_changed=$3
    local out
    out=$("$SCRIPT" 2>/dev/null)
    local got_v got_c
    got_v=$(printf '%s\n' "$out" | sed -n 's/^set_version=//p')
    got_c=$(printf '%s\n' "$out" | sed -n 's/^changed=//p')
    if [ "$got_v" = "$want_version" ] && [ "$got_c" = "$want_changed" ]; then
        printf 'PASS  %-58s set_version=%s changed=%s\n' "$label" "$got_v" "$got_c"
        pass=$((pass + 1))
    else
        printf 'FAIL  %-58s want set_version=%s changed=%s / got set_version=%s changed=%s\n' \
            "$label" "$want_version" "$want_changed" "$got_v" "$got_c"
        fail=$((fail + 1))
    fi
}

check_fails() {
    local label=$1 want_substr=$2
    local out rc
    out=$("$SCRIPT" 2>&1)
    rc=$?
    if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qF "$want_substr"; then
        printf 'PASS  %-58s exit=%s (errored as expected)\n' "$label" "$rc"
        pass=$((pass + 1))
    else
        printf 'FAIL  %-58s wanted non-zero exit mentioning "%s"; got exit=%s: %s\n' \
            "$label" "$want_substr" "$rc" "$out"
        fail=$((fail + 1))
    fi
}

# check_upgrade <label> <expected-version> ok|reject
check_upgrade() {
    local label=$1 expected=$2 want=$3
    local out rc
    # check-upgrade-script-version.sh only exists in the PrestaShop repo — the
    # filename-based upgrade mechanism it guards is PrestaShop's alone.
    if [ ! -x "$CHECKER" ]; then
        printf 'SKIP  %-58s (no check-upgrade-script-version.sh in this repo)\n' "$label"
        return 0
    fi
    out=$("$CHECKER" "$expected" 2>&1)
    rc=$?
    if { [ "$want" = ok ] && [ "$rc" -eq 0 ]; } || { [ "$want" = reject ] && [ "$rc" -ne 0 ]; }; then
        printf 'PASS  %-58s exit=%s\n' "$label" "$rc"
        pass=$((pass + 1))
    else
        printf 'FAIL  %-58s wanted %s, got exit=%s: %s\n' "$label" "$want" "$rc" "$out"
        fail=$((fail + 1))
    fi
}

echo "=============================================================================="
echo " decide-bump-level.sh — unit tests"
echo "=============================================================================="
echo

echo "--- classification (main 2.1.2, staging == main) -----------------------------"
new_repo cls-fix 2.1.2 2.1.2
commit "TWO-1/fix: correct the thing"
check "fix only -> patch" 2.1.3 true

new_repo cls-feat 2.1.2 2.1.2
commit "TWO-1/feat: add the thing"
check "feat -> minor" 2.2.0 true

new_repo cls-breaking 2.1.2 2.1.2
commit "TWO-1/feat!: drop the old thing"
check "feat! -> major" 3.0.0 true

new_repo cls-footer 2.1.2 2.1.2
commit "TWO-1/refactor: rework internals" "BREAKING CHANGE: config key renamed"
check "BREAKING CHANGE footer -> major" 3.0.0 true

new_repo cls-chore 2.1.2 2.1.2
commit "chore: tidy up"
commit "docs: rewrite the readme"
commit "ci: pin an action"
check "chore/docs/ci only -> patch (NOT minor)" 2.1.3 true

new_repo cls-mixed 2.1.2 2.1.2
commit "docs: note the flag"
commit "TWO-1/feat(checkout): new term selector"
commit "chore: lint"
check "one feat among chores -> minor" 2.2.0 true

echo
echo "--- idempotence / no-op re-runs ---------------------------------------------"
new_repo idem 2.1.2 2.1.2
commit "TWO-1/fix: correct the thing"
set_head_version 2.1.3
check "re-run after its own bump -> no change" 2.1.3 false

new_repo idem2 2.1.2 2.1.2
commit "TWO-1/fix: first fix"
set_head_version 2.1.3
commit "TWO-1/fix: second fix on the same PR"
check "second fix commit on the same PR -> no change" 2.1.3 false

new_repo fixafterfeat 2.1.2 2.1.2
commit "TWO-1/feat: new thing"
set_head_version 2.2.0
commit "TWO-1/fix: fix the new thing"
check "fix after feat stays at the minor" 2.2.0 false

new_repo breakafterfeat 2.1.2 2.1.2
commit "TWO-1/feat: new thing"
set_head_version 2.2.0
commit "TWO-1/feat!: and now it breaks"
check "breaking after feat escalates to major" 3.0.0 true

echo
echo "--- stale main: the clamp (PrestaShop's real shape) --------------------------"
new_repo stale 2.5.1 2.7.0
commit "TWO-1/fix: correct the thing"
check "stale main 2.5.1 vs staging 2.7.0, fix -> clamp holds at 2.7.0" 2.7.0 false

new_repo stale-feat 2.5.1 2.7.0
commit "TWO-1/feat: add the thing"
check "stale main, feat -> candidate 2.6.0 clamped, no regression" 2.7.0 false

new_repo caughtup 2.7.0 2.7.0
commit "TWO-1/fix: correct the thing"
check "once main catches up (2.7.0) the patch cadence resumes" 2.7.1 true

new_repo stale-break 2.5.1 2.7.0
commit "TWO-1/feat!: break the thing"
check "stale main, breaking -> 3.0.0 beats the clamp" 3.0.0 true

new_repo stale-nomain 2.5.1 2.7.0 2 --no-main-bumpver
commit "TWO-1/fix: correct the thing"
check "main has no bumpver.toml (config.xml fallback reads 2.5.1)" 2.7.0 false

echo
echo "--- .next-major -------------------------------------------------------------"
new_repo nm-armed 2.1.2 2.1.2 3
commit "chore: prepare the migration"
check ".next-major=3 with no breaking commit -> 3.0.0" 3.0.0 true

new_repo nm-disarmed 3.0.1 3.0.1 3
commit "TWO-1/fix: correct the thing"
check ".next-major=3 already shipped -> disarms itself" 3.0.2 true

new_repo nm-skip 2.1.2 2.1.2 5
commit "chore: prepare"
check ".next-major may skip majors -> 5.0.0" 5.0.0 true

new_repo nm-stale 3.0.1 3.0.1 2
commit "TWO-1/fix: correct the thing"
check_fails ".next-major below main's major -> hard error" "always stale"

echo
echo "--- PrestaShop upgrade-script clause ----------------------------------------"
# staging already carries upgrade-2.7.0.php, matching its declared 2.7.0. This is
# the shape the real repo is in.
seed_ps() {
    new_repo "$1" 2.5.1 2.7.0
    mkdir -p upgrade
    echo "<?php // upgrade" >upgrade/upgrade-2.7.0.php
    git add -A
    git commit -qm "chore: seed the existing upgrade script"
    git update-ref refs/remotes/origin/staging HEAD
}

seed_ps ps-force
commit "TWO-1/fix: correct the thing"
echo "<?php // new migration" >upgrade/upgrade-2.7.1.php
git add -A
git commit -qm "TWO-1/fix: migrate the column"
check "adds a NEW upgrade script, rule says no change -> forced patch" 2.7.1 true
check_upgrade "  filename matches the computed version -> accepted" 2.7.1 ok

seed_ps ps-converged
commit "TWO-1/fix: correct the thing"
echo "<?php // new migration" >upgrade/upgrade-2.7.1.php
git add -A
git commit -qm "TWO-1/fix: migrate the column"
set_head_version 2.7.1
check "re-run after the forced bump -> no second force" 2.7.1 false

seed_ps ps-edit
commit "TWO-1/fix: correct the thing"
echo "<?php // edited in place" >upgrade/upgrade-2.7.0.php
git add -A
git commit -qm "TWO-1/fix: tweak the existing migration"
check "EDITS an existing upgrade script -> no forced bump" 2.7.0 false

seed_ps ps-misnamed
commit "TWO-1/fix: correct the thing"
echo "<?php // new migration" >upgrade/upgrade-2.9.9.php
git add -A
git commit -qm "TWO-1/fix: migrate the column"
check "misnamed new script does not steer the version" 2.7.1 true
check_upgrade "  filename does NOT match -> PR rejected" 2.7.1 reject

seed_ps ps-with-feat
commit "TWO-1/feat: new capability"
echo "<?php // new migration" >upgrade/upgrade-2.7.1.php
git add -A
git commit -qm "TWO-1/feat: migrate the column"
check "feat + new script: rule already bumps, no double bump" 2.7.1 true

seed_ps ps-noscript
commit "TWO-1/fix: correct the thing"
check_upgrade "  no new upgrade script -> nothing to check" 2.7.1 ok

echo
echo "--- range hygiene -----------------------------------------------------------"
# A `feat!:` already merged to staging must NOT be re-discovered by later PRs.
new_repo range 2.1.2 2.1.2
commit "TWO-0/feat!: the break that already landed"
git update-ref refs/remotes/origin/staging HEAD
commit "chore: unrelated tidy-up"
check "breaking commit already on staging is not re-discovered" 2.1.3 true

new_repo empty 2.1.2 2.1.2
check "no commits in range -> still proposes the patch floor" 2.1.3 true

echo
echo "=============================================================================="
printf ' %d passed, %d failed\n' "$pass" "$fail"
echo "=============================================================================="
[ "$fail" -eq 0 ]
