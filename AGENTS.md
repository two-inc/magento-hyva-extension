# Magento Hyva Extension

## Git Workflow

- Use `SKIP=commit-msg` when committing on `main` branch (no Linear ticket needed)
- Do NOT skip commit-msg hook on feature branches
- Never use `--no-verify` flag

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
