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

Version bumps are automatic — CI does them, on the pull request rather than
after the merge. `.github/workflows/release.yml` now fires on `main` only and
computes nothing: it reads the version out of `bumpver.toml`, tags it and cuts
the Release.

| Change | What happens |
|---|---|
| PR into `staging` | the version is computed from that PR's own commits and committed onto the PR's branch (`.github/workflows/version-bump.yml`) |
| merge into `staging` | nothing — the merge brings in the version its PR computed |
| `staging` into `main` | nothing is computed; `main` tags the version already in the tree and cuts the GitHub Release |

With `M` the version on `origin/main` and `C` the version on the PR head, the PR's own commits (`origin/staging..HEAD`, `--no-merges`) decide the candidate: a `!` type or a `BREAKING CHANGE:` footer gives `(M.major + 1).0.0`, a `feat:` gives `M.major.(M.minor + 1).0`, and anything else — `fix` and `chore`/`docs`/`ci`/`test`/`refactor` alike — gives `M.major.M.minor.(M.patch + 1)`. The result is clamped with `max(C, candidate)`, which makes it idempotent (a re-run, the `synchronize` the bump commit itself fires, or a second fix commit on the same PR all write nothing) and means the version can never regress while `main` is behind `staging`.

A **major** is an explicit escape hatch and overrides the rule above. Two
independent signals, the higher wins:

- **Declared** — a root `.next-major` file whose first whitespace-delimited
  token is the target major, plus a short reason on the same line
  (`3  # overlay migration, 3.0.0 release`). Reviewable in the PR that decides
  it, so a *planned* major with no single breaking commit still lands as a
  major. CI never clears the file; it disarms itself once the current major
  reaches the declared one, and a declaration that has fallen *below the major
  on `main`* is a hard CI failure.
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

And the rebuild is the **merchant's**, not ours — so a utility only this module asks
for may never be generated on a real store. That failure is silent: a
`bg-red-50 border border-red-200` box renders as an unstyled, colourless box that
still claims whatever it says. So **colour, border and the geometry of any element
this module owns go in `view/frontend/web/css/custom.css`**, not in a class list.
Precedents in that file: `input.company_id:disabled`,
`.two-company-search__unavailable`, `.two-company-search__spinner`, and the
four-state `.two-order-intent-box` (the order-intent verdict box — one box, one
place in the tile, states differing only in colour, geometry declared once on the
shared class so the states cannot drift apart). Layout utilities that the theme
certainly generates (`flex`, `w-full`, `min-w-0`, `space-y-4`) are fine to keep in
the template.

### Order intent: one box, and a verdict that can be repainted

The tile shows **at most one VERDICT** — available, not available, could not be
determined — plus an in-progress row that is a separate fact and may legitimately
be up alongside nothing. All four are one box style in one place. The rules that bite:

- **ONE PAINTER.** `refreshOrderIntentVerdict()` is the only thing that writes a
  verdict notice. The reply handlers RECORD and then call it; they do not paint.
  `clearOrderIntentNotices()` takes all three states down and deliberately does
  NOT touch the in-progress row. Assignment lists that name only the siblings a
  caller happens to remember are how a state gets forgotten when a fourth one is
  added — that is how this feature spent six review rounds.
- **A CHECK IN PROGRESS OUTRANKS EVERY RECORDED VERDICT.** `refresh` paints
  nothing while `orderIntentChecking` is true, and nothing under an open results
  panel. "Checking availability" and a conclusion may never be on screen together.
  The corollary is the part that bites: because a verdict can be *suppressed*,
  something must repaint it when the check stops — so `setOrderIntentChecking()`
  is the ONLY way the row goes down, and it re-derives the box. Lowering the flag
  by hand reintroduces a blank box that nothing can refill. Rounds 4-7 each found
  one more route to a verdict beside a progress row, because each fix guarded a
  route instead of stating the rule.
- **Records are PER COMPANY, keyed by id.** `orderIntentDecisions[id] =
  { name, approved }` and `orderIntentFailures[id] = { name }`. A single slot
  cannot represent approve A, check B, come back to A — B overwrites it and A's
  verdict is gone. The name is stored beside the decision, not used as the key: the
  notice text embeds it, so a company renamed by hand must fail closed rather than
  be shown a verdict reached under the old name. The recorded name must always
  describe the recorded id — derive it from live state only when the reply is
  provably about the company on screen, otherwise record it as unknown, never
  guessed, because for a late reply the screen is showing somebody else.
- **The dedup gate reads those same records** (`hasOrderIntentDecisionFor()`), in
  both places that gate a dispatch. It used to consult a separate single-slot "last
  company dispatched for", which meant "already decided" and "has a verdict to
  show" could disagree — and did, so a company whose answer was known got asked
  about again.
- **A FAILED check is recorded, but never in the decisions map.** It needs a record
  for the same reason a decline does: a search started and abandoned takes the box
  down, and the failure is still a failure. But the dedup gate reads decisions, so
  filing a failure there would suppress the retry the failure exists to invite. A
  decision for a company clears its failure; so does a fresh check reaching the
  wire.
- **Both maps are emptied by a Magewire re-render**, because `initialize()` rebuilds
  the component. Acceptable — a decision is only as good as the quote it was made
  against — but it means the come-back-and-see-your-verdict property holds only
  until the next totals/address/term change.
- **ONE VERDICT, ONE NOTICE — never a toast while the box exists** (2026-08-06).
  A decline used to raise both; the toast self-dismisses and lands at the top of
  the page rather than beside the company it is about, so it could only repeat
  what the box already says permanently. Two exceptions, each for its own
  reason: a FAILED check keeps its toast because that one carries the API's own
  diagnostic strings and the box deliberately shows the general wording instead;
  and a decline with NO INLINE SENTENCE TO SHOW falls back to the toast, because
  the alternative is telling a declined buyer nothing whatsoever. That second
  exception is gated on `resolveOrderIntentNotAvailableNotice() === ''` — "is
  there a sentence", not "is the copy null". The two agree for the brand switch
  (whose null copy means the box's element is never rendered at all, and a brand
  shipping today is in that state), but the resolver also answers `''` for copy
  that is present and malformed, which it degrades to a silent box for rather
  than throwing — and that case needs the fallback just as much. Gate a fallback
  on there being nothing to say, never on any narrower proxy for it.
- **The company pair is resolved by `data-name`, on BOTH markup modes.**
  `company-name-payment.phtml` finds the payment step's company pair with
  `[data-name="company_name"]` / `[data-name="company_id"]`, and every path that
  WRITES the pair bails out silently when either input is missing — the
  address-step pick sync, the on-load initialisation, and `updatePaymentFields()`
  itself, which is also where those paths' `dispatch-order-intent` lives. Its
  one dispatch that does NOT depend on the pair is the `checkout:payment:method-
  activate` re-arm, which fires from the stored selection alone. So the symptom
  of a missing `data-name` is not "no intents ever": it is no intent on a PICK,
  with the activation re-arm still firing — which is worse to diagnose than
  total silence, because the feature looks alive. Address-area mode's two inputs
  are `type="hidden"` and carry the attribute for exactly this reason.

### Magewire Components

- Located in `Magewire/` directory
- Use `wire:model` for two-way binding, `wire:click` for actions
- Component state persists across requests via session
- Debug Magewire issues by checking browser Network tab for `livewire/message` requests

### Alpine.js Integration

- Hyva uses Alpine.js for frontend interactivity
- Use `x-data`, `x-show`, `x-on:click` etc. in templates
- Alpine components can communicate via `$dispatch` and `@event-name.window`

### Company search: ONE control, three mount points

There is **exactly one** company-search control implementation and it is reused
wherever it is mounted. Never add a second one, and never patch a surface by
copying part of it — that duplication is what produced a batch of "three
independent cosmetic bugs" on the payment tile that turned out to be one bug.

Three layers, innermost first:

| Layer | Where | Owns |
|---|---|---|
| Engine — `twoGatewayCompanySearchEngine()` | `component/payment/method/gateway_method-csp-js.phtml` | the request, the captured-company state, `selectItem()`, mode toggling, the company-id lock formula |
| Control — `twoGatewayCompanySearchControl()` | same file, layered over the engine | everything the buyer sees and touches: the query/name split, the dropdown panel, keyboard and focus management, the manual-entry route, the min-chars / no-matches / unavailable verdicts |
| Markup — `form/field/company-search-control.phtml` | included by each mount point | the control's DOM. The behaviour layer's selectors are this file's classes; the two are one unit |

Mount points, each a thin **adapter** supplying only what is genuinely
per-surface (which storage record, which quote, whether address lookup is
offered, what happens on capture):

- the address step — `form/field/companyName.phtml` + `companyName-csp-js.phtml`
- the payment tile — `component/payment/method/gateway_method.phtml` + its
  `-csp-js` component. It mounts the control with **no `x-data` of its own**, so
  the control's state lives on the payment form's component alongside the tile
  label and the order-intent dispatch.
- the address-book modal — `component/payment/method/shipping_company.phtml`,
  which composes the ENGINE directly under the Alpine name `searchInput`
  (Hyvä Checkout's own closed-source modal requires that literal name and
  renders the visible input itself, so there is no markup here to mount the
  control's into).

Which of the first two renders is decided by the core module's
`enable_company_search` setting — never both, never neither. See
`CheckoutConfig::getIsCompanySearchInPaymentTile()`.

Two things that bite:

- **The markup is included with `include $block->getTemplateFile(…)`**, not as a
  layout child. The address-step mount point is a Hyvä entity-form field
  *renderer* block created at runtime, so there is no layout node to hang a child
  off. `Test/Js/hyva-harness.js` inlines that include (`TEMPLATE_INCLUDE_PATTERN`)
  so the Jest suites render what the page renders.
- **Address AUTOFILL needs BOTH settings**, and the conjunction lives in ONE
  place: `CheckoutConfig::getIsAddressSearchEnabled()` returns
  `enable_address_search && !getIsCompanySearchInPaymentTile()`. Autofill writes
  city / postcode / street into an address FORM, so when the one control lives in
  the payment tile there is no form the buyer is working in for it to write into
  — filling one from a pick made on the payment step overwrites an address they
  already completed, silently, several steps behind where they are looking. Never
  re-derive the rule in a template or a component: the engine's `selectItem()`
  reads `isAddressSearchEnabled` and nothing else, and a surface that computes
  its own version is how the tile came to autofill.
- **The buyer's country is resolved LIVE, and the store default is a last
  resort only where there is no country selector at all**
  (`twoGatewayGetCountryCode()`). The DOM comes first — `#shipping-country_id`,
  `#billing-country_id`, then any `country_id`-named field, in that priority
  whatever the document order — then the quote's own address countries, then the
  store default. That last term is deliberately suppressed while a country
  `<select>` exists: the quote snapshot is PHP-rendered at page load and carries
  no country on a first visit, so an unconditional store default meant company
  search silently returned US companies to a buyer who had chosen elsewhere.
  Searching the wrong country is worse than not searching — with no country, the
  callers already say "Please select a country first".
  The hidden/disabled filter (`twoGatewayCountryFieldUsable()`) applies to the
  NAME matches only. The two ids were read unconditionally by every version of
  this helper before this rule existed, and this checkout hides a step's form
  subtree rather than unmounting it in at least some states, so filtering them
  would move already-correct behaviour towards the bug — on a surface no test
  here can see. Filter what you ADD; leave what already worked alone.
- **Never show an organisation number without `twoGatewayDisplayCompanyNumber()`.**
  A company with no number in its home registry gets an internal placeholder
  identifier prefixed `TWO:`. It must reach the API and must never reach the
  screen; the helper answers `''` for one, which is the same case as "no number",
  so surrounding parentheses drop with it.

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
4. **Payment method not showing**: Verify the brand's Two payment method is enabled in admin config. The method code comes from `BrandedHyvaViewModelInterface::getMethodCode()` — never hardcode it in templates or tests.
