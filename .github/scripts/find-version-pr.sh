#!/usr/bin/env bash
# Finds the pull request "Version bump" decides for, from the open PRs whose
# head is HEAD_SHA (ISEC-853). A commit status belongs to the SHA, not to one
# PR, so every open PR on that SHA into a branch that requires `version-current`
# (staging, main, release) is considered, whichever branch it comes from.
#
# Prints key=value lines on stdout:
#   verdict_state, verdict_description   the lookup alone decided the status
#   number, head_branch, same_repo       otherwise: decide for this PR
#   signature                            always; equal output means equal input
#
# Run once to decide and again just before a success is posted, so a PR
# opened, closed or retargeted in between cannot reuse a stale success.
#
# Env: GH_TOKEN, GITHUB_REPOSITORY, HEAD_SHA.
set -euo pipefail

[[ "$HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::Unexpected head SHA." >&2; exit 1; }

# Only PRs into the three protected branches need or consume this status. A PR
# into any other branch is ignored, so it can neither block nor reuse a verdict.
all=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls?state=open&per_page=100" \
  --jq '.[] | select(.head.sha == env.HEAD_SHA) | select(.base.ref == "staging" or .base.ref == "main" or .base.ref == "release")
        | {number, base: .base.ref, head_ref: .head.ref, head_repo: .head.repo.full_name}' | jq -s 'sort_by(.number)')

# Fork PRs. Anyone can push a same-repo PR's exact commit to a fork and open a
# PR with it, and this repo is public, so when a PR from this repo shares the
# head, fork PRs are left out: they cannot block it. A fork PR on the same SHA
# has the same content, so the same verdict applies to it, and a pushed bump
# moves only the same-repo branch. A fork PR into main or release still needs
# the reviews those branches require.
same=$(jq --arg r "$GITHUB_REPOSITORY" '[.[] | select(.head_repo == $r)]' <<<"$all")
if [ "$(jq length <<<"$same")" -gt 0 ]; then prs=$same; else prs=$all; fi

verdict() { # state description
  printf 'verdict_state=%s\nverdict_description=%s\nsignature=%s:%s\n' "$1" "$2" "$1" "$2"
  exit 0
}

into_staging=$(jq '[.[] | select(.base == "staging")]' <<<"$prs")
n_staging=$(jq length <<<"$into_staging")
# PRs into main or release on this SHA that are not same-repo promotions.
n_other=$(jq --arg r "$GITHUB_REPOSITORY" '[.[] | select(.base != "staging") | select((.head_repo == $r and (.head_ref == "staging" or .head_ref == "main")) | not)] | length' <<<"$prs")

if [ "$n_staging" -gt 1 ] && [ "$(jq --arg r "$GITHUB_REPOSITORY" '[.[] | select(.head_repo == $r)] | length' <<<"$into_staging")" -gt 0 ]; then
  # Same-repo PRs get a pushed bump, and one push cannot serve two branches.
  # (Several fork PRs on one SHA share a verdict and nothing is pushed.)
  verdict failure "Several PRs into staging share this head: give each its own commit"
elif [ "$n_staging" -ge 1 ] && [ "$n_other" -gt 0 ]; then
  # One status serves every PR on this SHA, so the staging verdict would also
  # pass a PR into main or release that is not a promotion.
  verdict failure "A PR into staging and a PR into main or release share this head: give each its own commit"
elif [ "$n_staging" -ge 1 ]; then
  pr=$(jq '.[0]' <<<"$into_staging")
elif [ "$(jq length <<<"$prs")" -gt 0 ]; then
  # Only PRs into main or release have this head. A promotion (head staging or
  # main, from this repo) gets success: its version was decided on staging. Any
  # other PR gets failure, so a later retarget to staging finds no success to
  # reuse and is re-decided.
  if jq -e --arg r "$GITHUB_REPOSITORY" 'all(.[]; .head_repo == $r and (.head_ref == "staging" or .head_ref == "main"))' <<<"$prs" >/dev/null; then
    verdict success "Promotion PR: version already decided"
  fi
  verdict failure "Only promotions from staging or main may target main or release"
else
  verdict failure "No open PR has this head"
fi

number=$(jq -r .number <<<"$pr")
head_repo=$(jq -r .head_repo <<<"$pr")
head_ref=$(jq -r .head_ref <<<"$pr")
same_repo=false
if [ "$head_repo" = "$GITHUB_REPOSITORY" ]; then
  same_repo=true
  # Only a same-repo branch is ever pushed to, and its name becomes part of an
  # API path, so refuse anything odd. A fork's branch name is never used.
  if ! [[ "$head_ref" =~ ^[A-Za-z0-9._/-]+$ ]] || [[ "$head_ref" == */ || "$head_ref" == /* || "$head_ref" == *..* ]]; then
    verdict failure "Unsupported head branch name: rename the branch"
  fi
  # A PR from main into staging is a merge-back (decided later). Nothing may
  # bump staging or release themselves. A fork's own `staging` (the default
  # branch, so "Contribute" opens a PR from it) is an ordinary branch here.
  if [ "$head_ref" = staging ] || [ "$head_ref" = release ]; then
    verdict failure "Head branch ${head_ref} cannot be bumped"
  fi
fi
printf 'number=%s\nhead_branch=%s\nsame_repo=%s\nsignature=decide:%s:%s:%s\n' \
  "$number" "$([ "$same_repo" = true ] && echo "$head_ref")" "$same_repo" "$number" "$same_repo" "$([ "$same_repo" = true ] && echo "$head_ref")"
