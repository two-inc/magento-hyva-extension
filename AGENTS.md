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

## Branch Model

This repo is the Hyvä UI layer for the Two BNPL Magento plugin. Two branches in parallel:

- `main` — Two-branded (`Two_GatewayHyva`, namespace `Two\GatewayHyva\`, depends on `two-inc/magento2`)
- `abn-main` — ABN-branded (`ABN_GatewayHyva`, namespace `ABN\GatewayHyva\`, depends on `two-inc/magento-abn-plugin`)

`abn-main` tracks `main` plus a small set of brand-flavor overrides — namespace, payment method code, logo, and a `Makefile.brand` overlay. Historically described as "main + 1 ABN-layer commit"; in practice (since `abn-main` has GitHub branch protection blocking force-push) it is "main + N commits" where each ABN-flavor change adds another commit on top.

When porting features from `magento-abn-plugin`, build on `main` first. The next `abn-main` rebase carries the change forward. ABN-specific assets (logo, `achterafbetalen` URL defaults, ABN store country, GCS publish target) belong only on `abn-main` — see *Brand overlay* below.

## Brand overlay

`main/Makefile` has `-include Makefile.brand` at the top. The file is gitignored on `main` and absent there; on `abn-main` it is tracked and contains brand-flavor overrides:

- API / checkout URL defaults
- Default store country (`NO` on main, `NL` on ABN)
- `TWO_BRAND` / `TWO_BRAND_VERSION` defaults
- `LOG_DIR` override (`var/log/two` on main, `var/log/abn` on ABN)
- ABN-only targets: `publish` (GCS bucket), `tag` (with `abn` git remote)

`Makefile.brand` MUST appear before any `?=` defaults it intends to override (the `-include` lives at the top of the Makefile for this reason). Brand-side overrides use `:=` so they win against main's `?=`.

If you see a `Makefile.brand` on `main` it is stale — delete it. The Makefile prints `Loaded Makefile.brand — brand overlay active` when an overlay is in scope.

## Version Management

Version bumps are done using `bumpver`:

```bash
SKIP=commit-msg bumpver update --patch  # or --minor, --major
git push origin main --tags
```

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
