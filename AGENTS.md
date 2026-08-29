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

- **Day-to-day PRs target `staging`** (the GitHub default and deploy
  branch); branch off `origin/staging` — `version-bump.yml` decides the
  release version on PRs landing there. Promote to `main` (prod) with a
  staging → main PR when releasing; `merge-back.yml` syncs `main → staging`
  after merges. Ignore the lingering legacy branches.
- Do NOT skip the commit-msg hook — nobody commits directly on `main`;
  changes reach it via the staging → main promotion
- Never use `--no-verify` flag

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

`Provenance` is deliberately a near-copy of the base module's equivalent
provenance model rather than an injection of it — that class ships in no
published `two-inc/magento2` release, so depending on it would break DI on
every base version a merchant can install. Once a base release carries it and
this repo's constraint has a floor at that release, delete the local copy and
inject the base one; the public surface is identical for exactly that reason.

## Hyvä config registration

The module registers itself for Hyvä's config merge via
`etc/events.xml` (`hyva_config_generate_before`). On any install where
this module arrives _after_ `app/etc/hyva-themes.json` was generated
(e.g. baked images, runtime installs), run
`bin/magento hyva:config:generate` before the theme's Tailwind build —
otherwise the module's Tailwind classes are purged and its frontend
renders broken (e.g. dropdowns behind form fields).

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
  The corollary is the part that bites: because a verdict can be _suppressed_,
  something must repaint it when the check stops — so `setOrderIntentChecking()`
  is the ONLY way the row goes down, and it re-derives the box. Lowering the flag
  by hand reintroduces a blank box that nothing can refill. Rounds 4-7 each found
  one more route to a verdict beside a progress row, because each fix guarded a
  route instead of stating the rule.
- **Records are PER COMPANY, keyed by id.**
  `orderIntentDecisions[id] = { name, approved }` and
  `orderIntentFailures[id] = { name }`. A single slot
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
  one dispatch that does NOT depend on the pair is the
  `checkout:payment:method-activate` re-arm, which fires from the stored
  selection alone. So the symptom
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

### Company search: ONE popover, and it is not in this repo

There is **exactly one** company-capture popover across Magento's checkouts, it
ships in the BASE plugin, and this module mounts it. Never add a second one, and
never patch a surface by copying part of it — that duplication is what produced
a batch of "three independent cosmetic bugs" on the payment tile that turned out
to be one bug, and later what left this checkout's mode chips outside the panel
while Luma's were inside it.

Three layers, innermost first:

| Layer                                        | Where                                                                                                                                                                                                                  | Owns                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popover — `CompanySearchPanel`               | **two-inc/magento2**, loaded by `hyva_checkout_index_index.xml` as `Two_Gateway::js/model/company-search-panel.js` and reached as `window.TwoCompanySearchPanel`                                                        | everything the buyer sees and touches: the panel DOM, open/close, the query field, result rendering, keyboard navigation, the mode chips and the route in and out of manual entry |
| Engine — `twoGatewayCompanySearchEngine()`   | `component/payment/method/gateway_method-csp-js.phtml`                                                                                                                                                                 | the request, the captured-company state, `selectItem()`, mode toggling, the company-id lock formula, address write-back, storage                                                  |
| Adapter — `twoGatewayCompanySearchControl()` | same file, layered over the engine                                                                                                                                                                                     | the six-member search API the popover asks for, which chips this checkout offers and what each one runs, where the panel mounts, and the popover's translated copy                |

**Registry and order-intent calls go through the base module's own REST routes**
(`rest/V1/two/company-search`, `.../company`, `.../order-intent`), never straight
at the API: the merchant API key authenticates them server-side, and a merchant
whose network traffic passes through a firewall appliance can have a token
attached there without it ever reaching a buyer's browser. Each answers a
`{ok, status, body}` envelope — `ok: false` means the upstream call failed and
must produce exactly what a failed direct call used to. Paging and client
identification are the server's to set, so nothing here sends them. The one
exception is `/autofill/v1/buyer/current`, which is authenticated by the buyer's
own cookie on the API's domain and so cannot be proxied at all; it carries the
firewall token as an `X-WAF-TOKEN` header instead, and only where a merchant
enabled that for the browser.

**The popover is framework-free with a UMD tail**, which is why this checkout can
load it with no RequireJS, no jQuery and no Knockout. It takes three injected
options — `search`, `translate` and `observe`. This checkout injects the first
two and deliberately withholds `observe`: `$.async` has no equivalent here, and
a MutationObserver per mount is what froze the checkout on this ticket, so the
re-render's own `element.updated` hook drives the re-bind instead. Do not reach
into the panel; if it needs to do something new, change it in the base plugin so
both checkouts get it.

**Its markup is not testable here.** The file is not in this repo and there is no
vendor tree in CI, so `Test/Js/hyva-harness.js` installs a RECORDING stub at
`window.TwoCompanySearchPanel` (`installHyvaEnvironment()` returns
`companyPanels`, with `.options` and `.calls`). What this repo tests is its own
half of the contract — the options the adapter passes and the search API it
builds over the engine. The panel's own behaviour is covered where that file
lives, not here. The stub does build the wrapper and panel node the real one
builds, and answers `isBound()` from them: that is the minimum DOM that makes a
re-render's morph observable here, and a constant `true` is the answer that
hides it.

**The popover's STYLING comes from the base plugin too** —
`<css src="Two_Gateway::css/style.css"/>`, loaded BEFORE `custom.css` so this
module keeps the last word. Do not copy popover rules into `custom.css`; a test
guards against it. That stylesheet also restyles `.two-term-chip` and its
siblings, which this checkout already paints: any class that genuinely needs to
mesh with Hyvä's styling gets a **selective override**, written after someone
has looked at the result rather than pre-emptively.

**Known base-plugin defect, not fixed here:** the panel clears its return link
across the whole document instead of its own wrapper, so with two panels on one
page — the delivery form and the invoice form — one leaving manual entry
deletes the other's only route out of it. Fix belongs in the base module,
scoped to the panel's own wrapper.

`form/field/company-search-control.phtml` is now only the company-name input and
the organisation-number display. **Do not put a dropdown, a query box, a hint
line or a chip row back into it** — the panel renders all of those, in an order
that is the design: input → query → results → chips, which is what makes tab
order correct with no key handling at all.

Mount points, each a thin **adapter** supplying only what is genuinely
per-surface (which storage record, which quote, whether address lookup is
offered, what happens on capture):

- the address step — `form/field/companyName.phtml` + `companyName-csp-js.phtml`
- the payment tile — `component/payment/method/gateway_method.phtml` + its
  `-csp-js` component. It mounts the control with **no `x-data` of its own**, so
  the control's state lives on the payment form's component alongside the tile
  label and the order-intent dispatch. It renders no chip row of its own; the
  chips are inside the popover.
- the address-book modal — `component/payment/method/shipping_company.phtml`,
  which composes the ENGINE directly under the Alpine name `searchInput`
  (Hyvä Checkout's own closed-source modal requires that literal name and
  renders the visible input itself, so there is no markup here to mount the
  control's into).

Which of the first two renders is decided by the core module's
`enable_company_search` setting — never both, never neither. See
`CheckoutConfig::getIsCompanySearchInPaymentTile()`.

Each mount builds its panel from its own `init()`/`initialize()`, and
`mountCompanyPopover()` re-points an existing panel rather than building a second
one. It stamps its own `data-two-company-panel` attribute on the field and
selects on that, because the address-step field renderer is registered globally
and mounts on the delivery form AND the invoice form, so a document-wide selector
would give both mounts the first field.

**A Magewire re-render does NOT re-run `init()`.** It MORPHS the server markup
over the live DOM: the popover's `span.two-company-field-wrap` is built at
runtime and is in no server markup, so the morph deletes it — panel, chips and
the mount attribute with it — while KEEPING the element carrying the component's
`x-data`, so Alpine keeps the component and never re-initialises it. Every mount
therefore registers itself in `window.twoGatewayCompanyMounts`, and one
page-level `element.updated` hook remounts any control whose panel reports
`isBound()` false. That is also the answer to "why does a shipping-method change
survive": its re-render never touches this form.

**The panel instance lives in a closure, never in Alpine state.** Alpine wraps
component data in reactive proxies and the panel compares DOM nodes by identity;
a proxied node makes those comparisons false and the popover silently stops
responding to its own field.

Things that bite:

- **The markup is included with `include $block->getTemplateFile(…)`**, not as a
  layout child. The address-step mount point is a Hyvä entity-form field
  _renderer_ block created at runtime, so there is no layout node to hang a child
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
  (`twoGatewayGetCountryCode()`). The DOM comes first — **that of the form doing
  the asking** — then the quote's own address countries, then the
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
- **ONE resolver, but it resolves RELATIVE TO THE CALLER** (TWO-25461).
  "Resolve the country one way and reuse it everywhere" means one resolution
  FUNCTION, never one hardcoded priority order. `twoGatewayGetCountryCode()`
  takes a context element and scopes the live DOM read to the address form that
  owns it (`twoGatewayCountryFieldScope()`): the nearest ancestor with a country
  field of its own, stopping at a `<form>` that has none. The company field
  renderer is registered globally on `entity-form.field-renderers`, so the SAME
  component mounts on the delivery form and the invoice form — a document-wide
  shipping-first lookup gave the invoice form the delivery country, and each
  form must read only its own live fields. Callers with no address form of
  their own keep the document-wide, shipping-first list, and the payment tile
  names the address it means BY ROLE rather than inheriting that:
  `twoGatewayInvoiceRoleCountryField()` is the billing form's field, or the
  shipping form's while `#billing-as-shipping` is ticked, because the tile's
  company is the invoice-role company. Only the LIVE read is scoped; the quote
  terms below it are a page-load snapshot and are deliberately left alone.
- **Never show an organisation number without `twoGatewayDisplayCompanyNumber()`.**
  A company with no number in its home registry gets an internal placeholder
  identifier prefixed `TWO:`. It must reach the API and must never reach the
  screen; the helper answers `''` for one, which is the same case as "no number",
  so surrounding parentheses drop with it.

### Two addresses: editable, mirrored, and pinned by CONTENT

The checkout can hold two addresses — shipping, and a separate billing one once
"billing same as shipping" is unticked — and the second one **stays fully
editable, always**. Making its company or country read-only was evaluated and
rejected: a company with a branch in a neighbouring country is one legal entity
with two genuinely different valid local pairings.

The shipping (default) address's company propagates onto the billing one, and
what stops that propagation is a **pure content match**, not a flag:

- Before a mirrored value is written, the tracked fields of the billing address
  are compared against what the mirror would write, **trimmed and
  case-insensitive**. Still matching → still synced, overwrite freely.
- **One** field differing pins the **whole address**, including the fields the
  buyer never touched. Explicit ruling — do not scope the pin per field.
- **There is no resume control, and none should be built.** The match is
  recomputed on every read, so it releases by itself. Ticking "billing same as
  shipping" drops the billing company record and mirrors the shipping company
  across in the same handler, which is what leaves the pin nothing to hold.
- The tracked set is **five** fields: country, company name, company id, address
  line 2, region. A buyer typing into address line 2 is exactly as strong a
  signal of independent editing as one retyping the company.
- **Per-surface state is keyed on the surface's own root node, never on the kind
  of host.** One renderer mounts the company field on both address forms, so one
  key per kind of host is one key shared between two live surfaces, and the
  second mount tears down the first's subscription.
- **The `data-two-capture-active` attribute IS the capture claim.** A surface
  holding it hosts the control; a surface without it hosts nothing, may SEED an
  identity nobody has captured into, and may never displace one — the pair, the
  mode and the tile's `#company_name`/`#company_id` submit fields alike.
  `claimCaptureField()` is the only thing that stamps it; `ownsCaptureField()`
  reports on it and takes nothing, so asking the question in the window a morph
  opens (server markup carries no claim) cannot itself grant ownership.
- **Ownership is re-read on every notification, never captured when a
  subscription is opened.** The claim transfers at runtime — an invoice-role form
  mounting after the delivery one displaces it — and an ex-owner holding a stale
  answer persisted the blob, announced the pick and raised an order intent
  alongside the real owner.
- **A surface's subscription is disposed by the re-render that removed it.** The
  `element.updated` hook reaps every watcher whose root has left the document,
  because a teardown that waits for the next mount never runs on a page with one
  control.

`twoGatewayIsBillingAddressPinned()` is the one answer to this question and
every surface asks it — the tile's `initialize()` and the bridge's
`checkout:payment:method-activate` resolution and its two shipping-mirror paths.
Two surfaces answering it differently is how the tile came to adopt a company
the buyer had said does not apply, twice.

Three things that bite:

- **The pin gates PROPAGATION, never a RESTORE.** It is checked at the call
  sites that push the shipping company across, and deliberately not inside
  `updatePaymentFields()` — which is also how a company resolved _for_ the
  billing role, including one read back out of the billing record, reaches the
  tile. A pin there blocks the buyer's own billing company from being restored,
  which is the exact opposite of protecting it.
- **A blank target field is not a mismatch.** It is a field waiting to be
  filled, and filling it is the propagation. Counting blank-vs-populated as a
  difference pins every freshly opened billing form on the spot and nothing ever
  propagates at all.
- **"Never replace a company with nothing" is a separate term, not part of the
  pin.** With company search mounted in the payment tile the shipping storage
  key is never written, so a nameless shipping record is that configuration's
  normal state; adopting it discards the only company the buyer ever named and
  leaves a locked, empty, required number field behind it.

Whichever address plays the **billing/invoice role** is the one that requires a
company and org number — never a shipping-only address, and the role is resolved
once rather than re-derived per surface.

### Writing an address from an external payload

`setAddressData()` routes one way for every payload it can receive — a
registered-company search result, an autofill — because special-casing the
source is how the two drift apart:

| payload                        | line 1                      | line 2             |
| ------------------------------ | --------------------------- | ------------------ |
| `building`/`apartment` present | the premises (both, joined) | `street`           |
| neither present                | `street`                    | **left untouched** |

No dedup between the lines even when the text is identical: some real addresses
legitimately repeat, and silently swallowing one is invisible to the buyer.
Line 2 is left alone rather than blanked when there is nothing for it, so an
autofill carrying no building cannot delete an apartment number the buyer typed.

`region` goes to a `region_id` select when an option's TEXT matches (lossy and
known to be), else to a free-text `region` field, else it is appended to `city`
after a comma — the comma being a separator, so an address with no city gets
none. An unmatched value is never written onto a `region_id` select: that stores
an id the store does not have.

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

### Tests that read a file as TEXT, and mutants that check them

Two rules, both learned the same way — six times on TWO-25503, every one a check
that ran cleanly and proved nothing:

- **Any assertion that reads a stylesheet or a template as text matches against
  a COMMENT-STRIPPED copy.** Prose explaining a declaration contains the same
  tokens as the declaration, so a regex written to find the code matches the
  explanation instead. Worse, comments here quote selectors — braces and all —
  so a `[^}]*\}` pattern terminates at a comment's brace and silently stops
  covering everything below it. `order-intent-spinner`,
  `company-search-focus-scope` and `company-search-spinner` all strip at the
  point the file is read, which is the place to do it: stripping per-assertion
  leaves the next one in the same file exposed.
  For a TEMPLATE the mitigation is different — its comments are the same
  language as its code, and stripping PHP/HTML/JS comment forms is a bigger job
  than `/* … */`. Anchor on syntax prose cannot reproduce instead: a call form
  (`__('Checking availability')`, not the bare sentence, which the tile's own
  comments do contain) or a whole statement. Those assertions are safe by anchor
  tightness, not by stripping, and a loosened anchor is all it takes.
- **A mutant is verified by WHAT IT REMOVED, never by the diff being
  non-empty.** A non-empty diff only proves something changed. It does not
  prove the anchor hit the rule you meant (`String.replace` takes the FIRST
  match, and identical declarations are common), nor that what it replaced was
  a statement rather than a comment beside one. Read the mutated region back,
  or anchor through enough surrounding text to be unique.

And the reason those two rules need writing down at all:

- **Agreement between a test and the thing it tests is worth nothing when one
  person wrote both.** TWO-25503's worst defect was a test double that diverged
  from the real component in exactly the direction that hid the leak the test
  existed to catch — with a comment confidently explaining why the divergence
  was correct. Both halves were mine and they agreed, so nothing about writing
  them more carefully would have surfaced it. When a test and its subject were
  authored together, the thing to hunt is the divergence that would make the
  test agree with a bug, and **the person to hunt it is not the author** — which
  is what the adversarial review round is for, not a formality before merge.

### Common Issues

1. **Magewire component not updating**: Check if component class has correct namespace and implements proper interface
2. **Styles not applying**: Rebuild Tailwind CSS
3. **Alpine.js not working**: Check browser console for JS errors, ensure `x-data` is on parent element
4. **Payment method not showing**: Verify the brand's Two payment method is enabled in admin config. The method code comes from `BrandedHyvaViewModelInterface::getMethodCode()` — never hardcode it in templates or tests.
