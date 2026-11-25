#!/usr/bin/env bash
# Tests for materialise-pr-files.sh (ISEC-853). Run from the repo root.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/materialise-pr-files.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

cat > "$tmp/trusted.toml" <<'EOF'
[tool.bumpver]
current_version = "1.2.0"

[tool.bumpver.file_patterns]
"etc/config.xml" = ["<version>{version}</version>"]
EOF

# A PR head commit with the given .next-major, then a repo with no checkout
# whose HEAD is that commit, as "Version bump" builds it.
setup() { # name next-major-kind(file|symlink|none)
  local src="$tmp/$1-src" dst="$tmp/$1"
  git init -q "$src"
  mkdir -p "$src/etc"
  printf '[tool.bumpver]\ncurrent_version = "1.2.0"\n' > "$src/bumpver.toml"
  echo '<version>1.2.0</version>' > "$src/etc/config.xml"
  case $2 in
    file) echo 2 > "$src/.next-major" ;;
    symlink) ln -s /proc/self/environ "$src/.next-major" ;;
  esac
  git -C "$src" add -A
  git -C "$src" -c user.email=t@example.com -c user.name=t commit -qm head
  git init -q "$dst"
  git -C "$dst" fetch -q "$src" "+HEAD:refs/heads/pr-head"
  git -C "$dst" symbolic-ref HEAD refs/heads/pr-head
  echo "$dst"
}

expect() { # description condition...
  local what=$1; shift
  if "$@"; then echo "ok   $what"; else echo "FAIL $what"; fail=1; fi
}

repo=$(setup regular file)
out=$(bash "$script" "$repo" "$tmp/trusted.toml")
expect "regular files are written" test -z "$out" -a -f "$repo/.next-major" -a ! -L "$repo/.next-major"
expect "nested listed files are written" grep -q '1.2.0' "$repo/etc/config.xml"
expect "bumpver.toml is written" test -f "$repo/bumpver.toml"

repo=$(setup link symlink)
out=$(bash "$script" "$repo" "$tmp/trusted.toml")
expect "a symlinked .next-major is refused" test "$out" = "unsafe=.next-major"
expect "and nothing is written for it" test ! -e "$repo/.next-major" -a ! -L "$repo/.next-major"

repo=$(setup none none)
out=$(bash "$script" "$repo" "$tmp/trusted.toml")
expect "an absent .next-major is skipped" test -z "$out" -a ! -e "$repo/.next-major"

exit $fail
