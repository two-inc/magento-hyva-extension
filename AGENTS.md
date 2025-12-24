# Magento Hyva Extension (ABN Gateway)

## Git Workflow

- Use `SKIP=commit-msg` when committing on `abn-main` branch (no Linear ticket needed)
- Do NOT skip commit-msg hook on feature branches
- Never use `--no-verify` flag

## Branch Structure

- `main` - Two.inc version (Two_GatewayHyva namespace)
- `abn-main` - ABN AMRO version (ABN_GatewayHyva namespace) - **THIS BRANCH**

The `abn-main` branch should always be `main` + a single "ABN layer" commit on top.

## Rebasing abn-main onto main

When main has new changes that need to be incorporated into abn-main:

```bash
# 1. Ensure main is up to date
git checkout main
git pull origin main

# 2. Reset abn-main to main
git checkout abn-main
git fetch origin abn-main
git reset --hard origin/main

# 3. Cherry-pick the ABN layer commit (get hash from previous abn-main)
git cherry-pick <abn-layer-commit-hash> --no-commit

# 4. Resolve conflicts if any, keeping ABN namespace changes:
#   - Namespace: Two -> ABN
#   - Payment method: two_payment -> abn_payment
#   - Template paths: Two_GatewayHyva:: -> ABN_GatewayHyva::

# 5. Remove bumpver.toml (versioning managed on main only)
rm -f bumpver.toml

# 6. Stage and commit as single ABN layer commit
git add -A
SKIP=commit-msg git commit -m "chore: ABN layer"

# 7. Verify no Two references remain (CRITICAL!)
rg -i "twoGatewayHyva|two_payment|Two_GatewayHyva|Two\\\\Gateway" --glob '!AGENTS.md'

# 8. Force push
git push origin abn-main --force
```

### Verifying ABN Namespace Changes

After rebasing, always check for leftover Two references that should be ABN:

```bash
# Check for any remaining Two references (should return empty except AGENTS.md)
rg -i "twoGatewayHyva|two_payment|Two_GatewayHyva" --glob '!AGENTS.md'

# Specifically check CSP JS files for Alpine component names
rg "twoGatewayHyva" view/frontend/templates/

# Check PHP namespace references
rg "Two\\\\GatewayHyva" --glob '*.php' --glob '*.phtml'
```

If any matches are found, they need to be renamed to the ABN equivalent:

- `twoGatewayHyva*` → `abnGatewayHyva*`
- `two_payment` → `abn_payment`
- `Two_GatewayHyva` → `ABN_GatewayHyva`
- `Two\GatewayHyva` → `ABN\GatewayHyva`

## Version Management

- Version bumps are done on `main` only using `bumpver`
- The `abn-main` branch inherits the version from main via rebase
- `bumpver.toml` is removed from abn-main to avoid confusion

## ABN-specific Differences

- Namespace: `ABN\GatewayHyva` instead of `Two\GatewayHyva`
- Payment method code: `abn_payment` instead of `two_payment`
- Config section: `abn_*` instead of `two_*`
- ABN logo in `view/frontend/web/images/cc/logo.svg`

## Publishing ABN Plugin

The ABN Hyva extension is published to a GCS bucket for distribution:

```bash
# 1. Tag the release (creates abn-<version> tag)
make tag

# 2. Create archive and publish to GCS
make publish
```

The published plugin is available at: https://plugins.achterafbetalen.co/magento-hyva/index.html

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

### Common Issues

1. **Magewire component not updating**: Check if component class has correct namespace and implements proper interface
2. **Styles not applying**: Rebuild Tailwind CSS
3. **Alpine.js not working**: Check browser console for JS errors, ensure `x-data` is on parent element
4. **Payment method not showing**: Verify `abn_payment` is enabled in admin config
5. **Alpine CSP error "unable to interpret expression"**: This usually means CSP JS files have `twoGatewayHyva*` function names but templates use `abnGatewayHyva*`. Run the verification commands above and rename any leftover Two references.
