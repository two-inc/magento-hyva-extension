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
  set-version.py --check <trusted-bumpver.toml> <data-dir> <version>

<data-dir> holds the PR head's copy of bumpver.toml and of every file listed in
[tool.bumpver.file_patterns], at the same relative paths. Each pattern is
bumpver's literal form: `{version}` is the version, and `\\[` / `\\]` are
escaped brackets. The OLD version must appear through every pattern at least
once; anything else is a hard error, never a silent skip. Prints the commit
message (from `commit_message`) on stdout.

--check rewrites nothing. Every pattern must match its file EXACTLY ONCE with
any version, ignoring layout and comments, and that one declaration must be
<version>; bumpver.toml must have
exactly one current_version line, also at <version>. So a PR that set only
current_version by hand cannot pass with the other files behind, and a copy of
<version> in a comment or a duplicate key cannot stand in for a stale
declaration: a second match of the pattern fails the check either way.
It guards against accidental drift; it is not a security boundary against an
author with write access writing a deliberately misleading file, whom the
required reviews cover.
"""
import re
import sys
import tomllib
from pathlib import Path

VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?$")


def current_version_line(version: str) -> re.Pattern:
    # The grammar "Version bump" accepts: optional indentation, the value in
    # double quotes, optional trailing whitespace and comment, LF or CRLF.
    # Group 1 and group 2 are kept as they are when the value is rewritten.
    return re.compile(
        r'^([ \t]*current_version[ \t]*=[ \t]*)"' + re.escape(version) + r'"([ \t]*(?:#[^\r\n]*)?\r?)$',
        re.M,
    )


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


def patterns_of(cfg: dict) -> dict[str, list[str]]:
    targets = {}
    for rel, patterns in cfg.get("file_patterns", {}).items():
        targets[rel] = [patterns] if isinstance(patterns, str) else list(patterns)
        for pattern in targets[rel]:
            if "{version}" not in pattern:
                die(f"{rel}: pattern {pattern!r} has no {{version}}")
    return targets


ANY_VERSION = r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.]+)?"


VERSION_CHAR = "[0-9A-Za-z.+-]"

# Comments, by file type. A declaration inside one does not count, so a
# commented-out copy can neither stand in for the real one nor hide its
# absence. PHP docblocks (/** */) are kept: WordPress reads the plugin header,
# `Version:` included, from one. A copy in a docblock still counts as a second
# match, which fails the check.
COMMENTS = {
    ".php": [r"/\*(?!\*).*?\*/", r"//[^\n]*", r"#(?!\[)[^\n]*"],
    ".xml": [r"<!--.*?-->"],
    ".md": [r"<!--.*?-->"],
    ".txt": [r"<!--.*?-->"],
}


def without_comments(rel: str, text: str) -> str:
    for rx in COMMENTS.get(Path(rel).suffix.lower(), []):
        text = re.sub(rx, " ", text, flags=re.S | re.M)
    return text


def is_word(c: str) -> bool:
    return c.isalnum() or c == "_"


def loose(lit: str) -> str:
    """The literal as a regex that ignores layout: whitespace may be added or
    dropped next to punctuation and operators, and a run of whitespace between
    two word characters may be any non-empty run."""
    out: list[str] = []
    i = 0
    while i < len(lit):
        if lit[i].isspace():
            j = i
            while j < len(lit) and lit[j].isspace():
                j += 1
            prev, nxt = lit[i - 1] if i else "", lit[j] if j < len(lit) else ""
            out.append(r"\s+" if is_word(prev) and is_word(nxt) else r"\s*")
            i = j
            continue
        if i and not lit[i - 1].isspace() and not (is_word(lit[i - 1]) and is_word(lit[i])):
            out.append(r"\s*")
        out.append(re.escape(lit[i]))
        i += 1
    return "".join(out)


def declarations(rel: str, pattern: str, text: str) -> list[str]:
    """Every version the pattern declares in text, whatever the version.

    Layout-insensitive (`$this->version='1.0';` is `this->version = '{version}';`),
    blind to comments, and the match takes the whole value token: where the
    pattern ends at {version} (`Stable tag: {version}`), `2.25.0.1` is not read
    as `2.25.0`, and `trunk` or `2.25.0_snapshot` is read as itself.
    """
    before, after = literal(pattern, "\0").split("\0", 1)
    head = loose(before) + r"\s*" if before else ""
    # Capture the whole value at the declaration, not only a version, so a
    # non-version value (`Stable tag: trunk`, `3.0.0_snapshot`, `3.0.0/x`) is
    # a match that fails rather than no match or a matching prefix. Where the
    # pattern ends at {version}, the value runs to whitespace or end of line;
    # otherwise up to the rest of the pattern (the closing quote, say). Where
    # the pattern goes on with a version character, it stops at a version.
    if not after:
        value = r"\S+"
    elif re.match(VERSION_CHAR, after):
        value = ANY_VERSION
    else:
        value = r"\S+?"
    tail = r"\s*" + loose(after) if after else ""
    return re.findall(head + "(" + value + ")" + tail, without_comments(rel, text))


def check(trusted_cfg: str, data_dir: str, version: str) -> None:
    if not VERSION_RE.match(version):
        die(f"not a version: {version!r}")
    root = Path(data_dir)
    cfg = tomllib.loads(Path(trusted_cfg).read_text())["tool"]["bumpver"]
    wrong = []
    for rel, patterns in patterns_of(cfg).items():
        text = read(safe_path(root, rel))
        for p in patterns:
            found = declarations(rel, p, text)
            if found != [version]:
                wrong.append(f"{rel}: {p!r} must match once, at {version}; found {found or 'none'}")
    any_cv = re.compile(r'^[ \t]*current_version[ \t]*=[ \t]*"(' + ANY_VERSION + r')"[ \t]*(?:#[^\r\n]*)?\r?$', re.M)
    found = any_cv.findall(read(root / "bumpver.toml"))
    if found != [version]:
        wrong.append(f"bumpver.toml: current_version must be set once, to {version}; found {found or 'none'}")
    for line in wrong:
        print(f"::error::{line}", file=sys.stderr)
    sys.exit(1 if wrong else 0)


def main() -> None:
    if len(sys.argv) == 5 and sys.argv[1] == "--check":
        check(*sys.argv[2:])
        return
    if len(sys.argv) != 5:
        die(__doc__.strip().splitlines()[0])
    trusted_cfg, data_dir, old, new = sys.argv[1:]
    for v in (old, new):
        if not VERSION_RE.match(v):
            die(f"not a version: {v!r}")
    root = Path(data_dir)
    cfg = tomllib.loads(Path(trusted_cfg).read_text())["tool"]["bumpver"]

    for rel, patterns in patterns_of(cfg).items():
        path = safe_path(root, rel)
        text = read(path)
        for pattern in patterns:
            before = literal(pattern, old)
            if before not in text:
                die(f"{rel}: {before!r} not found; current_version and the file disagree")
            text = text.replace(before, literal(pattern, new))
        write(path, text)

    cfg_path = root / "bumpver.toml"
    text = read(cfg_path)
    text, n = current_version_line(old).subn(lambda m: f'{m.group(1)}"{new}"{m.group(2)}', text)
    if n != 1:
        die(f'bumpver.toml: expected exactly one current_version = "{old}", found {n}')
    write(cfg_path, text)

    message = cfg.get("commit_message", "chore: Bump version {old_version} -> {new_version}")
    print(message.replace("{old_version}", old).replace("{new_version}", new))


if __name__ == "__main__":
    main()
