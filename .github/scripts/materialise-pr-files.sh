#!/usr/bin/env bash
# Writes out the few PR-head files "Version bump" reads, from git blobs, into a
# repository that has no checkout (ISEC-853).
#
# The PR head is never checked out in the trusted job: a working tree would let
# the PR commit a symlink (say `.next-major` -> /proc/self/environ) that a later
# read follows, leaking the job's environment. Here each file is written from
# its blob, and only if the tree records it as a regular file. A symlink, a
# submodule or a path under one is refused.
#
# Usage: materialise-pr-files.sh <repo-dir> <trusted-bumpver.toml>
#   <repo-dir> is a git repository whose HEAD is the PR head and whose working
#   tree is empty. Writes .next-major (if the PR has one), bumpver.toml and
#   every file staging's bumpver.toml lists. Prints `unsafe=<path>` and exits 0
#   if a path is not a regular file; any other problem exits non-zero.
set -euo pipefail

repo=$1
cfg=$2

paths=$(python3 -c 'import tomllib,sys; c=tomllib.load(open(sys.argv[1],"rb"))["tool"]["bumpver"]; print("\n".join([".next-major", "bumpver.toml", *c.get("file_patterns", {})]))' "$cfg")

while IFS= read -r path; do
  case "$path" in /* | *..* | .git | .git/*) echo "::error::Refusing path ${path}" >&2; exit 1 ;; esac
  # Mode and type of exactly this path in HEAD's tree. Nothing printed means
  # absent, including a path under a symlinked directory, which git does not
  # follow.
  entry=$(git -C "$repo" ls-tree HEAD -- "$path")
  if [ -z "$entry" ]; then
    continue
  fi
  read -r mode type _ <<<"$entry"
  if [ "$type" != blob ] || { [ "$mode" != 100644 ] && [ "$mode" != 100755 ]; }; then
    echo "unsafe=${path}"
    exit 0
  fi
  mkdir -p "${repo}/$(dirname "$path")"
  # Never write through something already there.
  rm -f "${repo:?}/${path}"
  git -C "$repo" cat-file blob "HEAD:${path}" > "${repo}/${path}"
done <<<"$paths"
