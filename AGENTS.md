# Magento Hyva Extension

## Project Overview

Hyvä theme extension for Two's Magento plugin, providing modern frontend components using Alpine.js and Tailwind CSS.

- **Language**: PHP 7.4+ and JavaScript (Alpine.js)
- **Framework**: Magento 2 module for Hyvä theme
- **Purpose**: Frontend components for Two BNPL checkout in Hyvä theme

## Directory Structure

```
etc/                  # Module configuration
view/frontend/        # Hyvä frontend templates and layouts
├── templates/        # .phtml template files
├── layout/           # XML layout files
└── web/              # CSS/JS assets
ViewModel/            # View models for templates
Magewire/             # Magewire components (if applicable)
```

## Git Workflow

- Use `SKIP=commit-msg` when committing on `main` branch (no Linear ticket needed)
- Do NOT skip commit-msg hook on feature branches
- Never use `--no-verify` flag

## Version Management

Version bumps are automatic — CI does them. `.github/workflows/release.yml`
fires after the `CI` workflow completes green on `staging` or `main`, and the
level is decided by the branch, not by the commits:

| Merge lands on | Bump | Also produces |
|---|---|---|
| `staging` | **patch** | nothing else — bump commit only |
| `main` | **minor** | tag `X.Y.Z` + GitHub Release |

A **major** is an explicit escape hatch and overrides the branch rule. Two
independent signals, the higher wins:

- **Declared** — a root `.next-major` file whose first whitespace-delimited
  token is the target major, plus a short reason on the same line
  (`3  # overlay migration, 3.0.0 release`). Reviewable in the PR that decides
  it, so a *planned* major with no single breaking commit still lands as a
  major. CI never clears the file; it disarms itself once the current major
  reaches the declared one, and a declaration that has fallen *below* the
  current major is a hard CI failure.
- **Discovered** — a `!` on a conventional-commit type (`feat!:`,
  `TWO-1/fix(scope)!:`) or a `BREAKING CHANGE:` footer.

The new version for a major is exactly `<target>.0.0`, so a declaration may
skip more than one major.
`.github/scripts/decide-bump-level.sh` owns the decision and is shared
byte-identically across the Magento plugin repos; it logs the full decision —
inputs included — to the workflow log on every run.

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

`Provenance` is deliberately a near-copy of `Two\Gateway\Model\Provenance` in
the base plugin rather than an injection of it — that class ships in no
published `two-inc/magento2` release, so depending on it would break DI on
every base version a merchant can install. Once a base release carries it and
this repo's constraint has a floor at that release, delete the local copy and
inject the base one; the public surface is identical for exactly that reason.

## Development Tips

### Running Commands

Most Magento CLI commands should be run as the web server user to avoid permission issues:

```bash
su www-data -s /bin/bash -c "bin/magento <command>"
```

## Hyva-specific Quirks

### Tailwind CSS Rebuild

After changing templates, Tailwind CSS must be rebuilt to include new utility classes.

**Important**: New Tailwind classes in templates won't appear until CSS is rebuilt.

### Magewire Components

- Located in `Magewire/` directory
- Use `wire:model` for two-way binding, `wire:click` for actions
- Component state persists across requests via session
- Debug Magewire issues by checking browser Network tab for `livewire/message` requests

### Alpine.js Integration

- Hyva uses Alpine.js for frontend interactivity
- Use `x-data`, `x-show`, `x-on:click` etc. in templates
- Alpine components can communicate via `$dispatch` and `@event-name.window`

### Staging Cache Refresh (git-sync workflow)

**IMPORTANT**: Always run Magento CLI commands as www-data user to avoid permission issues:

```bash
kubectl exec deploy/magento -n staging -- su www-data -s /bin/bash -c "php bin/magento <command>"
```

When developing with git-sync on staging, after pushing changes:

1. Wait for git-sync to pull the latest commit:

```bash
kubectl exec deploy/magento -n staging -c git-sync-hyva -- sh -c "cd /git/code && git log -1 --oneline"
```

2. Clear cache and restart Apache:

```bash
kubectl exec deploy/magento -n staging -- bash -c "rm -rf pub/static/frontend/Hyva/*/en_GB/Two_GatewayHyva && php bin/magento cache:flush && apachectl graceful"
```

Or combined (wait 15s for sync then clear):

```bash
sleep 15 && kubectl exec deploy/magento -n staging -c git-sync-hyva -- sh -c "cd /git/code && git log -1 --oneline" && kubectl exec deploy/magento -n staging -- bash -c "rm -rf pub/static/frontend/Hyva/*/en_GB/Two_GatewayHyva && php bin/magento cache:flush && apachectl graceful"
```

### Common Issues

1. **Magewire component not updating**: Check if component class has correct namespace and implements proper interface
2. **Styles not applying**: Rebuild Tailwind CSS
3. **Alpine.js not working**: Check browser console for JS errors, ensure `x-data` is on parent element
4. **Payment method not showing**: Verify `two_payment` is enabled in admin config
