#!/usr/bin/env python3
"""Rewrite the version strings bumpver.toml lists, without running bumpver.

ISEC-853. "Version bump" used to call `bumpver update` inside the PR checkout,
so bumpver chose its config by searching the PR's own tree: a PR could add a
pycalver.toml / .bumpver.toml / pyproject.toml section with commit hooks and
have them run in the job that reads the org App key. This script replaces it.
It reads the patterns from TRUSTED config (the `staging` copy of bumpver.toml),
treats every file it touches as text, and executes nothing.

Usage:
  set-version.py <trusted-bumpver.toml> <data-dir> <old-version> <new-version>

<data-dir> holds the PR head's copy of bumpver.toml and of every file listed in
[tool.bumpver.file_patterns], at the same relative paths. Each pattern is
bumpver's literal form: `{version}` is the version, and `\\[` / `\\]` are
escaped brackets. The OLD version must appear through every pattern at least
once; anything else is a hard error, never a silent skip. Prints the commit
message (from `commit_message`) on stdout.
"""
import re
import sys
import tomllib
from pathlib import Path

VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?$")


def die(msg: str) -> None:
    print(f"::error::{msg}", file=sys.stderr)
    sys.exit(1)


def literal(pattern: str, version: str) -> str:
    return pattern.replace("\\[", "[").replace("\\]", "]").replace("{version}", version)


def read(path: Path) -> str:
    # newline="" keeps CRLF and LF exactly as they are in the file.
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def safe_path(root: Path, rel: str) -> Path:
    # Paths come from trusted config, but never let one escape the data dir.
    if rel.startswith("/") or ".." in Path(rel).parts:
        die(f"refusing path {rel!r} in bumpver.toml")
    return root / rel


def main() -> None:
    if len(sys.argv) != 5:
        die(__doc__.strip().splitlines()[0])
    trusted_cfg, data_dir, old, new = sys.argv[1:]
    for v in (old, new):
        if not VERSION_RE.match(v):
            die(f"not a version: {v!r}")
    root = Path(data_dir)
    cfg = tomllib.loads(Path(trusted_cfg).read_text())["tool"]["bumpver"]

    targets: dict[str, list[str]] = dict(cfg.get("file_patterns", {}))
    for rel, patterns in targets.items():
        if isinstance(patterns, str):
            patterns = [patterns]
        path = safe_path(root, rel)
        text = read(path)
        for pattern in patterns:
            if "{version}" not in pattern:
                die(f"{rel}: pattern {pattern!r} has no {{version}}")
            before = literal(pattern, old)
            if before not in text:
                die(f"{rel}: {before!r} not found; current_version and the file disagree")
            text = text.replace(before, literal(pattern, new))
        write(path, text)

    cfg_path = root / "bumpver.toml"
    text = read(cfg_path)
    line = re.compile(r'^(current_version\s*=\s*)"' + re.escape(old) + r'"\s*$', re.M)
    text, n = line.subn(lambda m: f'{m.group(1)}"{new}"', text)
    if n != 1:
        die(f'bumpver.toml: expected exactly one current_version = "{old}", found {n}')
    write(cfg_path, text)

    message = cfg.get("commit_message", "chore: Bump version {old_version} -> {new_version}")
    print(message.replace("{old_version}", old).replace("{new_version}", new))


if __name__ == "__main__":
    main()
