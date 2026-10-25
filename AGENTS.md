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
└── web/              # CSS and images — no JavaScript ships from this module
ViewModel/            # View models for templates
Magewire/             # Magewire components (if applicable)
```

## Task-specific docs

Detailed rules live under `docs/`, each linked below with a "Read ... before"
line. Every such line applies equally when reviewing a PR that touches that
area, not only when writing or changing it.

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

Version bumps are automatic and computed by CI; do not bump or tag by hand.
Read [docs/release-and-versioning.md](docs/release-and-versioning.md) before:
choosing a commit type that is not a plain patch (`feat`, a `!` type, a
`BREAKING CHANGE:` footer); adding or editing `.next-major`; changing
`version-bump.yml`, `release.yml`, `merge-back.yml`, `bumpver.toml`,
`.github/scripts/decide-bump-level.sh` or its test; changing `make archive` or
anything about `.two-deployed-commit`; touching `Model/Provenance`, the admin
version field or `two_hyva/general/version`; raising or relying on the base
module's version floor in `composer.json`; or replacing a local copy of a
base-module class (`Provenance`, `Service/ApiKeyVerificationStatus.php`) with
the base module's own.

## This is a public repository

- No partner or merchant name reaches file contents, a commit body, a branch name
  or a PR title or body. Gate before pushing: a force-push afterwards does not
  remove a commit from GitHub's history.
- In comments, commit messages and PR bodies alike, cite a Linear ticket id and
  nothing else: a section, question or ruling number belonging to an internal
  review document means nothing to a reader outside the company, and neither does
  a person named as the authority for a rule.
- The base plugin's DOCUMENTED contract may be pointed at. Its source text, schema
  fragments and test identifiers may not be reproduced here — describe behaviour in
  your own words.

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
Precedents in that file:
`.two-company-search__unavailable`, `.two-company-search__spinner`, and the
four-state `.two-order-intent-box` (the order-intent verdict box — one box, one
place in the tile, states differing only in colour, geometry declared once on the
shared class so the states cannot drift apart). Layout utilities that the theme
certainly generates (`flex`, `w-full`, `min-w-0`, `space-y-4`) are fine to keep in
the template.

### Checkout payment tile

Read [docs/checkout-tile.md](docs/checkout-tile.md) before changing anything in
the payment tile or placement:

- the tile subtitle, explainer tooltip (`component/tooltip.phtml`), brand logo
  (`MethodMetaDataPlugin`), anything read from the base module's
  `CheckoutTileCopy` through `CheckoutConfig`, or the intent approved/declined
  notices and their brand switches;
- `dev/base-tile-copy-parity.sh`, or any CI step that runs a script (invoke it
  through `bash`);
- the consent checkbox, or any id keyed on `getMethodCode()`;
- order intent in the tile: `refreshOrderIntentVerdict()`,
  `clearOrderIntentNotices()`, `setOrderIntentChecking()`, the decision, failure
  and sent-basket records, `hasOrderIntentDecisionFor()`,
  `GetQuoteDetails::getIntentBasketKey()` and the `_intent_basket` element,
  `recheckOrderIntentIfBasketMoved()`, toasts, `twoGatewayInvoiceCompany()`
  reads, `company-name-payment.phtml`, the company pair's `data-name`,
  `setPaymentData`, the
  `hyvaCheckout.validation` callback, `isOrderIntentPlacementRefused()` or
  `applyOrderIntentPlacementGate()` and the place-order button;
- `Plugin/Payment/RecordSelectedTermPlugin`, the charged term, the payment
  tile's Magewire component constructor (new dependencies go LAST, guarded by
  `GatewayMethodConstructorTest`);
- term chips: their text, `title`, `aria-label`, translated sentences, the sole
  offered term, the chip CSS (the base popover stylesheet restyles chips too, see
  company-search.md), or `selectTerm()` and repricing.

How the order intent is SENT (the REST route, `getIsServerIntentAvailable()`,
`twoGatewayProxyPost()`) is in
[docs/api-proxy.md](docs/api-proxy.md); read both for order-intent work.

### Magewire Components

- Located in `Magewire/` directory
- Use `wire:model` for two-way binding, `wire:click` for actions
- Component state persists across requests via session
- Debug Magewire issues by checking browser Network tab for `livewire/message` requests

### Alpine.js Integration

- Hyva uses Alpine.js for frontend interactivity
- Use `x-data`, `x-show`, `x-on:click` etc. in templates
- Alpine components can communicate via `$dispatch` and `@event-name.window`

### Company search and addresses

This module ships no JavaScript file and must not gain one
(`view/frontend/web/js` must not exist); the company-search popover, its focus
rules and its styling live in the base plugin. Read
[docs/company-search.md](docs/company-search.md) before:

- touching company search anywhere: the popover options, the engine
  (`twoGatewayCompanySearchEngine()`), the adapter
  (`twoGatewayCaptureSurfaceMixin()`), `gateway_method-csp-js.phtml`,
  `form/field/company-search-control.phtml`, `form/field/companyName.phtml`,
  `companyName-csp-js.phtml`, `gateway_method.phtml`, `shipping_company.phtml`,
  the layout `hyva_checkout_index_index.xml`, or including one template from
  another;
- per-role identities and controllers, `twoGatewayResolveInvoiceCompany()`,
  `twoGatewayInvoiceCompany()`, `twoGatewayApplyInvoiceCompanyFields()`, the
  `payment[company_name]` / `payment[company_id]` pair, or adding any editable
  company-number input;
- stored companies and their `company_country` stamp, live countries
  (`[data-two-live-countries]`, `getCaptureQuote()`), country resolution
  (`twoGatewayGetCountryCode()` and its helpers) or capture roles
  (`twoGatewayCaptureRoleForForm()`, `#billing-as-shipping`);
- the `enable_company_search` / `enable_address_search` settings,
  `getIsCompanySearchInPaymentTile()` or `getIsAddressSearchEnabled()`;
- Magewire re-renders of a mount (`mountCompanyPopover()`,
  `twoGatewayCompanyMounts`, `element.updated` hooks, caret restore, a
  MutationObserver or the popover's `observe` option, where a panel instance is
  stored),
  `announceCapturedCompanyToModel()` or `repaintCapturedNameFields()`;
- either address panel, role-scoped selectors, `watchCountryChanges`,
  sole-trader autofill, or making an address field read-only;
- any focus or `tabindex` handling on a chip or the company field, the signup
  popup, or checking in a browser whether a popup opened;
- displaying an organisation number (`twoGatewayDisplayCompanyNumber()`);
- popover CSS in `custom.css`, or `Test/Js/hyva-harness.js`'s popover stub.

Read [docs/api-proxy.md](docs/api-proxy.md) before changing how registry,
order-intent or autofill calls reach the API: the `rest/V1/two/...` routes,
`CheckoutConfig::getIsProxyAvailable()`, `getIsServerIntentAvailable()`,
`getCustomHeaders()`, `twoGatewayProxyPost()`, the deprecated browser
fallbacks, `/autofill/v1/buyer/current`, or the base module's version floor in
`composer.json`.

Read [docs/address-write-back.md](docs/address-write-back.md) before changing
`setAddressData()`, how a search result or autofill fills address lines, the
region select or `region` field, or the fixtures in
`address-payload-routing.test.js`.

### Product page "Buy with" button and its checkout preselect

The base module owns the button block, its on/off switch and every word on
it; `hyva_catalog_product_view.xml` swaps its template and moves it into
`product.info.additional`, and the `hyva_` prefix keeps Luma on the base
template and placement (TWO-26616). The move is needed because Hyvä's
`product.info.main` is the whole product page, so the base position landed the
button above the footer rather than under add to cart. The Hyvä template
submits the product's own form natively with a tokened `return_url`, so core's
add-to-cart controller decides where the buyer goes, exactly as on Luma.
`checkout/express-preselect.phtml` consumes the base module's `two_express`
checkout marker on sight and selects the brand's method by clicking its radio
in Hyvä Checkout's payment list, so Magewire saves it through its own binding.
It never overrides a method the buyer picked first.

### Staging Cache Refresh (git-sync workflow)

Read [docs/staging-dev-deployment.md](docs/staging-dev-deployment.md) before
verifying `staging` code on a live deployment, running Magento CLI there, or
merging to `staging` while someone is testing (the merge briefly takes the dev
storefront down).

### Tests

Read [docs/testing-pitfalls.md](docs/testing-pitfalls.md) before writing,
changing or reviewing any test or Jest fixture here: it covers tests that read a
file as text, mutants, keyboard behaviour, duplicate ids in jsdom fixtures and
why a test's author is not the one to review it. Tests touching the popover
stub, order intent or address fixtures also have rules in the docs above.

### Common Issues

1. **Magewire component not updating**: Check if component class has correct namespace and implements proper interface
2. **Styles not applying**: Rebuild Tailwind CSS
3. **Alpine.js not working**: Check browser console for JS errors, ensure `x-data` is on parent element
4. **Payment method not showing**: Verify the brand's Two payment method is enabled in admin config. The method code comes from `BrandedHyvaViewModelInterface::getMethodCode()` — never hardcode it in templates or tests.
