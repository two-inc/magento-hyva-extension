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
right long-term move. It is deliberately **not** done here: it is a production change,
and this is a test-only PR. `hyva-harness.js` therefore does the extraction at test time
instead:

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

**No production code was changed to make this testable.**

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
  exists after evaluation.

`harness-contract.test.js` pins all four against fixtures in `fixtures/`, and also renders
each of the three real templates and syntax-checks the output. So a template edit the
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

The TWO-25253 identifier guard was mutation-checked the same way, five separate reverts each
going red: restoring the unguarded `item.national_identifier.id` read fails 8 tests; putting
back `fillCompanyData()`'s bail on an empty id fails 3; reverting the `manualMode` watcher to
assigning `!value` inline fails 1; dropping the `x-for :key` fallback fails 1; and dropping
the `companyId &&` term from the order-intent trigger fails 1.

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
(empty and disabled is an unfillable required field), the greyed-out state derived in one
place from `manualMode || companyIdEntryRequired` so leaving manual mode cannot re-lock a
field still to be filled, selecting an identified company afterwards re-locking it, the
same state restored from browser storage, no order intent dispatched for an empty id, and
the dropdown's `x-for :key` staying unique when two hits in one response both lack an
identifier (it is bound to `companyId`, and Alpine renders one row per distinct key, so a
collision on `''` would silently cost the buyer a company that matched).

`payment-manual-mode.test.js` — the payment tile's manual/search mode, which used to be two
properties with no watcher between them: `manualMode` (behaviour — `getItems()` refuses to
search) and `showManual` (visibility — which of the duplicated inputs is `x-show`n).
`initialize()` restored only the first from browser storage, and the address form writes
`manual_mode: true` into that same key, so the tile came up showing a live search box that
could not search — no request, no spinner, no dropdown — and its own two links wrote only the
display flag, so there was no way back. `showManual` is now a read-only getter over
`manualMode`. Covered: a restored `manual_mode` putting the tile into the manual fields rather
than a dead search box, the tile's own "Search for company" link clearing the mode _and_ the
persisted copy so a search then really goes on the wire, "Enter details manually" persisting
the mode and superseding an in-flight search, and the dual-input ids following the one flag.
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

`harness-contract.test.js` — the four fail-loud guarantees above.

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
- **Rendered markup.** `isSearchUnavailable` is asserted as component state, not as
  chrome: the markup that binds it lives in `companyName.phtml` / outside this module, and
  the branded overlay ships its own fork of it.

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

Elsewhere the leak is inert for a simpler reason: nothing else dispatches the event, and each
handler only arms the debounce when it fires. A new test that dispatches it belongs in its
own file for the same reason — or have the production template guard its registration the way
the helpers guard theirs (`window.x = window.x || …`).

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
