# Browser JS test suite

Jest + jsdom over the inline JavaScript in the module's Hyvä checkout templates.

```bash
make test-js            # from the module root; needs host Node 20+
npm run test:js         # equivalent, if node_modules is already installed
```

CI gates this as the `Jest (Node 20)` job in `.github/workflows/ci.yml`. It is a real
gate, not `continue-on-error`.

The layout mirrors `magento-plugin`'s `Test/Js/` and `prestashop-plugin`'s `tests/js/`: a
jest config sitting next to the tests with `rootDir` pointed back at the repo root, so a
test reads the shipped templates by their real repo-relative paths, and
`testEnvironment: 'jsdom'`. Jest devDependencies were added to the **existing** root
`package.json` (previously prettier-only) rather than to a second manifest.

Files glob — a new `*.test.js` needs no registration.

## The awkward part: the JS lives inside `.phtml`

This module ships no `.js` files for checkout. The code under test is an inline
`<script>` block inside a `.phtml` template, registered with Hyvä's CSP helper
(`$hyvaCsp->registerInlineScript()`) and rendered into a page where Alpine, Magewire and
Hyvä's `hyva` global already exist. Jest cannot import a `.phtml`.

Extracting the JS into real `.js` files would be the clean answer, and it remains the
right long-term move. It was deliberately **not** done when this suite was introduced
(TWO-25245, a test-only PR) and has not been done since. `hyva-harness.js` therefore does
the extraction at test time instead:

1. `<?php … ?>` blocks are dropped whole — they are the template's preamble and its
   trailing `registerInlineScript()` call, and they emit nothing into the page.
2. `<?= … ?>` short-echo tags are substituted from a table of test values keyed by the
   tag's whitespace-collapsed expression (`PHP_VALUE_RULES`), which is the harness
   standing in for PHP. A test can add its own rules for one call.
3. `<script>` bodies are extracted and concatenated. Attributes are discarded, which is
   also how a future `<script nonce="…">` stays invisible here.
4. The result is evaluated with an indirect `eval`, so it lands in global scope exactly as
   a `<script>` tag would: a top-level `function` becomes a global, and the file's free
   references to `hyva`, `Alpine` and `window` resolve to the harness stubs.

`renderTemplateMarkup()` is the same substitution with the `<script>` blocks removed
instead of kept, and `readAlpineBinding(template, selector, attribute)` reads one Alpine
attribute expression out of the result. Those exist because **component state bound to
nothing has no user-visible effect**, and asserting on the state alone cannot tell the two
apart — a defect this suite shipped once (see the TWO-25253 note below). `readAlpineBinding`
throws when the element is missing, when the attribute is absent, and when the expression is
not a bare identifier; the last one is a CSP check, since Hyvä ships the CSP Alpine build
which evaluates nothing else in an attribute (the reason `gateway_method-csp-js.phtml`
carries a `['!manualMode']` method rather than writing `!manualMode` inline). It has to be a
method rather than a `get` accessor, and that is load-bearing rather than stylistic:
`PaymentFormWithValidation()` builds itself by spreading `PaymentMethodBase()`, and object
spread reads an accessor and copies its VALUE — so an accessor freezes on the component the
template actually binds. TWO-25259 shipped that mistake and caught it in review.

**No production code has been changed to make this testable.** Later PRs do change these
templates — that is what they are for — but the harness reads whatever the template happens
to say, and nothing has been added to a template for the tests' benefit. `readAlpineBinding()`
is the sharpest case: it asserts against a binding the page needs anyway, and the reason it
exists is that the binding was MISSING and the tests could not tell.

Two of the substituted values are constrained by the templates and worth knowing about
before editing the table:

- the quote JSON appears both bare (`const quoteData = <?= $quoteDetailsJson ?>;`) and
  inside single quotes (`quote: '<?= $quoteDetailsJson ?>'`, `JSON.parse`d later), so its
  test value has to be a JSON object literal containing no single quotes;
- `$gwBase` is spliced into identifiers (`<?= $gwBase ?>OnInit() {`) as well as into
  strings, so it has to be a bare identifier fragment. It is `<brand prefix>GatewayHyva`;
  the vanilla prefix is `two`, hence `twoGatewayHyva` throughout the tests.

### Why this cannot rot into a suite that tests nothing

That is the real hazard of reading source out of a template, and every step above is a
hard error rather than a fallback:

- a `<?= … ?>` expression with no matching rule **throws**, naming the expression — it is
  never substituted with a blank;
- any `<?` surviving substitution **throws**;
- a template with no `<script>` block **throws**;
- `loadSharedHelpers()` asserts each of the six `window.twoGateway*` globals actually
  exists after evaluation;
- an Alpine binding a test asks for that is missing, or is not CSP-evaluable, **throws**.

`harness-contract.test.js` pins all of these against fixtures in `fixtures/`, and also
renders each of the four real templates and syntax-checks the output. So a template edit the
renderer cannot handle fails CI loudly instead of silently reducing the suite's coverage.

### What is stubbed, and what is not

Only the surroundings. `hyva` (browser storage, `formValidation`), `Alpine` (`data`,
`store`), `window.dispatchMessages` and `fetch` are stubs; every line of behaviour being
asserted is ours. Unlike `prestashop-plugin`, which loads the real jQuery UI because two
of its target defects were properties _of the widget_, there is no npm distribution to
load here — Hyvä checkout is a commercial package, the same reason CI stubs it for
`setup:di:compile`. The Alpine components are plain object literals with method shorthand,
so calling `component.getItems()` binds `this` the way Alpine's proxy does; `$el`,
`$root` and `$nextTick` are attached by `mountComponent()`.

`fetch` is settled by hand per call. Request timing _is_ the subject matter — timeouts,
supersession, aborts — so controlling it is the point rather than a shortcut. The abort
wiring is load-bearing: the production helper tells a timeout from a caller abort by
asking the **caller's** signal, and both arrive as an `AbortError`, so a stub that
resolved instead of rejecting would make either look fine.

## What is covered

`company-search-helpers.test.js` — the `window.twoGateway*` helpers published by
`gateway_method-csp-js.phtml` and shared by all three pickers:

- the discriminated result (`ok` / `empty` / `degraded` / `failed` / `aborted`). Collapsing
  these into `items = []` is the defect the helper exists to prevent: an empty dropdown is
  pixel-identical to "no companies matched", which is how a buyer with a valid company
  concludes the shop will not take them. A non-2xx, a network error and a malformed body
  are each pinned to their own outcome.
- the 30s ceiling, asserted to sit outside the API's own `stop_after_delay(10)` retry
  window, on both the search and the detail call; and the timer being cleared once a
  request settles, so a keystroke does not leave an abort armed 30s into the future.
- **timeout versus abort**: a timeout is `failed`, a caller abort is `aborted` and silent,
  and a signal already aborted on entry issues no request at all.
- `degraded === true` renders results _and_ flags them, and is never cached; absent,
  `false`, the string `'true'` and `1` all read as not degraded — the strict identity check
  matters because the field may not be deployed yet.
- the cache: keyed by URL so the country is part of the key, serves a repeat search without
  a request, preserves `empty` as `empty`, and evicts oldest-first at fifty entries.
- **a hit with no usable `national_identifier`** (the object absent, `null`, or carrying a
  null / empty `id` — all four shapes). The field is optional in the search response, and
  the field inside it is `id`, not `value`; reading it unguarded threw a `TypeError` on a
  legitimate hit. A throw there lands inside the dropdown's own query pipeline, so it took
  the WHOLE result list down and left the field on "Searching…". Such a hit is now rendered
  with the company name alone and an empty `companyId`, the other hits in the same response
  survive it, and a numeric `id` is coerced to a string. TWO-25253; the same defect was
  fixed in `magento-plugin` (#286) and `woocommerce-plugin` (#393).
- `twoGatewayGetCountryCode`'s six-step fallback order, each step pinned, ending at `''`
  rather than `undefined`.

`shipping-company-loader.test.js` — the `searchInput` picker, and above all its
`magewire:loader` bookkeeping. The loader is a full-screen overlay driven by a **boolean,
not a counter**, so two rules pull against each other: a superseded search must _not_
dispatch `done` (it would clear the overlay while its replacement is still running), and a
search aborted with _no successor_ **must** dispatch `done` (or the overlay latches on
forever and blocks checkout). A review round found the second rule broken — three
characters then a backspace left the overlay up permanently — so every dismissal path gets
its own test: backspacing below the minimum, tabbing out, picking a result, clearing the
country mid-flight, a DOM-morph disconnect, a timeout, and a missing global. Plus: a search
below the minimum never raises the overlay at all, a stale response cannot repopulate the
dropdown, a failure warns the buyer exactly once per interaction (and can warn again after
the interaction ends — the earlier once-per-_page-load_ latch left the buyer with an inert
field for the rest of the session), and a genuine zero-result search is _not_ flagged
unavailable.

The suite was mutation-checked against the four behaviours it claims to pin, by breaking
each one in the template and confirming a red run: relaxing `degraded === true` to
truthiness fails 2 tests, moving the 30s ceiling to 5s fails 3, treating every abort as a
caller abort (so a timeout goes silent) fails 8. Both loader rules likewise: inverting the guard to
`this.searchAbortController === controller` fails four tests, and weakening it to an
unconditional `done` fails the supersession test.

The TWO-25253 identifier guard was mutation-checked the same way, **twenty-three** separate
reverts, each red. Re-verified in full after the re-render fix below, against the shipped
templates rather than carried forward — three counts in the previous revision of this table
were wrong when written (`updatePaymentFields()` said 6, the shipping-sync gate said 3, and
`applyCompanyIdEditability()` said 7), and several others legitimately moved because the
fix changes what the field's state is at mount:

| Mutation                                                                        | Tests failing                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Delete `:disabled="companyIdDisabled"` from `gateway_method.phtml`              | `payment-company-selection.test.js` fails to run at all — 28 tests never execute |
| Drop the editability recompute from `getItems()`                                | 2                                                                                |
| `getItems()` recompute always `true` (blanket unlock)                           | 1                                                                                |
| `getItems()` recompute always `false` (blanket lock)                            | 6                                                                                |
| Hoist the `getItems()` recompute above its `isSelecting` early return           | 1                                                                                |
| Require the identifier in the `billing_as_shipping_address_updated` gate        | 2                                                                                |
| Drop `companyIdInput.value = companyId` from `updatePaymentFields()`            | 8                                                                                |
| Restore the imperative `disabled = true` + grey in `company-name-payment.phtml` | 2                                                                                |
| Require the identifier before syncing shipping → payment                        | 4                                                                                |
| Drop the editability recompute from the `update-company-data` listener          | 2                                                                                |
| `identifierOf` back to a truthiness test (so `id: 0` reads as absent)           | 1                                                                                |
| Drop the empty-identifier term from the sync's order-intent gate                | 1                                                                                |
| `manualMode` watcher back to assigning `!value` inline                          | 1                                                                                |
| `companyIdDisabled` declared `false` instead of `true`                          | 1                                                                                |
| Sync a selection with an empty company NAME too                                 | 1                                                                                |
| `fillCompanyData()` bails on an empty id again                                  | 4                                                                                |
| `selectItem()` stops deriving `companyIdEntryRequired`                          | 6                                                                                |
| `initialize()` stops deriving it at all (forced `false`)                        | 5                                                                                |
| `initialize()` back to `Boolean(company_name) && !company_id`                   | 3                                                                                |
| `initialize()` derivation forced `true` (blanket unlock)                        | 3                                                                                |
| Drop the `x-for :key` fallback                                                  | 1                                                                                |
| Drop the `companyId &&` term from the order-intent trigger                      | 1                                                                                |
| `applyCompanyIdEditability()` ignores `companyIdEntryRequired`                  | 16                                                                               |

One of these **started green** in an earlier round, and it is worth recording why. Flipping
the declared `companyIdDisabled: true` to `false` changed nothing, because `initialize()` calls
`applyCompanyIdEditability()` unconditionally and overwrites the literal — so every
assertion made after mounting held either way. The literal is nonetheless the state Alpine
binds on FIRST PAINT, before `initialize()` has run, and a wrong one flashes the field open.
It is now pinned by mounting the factory without calling `initialize()`. Nothing in the
re-verified table above starts green.

Two things here have **no automated coverage** and are called out rather than implied: the
`input.company_id:disabled` rule in `custom.css` (Jest asserts no styles), and Alpine's own
evaluation of the binding. What the suite does assert is that the attribute exists on the
right element and holds a bare property name, and that no second
`:style` binding carries the same fact — a string `:style` would set the whole style
attribute, which is where the element's `x-show` writes `display: none`.

That bare-property-name check is the **harness's** contract, not a statement about CSP.
`readAlpineBinding()` resolves a binding as `component[name]`, so that is all it accepts —
narrower on purpose than the CSP Alpine build, which looks the whole expression up as a key
and therefore evaluates the sibling `x-show="!manualMode"` perfectly happily against the
`['!manualMode']` method in `gateway_method-csp-js.phtml`. Dotted paths are the other thing
CSP Alpine accepts and this helper rejects. An earlier revision of this file and of
`harness-contract.test.js` described the guard as a CSP-legality check and cited
`!manualMode` as CSP-illegal; that was backwards, and the module's own getter is the
counter-example.

`company-name-field.test.js` — the address-form picker, which has no overlay and drives an
in-field spinner instead. Same invariant, different surface: every exit from `getItems()`
leaves `isSearching` false and nothing on the wire — selection-in-progress, manual mode,
under three characters, no resolvable country, and an in-flight search superseded by a
backspace. Plus the result paths (`failed` / `degraded` flagged unavailable rather than
empty, zero results not flagged), manual mode being entered _mid-flight_ not reopening the
dropdown over the manual-entry fields, selection writing field + storage + event, the
detail lookup filling the address fields, a failed lookup leaving a buyer-typed value
alone, a company with no lookup id skipping the request, and the click handlers stopping
propagation so the address-book modal does not close.

`payment-company-selection.test.js` — what the payment component
(`twoGatewayHyvaPaymentMethodBase`) does with a selected company once `companyId` is
allowed to be empty. Stopping the throw above is only half the fix; the half that costs
money is downstream. `fillCompanyData()` used to bail on an empty id, so selecting a company
with no identifier wrote the new NAME and left the PREVIOUS company's identifier in the
field — disabled, so the buyer could not correct it, and read straight back out by
`buildOrderIntentRequestBody()` and by the checkout's own `payment[company_id]`. Covered:
name and id always describing the same company, the id field left empty but **editable**
(empty and disabled is an unfillable required field), the locked state derived in one place
from `manualMode || companyIdEntryRequired` so leaving manual mode cannot re-lock a field
still to be filled, selecting an identified company afterwards re-locking it, the same
state arriving from the shipping step's `update-company-data` event and restored from
browser storage, no order intent dispatched for an empty id, and the dropdown's
`x-for :key` staying unique when two hits in one response both lack an identifier (it is
bound to `companyId`, and Alpine renders one row per distinct key, so a collision on `''`
would silently cost the buyer a company that matched).

`payment-manual-mode.test.js` — the payment tile's manual/search mode, which used to be two
properties with no watcher between them: `manualMode` (behaviour — `getItems()` refuses to
search) and `showManual` (visibility — which of the duplicated inputs is `x-show`n).
`initialize()` restored only the first from browser storage, and the address form writes
`manual_mode: true` into that same key, so the tile came up showing a live search box that
could not search — no request, no spinner, no dropdown — and its own two links wrote only the
display flag, so there was no way back. `showManual` is gone; the template binds `manualMode`
and the `['!manualMode']` method.

Assertions are on the SUBMITTING field pair (`payment[company_name]` vs
`payment[manual_company_name]`) rather than on the flag, because the flag is what changed and
the field pair is what a buyer's order carries. Covered: a restored `manual_mode` putting the
manual pair in front of the buyer rather than a dead search box, the tile's own "Search for
company" link clearing the mode _and_ its persisted copy so a search then really goes on the
wire, "Enter details manually" persisting the mode and superseding an in-flight search, and
`companyIdDisabled` following through the registered `manualMode` watcher (which the mount
fires for real — a `$watch` stubbed to a no-op let that chain regress unnoticed).

The last case mounts `twoGatewayHyvaPaymentFormWithValidation`, and it is the load-bearing
one: that — not `PaymentMethodBase` — is what `gateway_method.phtml` binds, and it is built by
SPREADING the base. Object spread reads an accessor and copies its VALUE, so an intermediate
`get showManual()` froze to `false` on the only component that matters, hiding the manual
block while `!manualMode` correctly hid the search block. Both blocks gone, and every other
test green, because nothing else in the suite mounts that factory.

Also here, because it is the consequence of making manual mode visible rather than a fact
about the flag: `company-name-payment.phtml`'s sync into the tile used to find the fields by
`[data-name]`, which is on the SEARCH-mode pair only. While a restored `manual_mode` still
displayed those inputs — the state that made the search box dead — they happened to be the
submitting pair. With manual mode actually shown, that selector writes the hidden
`payment[manual_*]` mirror, so the order would carry the buyer's previous company while the
order intent was approved against the new one. The sync resolves `#company_name` /
`#company_id` now, whose ids follow the mode.

The tile's own file, for the `dispatch-order-intent` leak reason below.

`company-selection-scoping.test.js` — what scopes the `shipping_company_selection`
browser-storage key, which is one global with no quote, store or checkout suffix. Both of the
things that clear it compared QUOTE ids only, and the quote is shared across store views by
design, so a store excursion cleared nothing: the other checkout's company and its
`manual_mode: true` survived the whole quote. The payment step's restore path made that
permanent by rewriting the blob as a two-key object, dropping the `quote_id` its own clearer
needs. Covered on both surfaces: a store-view excursion on the same quote clearing, staying
put not clearing, a new quote still clearing, a pre-scoping blob being armed rather than
wiped, and the restore path preserving `quote_id`, `store_id` and `manual_mode`. This
supersedes the old "`initShippingCompanyStorage()` is out of scope" note.

`payment-method-code.test.js` — that `company-name-payment.phtml` compares against the
BRAND's payment method code rather than the literal `two_payment`. Harmless only while every
brand shipped its own fork of the template; once the overlay was de-forked onto the vanilla
file, a branded store selects its own method code, nothing matched, and the order intent was
never dispatched — silently. These tests render the template with a NON-default brand code
via `extraRules`, because the harness's default substitution is `two_payment`, which is
indistinguishable from the hardcoded literal. Covered on both entry points (page load and
`checkout:payment:method-activate`): the brand's code acts, another brand's does not, and the
rendered JS contains no `two_payment` at all.

Also covered there, and the reason the binding needed a second round: a name **typed
without picking a dropdown hit**. Landing `:disabled="companyIdDisabled"` with a declared
default of `true` locked the field on first paint, where before the binding existed nothing
locked it until a shipping sync did so imperatively. A buyer who typed a company name and
never selected a hit was then facing a `company_id` that was empty AND disabled AND
required — and the only escape, "Enter details manually", sits inside the dropdown's
`x-show="isOpen"`, so it vanishes the moment they tab away. `getItems()`, the name field's
own `@input.debounce.300ms` handler, now recomputes `companyIdEntryRequired` on every edit
from the invariant the whole binding exists for: **enabled whenever there is no
registry-supplied identifier for the name currently in the field, disabled exactly when one
has been written for it**. Six tests pin it, including the two that stop an over-correction
— a blanket unlock would re-open the hand-overwritable registry-number hole, and the
recompute must stay BELOW the `isSelecting` early return or it undoes the lock the
selection just applied. Note the declared default is deliberately still `true`: it is the
state Alpine binds before `initialize()` runs, and the field must not flash open.

And the reason it needed a THIRD round: that recompute writes **component state only**, and
Magewire re-renders destroy and rebuild the component. Only `selectItem()` writes browser
storage, so a name the buyer typed and never picked survives a re-render as _nothing at
all_ — and `initialize()`, deriving the flag as `Boolean(company_name) && !company_id`,
read empty storage as "locked" and re-shut a field the recompute had just opened. Same dead
end, one Magewire round-trip later, and invisible to every test in the suite because nothing
re-mounted after typing. `initialize()` now derives from the same invariant. With the
`$nextTick` restore putting `company_name` back in the field, the comparison collapses to
`!company_id`: empty storage yields **enabled** (nothing has vouched for a number for
whatever is in the field), a restored pick that carried a registry identifier stays
**locked**. Four tests re-mount over live storage to pin it.

One case is pinned as deliberately NOT preserving what the recompute produced: editing the
name after a pick. Storage still holds the picked company, name and identifier together, so
the rebuild restores that company wholesale and the number is registry-supplied for the name
beside it again — locked is then correct, and unlocking would reopen the very hole the
binding closes. What is lost is the half-typed name, which is the restore's pre-existing
"storage wins over a transient edit" behaviour. The pair never disagrees, which is the
property that costs money.

Every editability assertion in that file lands on `document.getElementById('company_id')
.disabled`, applied through the **real** `:disabled` expression read out of
`gateway_method.phtml`. That is not decoration. The first version of this suite asserted only
on `companyIdDisabled`, which at the time was bound to nothing at all: the field was disabled
imperatively elsewhere and never re-enabled, so the suite passed with the required field
permanently uneditable — the exact condition the fix exists to prevent. Deleting the
`:disabled` attribute from the template now fails the whole file at load. A test that cannot
fail for the reason the fix exists is not a test of the fix.

`payment-fields-shipping-sync.test.js` — `company-name-payment.phtml`, the bridge that
copies the shipping step's company onto the payment tile. It gated on name **and**
identifier, so an identifier-less selection was skipped entirely and the tile kept the
previous company's name and number: place-order submitted company A for a buyer who had
selected company B, with nothing prompting a re-entry. It also disabled `#company_id` on
every sync and never reversed it. Covered: an identifier-less company syncing, overwriting
the previous one rather than being skipped, the field never being disabled or greyed
imperatively, an empty NAME still being skipped, and the order intent firing for an
identified company but not for an identifier-less one.

The `shipping-company-selected` path and the `billing_as_shipping_address_updated` Magewire
path are both driven, because the same gate was relaxed in both and only the first had
coverage — reverting the second to `shippingCompany && shippingCompanyId` left the suite
fully green. The Magewire handler registers inside a `DOMContentLoaded` callback behind a
poll for the `Magewire` global, so the test installs a `Magewire` stub **first** (the else
branch arms a 100ms `setTimeout` retry loop that would otherwise never stop) and then
dispatches `DOMContentLoaded` by hand — jsdom fired the real one long before the template
was evaluated. It throws rather than skips if no handler gets registered.

The two "does not touch the field imperatively" tests assert the synced **value** as well
as `disabled` / `style`. That is load-bearing: the fixture starts undisabled with an empty
`style`, so a sync that did nothing whatsoever would satisfy those expectations on its own,
and the tests would have been green by construction.

Its own file because the template registers unremovable top-level `window` listeners — see
the known-leak note below.

`harness-contract.test.js` — the fail-loud guarantees above, for both the JS and the markup
renderer.

## Deliberately out of scope

- **The PHP-side CSP guard.** `Test/Unit/` owns that; duplicating it in JS would assert
  the same thing twice with a weaker tool. (Note: the tests named in TWO-25245 —
  `CspInlineScriptTemplateTest.php`, `QuoteDetailsEncodingTest.php` — are not on `staging`
  yet; they arrive with the open CSP-nonce PR.)
- **Most of the payment-method Alpine components** in `gateway_method-csp-js.phtml`. The
  template is loaded whole, so the order-intent recheck, the term chips and the
  form-validation wrapper all _evaluate_ under test — but nothing asserts on them, and
  mutating any of them leaves the suite green. They are a much larger surface (Magewire
  round-trips, a 500ms debounced global listener, `Alpine.store`) and belong in their own
  suite. The exception is `twoGatewayHyvaPaymentMethodBase`'s company-selection path, which
  `payment-company-selection.test.js` does assert on: the identifier guard made an empty
  `companyId` reachable there, and the wrong-data consequence had to be pinned.
- **Rendered markup, as chrome.** Nothing here mounts a template and asserts on what a buyer
  would see. `isSearchUnavailable`, for instance, is asserted as component state only: the
  markup binding it lives in `companyName.phtml` / outside this module, and a brand overlay
  may override it. The one exception is deliberate and narrow — where
  component state has no effect at all unless a binding carries it to an element, the binding
  itself is read out of the template and applied (`readAlpineBinding()`, and the
  `:disabled` assertions in `payment-company-selection.test.js`). That is not a chrome
  assertion; it is what stops the state being dead. CSS is still entirely uncovered.

## Known leak, and why it is left alone

`gateway_method-csp-js.phtml` registers a top-level
`window.addEventListener("dispatch-order-intent", …)` at the bottom of its script. The
harness evaluates the template once per test, and that listener cannot be removed
afterwards — it is anonymous — so a test file accumulates one handler per test on the
jsdom window it shares.

`payment-company-selection.test.js` is the one file that _does_ dispatch that event, via
`selectItem()`, so it inherits one handler per preceding test in it. Two things keep that
inert rather than flaky, and both are deliberate: the file runs under
`jest.useFakeTimers()`, so no accumulated 500ms debounce ever elapses, and its DOM has no
`input[name="payment-method-option"]:checked`, which is the debounced callback's first exit.
It asserts on the dispatch with a listener of its own that it removes.

`company-name-payment.phtml` has the same shape — anonymous top-level `window` listeners for
`shipping-company-selected` and `checkout:payment:method-activate`. `payment-fields-shipping-sync.test.js`
drives those listeners directly, so it evaluates that template **once**, in `beforeAll`, and
resets the DOM and browser storage per test instead. A per-test load there would run one
handler per preceding test on every dispatch.

Elsewhere the leak is inert for a simpler reason: nothing else dispatches these events, and
each handler only arms the debounce when it fires. A new test that dispatches one belongs in
its own file for the same reason — or have the production template guard its registration the
way the helpers guard theirs (`window.x = window.x || …`).

## Adding tests

Drive behaviour through the component's own methods (`component.getItems()`) rather than
reaching into the helpers, and settle each `fetch` explicitly — out-of-order responses,
aborts and timeouts are the subject matter, so controlling the timing is the point. Settle
or abort every request a test starts: an unsettled search leaves a live 30s timer armed
behind the test.

One trap worth naming: `startSearch()` in both component suites returns the pending
`getItems()` promise **wrapped in an object**. Returning it bare from an `async` function
would make `await startSearch(...)` adopt it, and the test would deadlock waiting for a
request it has not settled yet.
