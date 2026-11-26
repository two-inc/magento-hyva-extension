---
description: "Which deployment tracks staging and how to refresh its cache after a git-sync"
---

# Staging dev deployment

### Staging Cache Refresh (git-sync workflow)

**`magento-dev` is the deployment that tracks this repo's `staging`**, through its
`git-sync-hyva` container; each brand's own dev deployment git-syncs this repo
too, alongside that brand's overlay. `deploy/magento` has no git-sync container at
all and serves the deployed image's code, which tracks `main`. So anything
verifying `staging` code goes to the dev deployment, and a check pointed at the
other one silently reports on `main`. Confirm which code a deployment has from its
git-sync container's checked-out HEAD, as below;
`pub/static/deployed_version.txt` answers with an HTML 404 page and settles
nothing.

A merge to `staging` triggers an in-place static redeploy on the dev deployment
and the storefront 500s for roughly three minutes, so a check that starts mid-sync
fails for environmental reasons. Warn testers before merging.

**IMPORTANT**: Always run Magento CLI commands as www-data user to avoid permission issues:

```bash
kubectl exec deploy/magento-dev -n staging -- su www-data -s /bin/bash -c "php bin/magento <command>"
```

When developing with git-sync on staging, after pushing changes:

1. Wait for git-sync to pull the latest commit:

```bash
kubectl exec deploy/magento-dev -n staging -c git-sync-hyva -- sh -c "cd /git/code && git log -1 --oneline"
```

2. Clear cache and restart Apache:

```bash
kubectl exec deploy/magento-dev -n staging -- bash -c "rm -rf pub/static/frontend/Hyva/*/en_GB/Two_GatewayHyva && php bin/magento cache:flush && apachectl graceful"
```

Or combined (wait 15s for sync then clear):

```bash
sleep 15 && kubectl exec deploy/magento-dev -n staging -c git-sync-hyva -- sh -c "cd /git/code && git log -1 --oneline" && kubectl exec deploy/magento-dev -n staging -- bash -c "rm -rf pub/static/frontend/Hyva/*/en_GB/Two_GatewayHyva && php bin/magento cache:flush && apachectl graceful"
```
