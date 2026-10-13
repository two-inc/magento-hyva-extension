---
description: "How CI computes versions, how majors are declared, and how the deployed commit is resolved"
---

# Release and versioning

## Version Management

Version bumps are automatic — CI computes them on the pull request into
`staging`. `.github/workflows/release.yml` fires on `main` only and
computes nothing: it reads the version out of `bumpver.toml`, tags it and cuts
the Release.

| Change                | What happens                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| PR into `staging`     | the version is computed from that PR's own commits and committed onto the PR's branch (`.github/workflows/version-bump.yml`) |
| merge into `staging`  | nothing — the merge brings in the version its PR computed                                                                    |
| `staging` into `main` | nothing is computed; `main` tags the version already in the tree and cuts the GitHub Release                                 |

With `M` the version on `origin/main` and `C` the version on the PR head, the PR's own commits (`origin/staging..HEAD`, `--no-merges`) decide the candidate: a `!` type or a `BREAKING CHANGE:` footer gives `(M.major + 1).0.0`, a `feat:` gives `M.major.(M.minor + 1).0`, and anything else — `fix` and `chore`/`docs`/`ci`/`test`/`refactor` alike — gives `M.major.M.minor.(M.patch + 1)`. The result is clamped with `max(C, candidate)`, which makes it idempotent (a re-run, the `synchronize` the bump commit itself fires, or a second fix commit on the same PR all write nothing) and means the version can never regress while `main` is behind `staging`.

A **major** is an explicit escape hatch and overrides the rule above. Two
independent signals, the higher wins:

- **Declared** — a root `.next-major` file whose first whitespace-delimited
  token is the target major, plus a short reason on the same line
  (`3  # overlay migration, 3.0.0 release`). Reviewable in the PR that decides
  it, so a _planned_ major with no single breaking commit still lands as a
  major. CI never clears the file; it disarms itself once the current major
  reaches the declared one, and a declaration that has fallen _below the major
  on `main`_ is a hard CI failure.
- **Discovered** — a `!` on a conventional-commit type (`feat!:`,
  `TWO-1/fix(scope)!:`) or a `BREAKING CHANGE:` footer, in **this PR's own
  commits** only — never the cumulative `main..staging` range.

The new version for a major is exactly `<target>.0.0`, so a declaration may
skip more than one major.
`.github/scripts/decide-bump-level.sh` owns the decision, is unit-tested by
`.github/scripts/test-decide-bump-level.sh`, and is shared byte-identically
across the plugin repos; it logs the full decision — inputs included — to the
workflow log on every run.

Do not bump or tag by hand. If you must, for a local experiment only:

```bash
SKIP=commit-msg bumpver update --patch --no-tag-commit --no-push  # or --minor, --major
```

### Deployed-commit provenance

The admin field at `Stores > Configuration > Two > Hyva Extension` renders
`<version> (<sha7>)` — the version from the `two_hyva/general/version` CCD
value plus the commit the deployed code was built from. The commit is resolved
by `Two\GatewayHyva\Model\Provenance`, which tries three signals in
freshness order:

1. the `.git` gitlink (gitSync dev shops — moves on every deploy),
2. `Composer\InstalledVersions::getReference()` (Packagist installs — the
   merchant distribution; the release workflow tags and Packagist resolves,
   there are no release assets),
3. the `.two-deployed-commit` build stamp that `make archive` writes into the
   zip (zip drops, which have neither of the above).

Any signal being absent or malformed falls through to the next, and none
resolving renders the bare version — the field never throws.

`make archive` writes the stamp via `git archive --add-file` from a temp dir,
so it never dirties the working tree. `.two-deployed-commit` is gitignored and
must never be committed: a committed stamp would be frozen at commit time and
would shadow the two fresher signals.

`Provenance` is a near-copy of the base module's equivalent provenance model
rather than an injection of it, with an identical public surface. **Keep the
copy.** No released base carries its own provenance model — the newest
release, `2.1.2`, predates it — so injecting the base module's instead would
fatal the admin field on every base a merchant can currently install. The `^2.3.0`
floor in `composer.json` is not evidence to the contrary: it states intent
only, for the reason set out under `getIsProxyAvailable()` in
[api-proxy.md](api-proxy.md). Delete the
copy once a base release is confirmed BY INSPECTION OF THAT RELEASE to carry
the class — never on the strength of its version number.
