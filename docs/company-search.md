---
description: "Company search popover, per-role identities and mounts, the two address panels, and signup popup focus rules"
---

# Company search and addresses

### Company search: ONE popover, and it is not in this repo

There is **exactly one company-capture popover IMPLEMENTATION** across Magento's
checkouts, it ships in the BASE plugin, and this module mounts it. Never add a
second implementation, and never patch a surface by copying part of it — that
duplication is what produced a batch of "three independent cosmetic bugs" on the
payment tile that turned out to be one bug, and later what left this checkout's
mode chips outside the panel while Luma's were inside it.

**This module ships NO JavaScript file at all** — `view/frontend/web/js` does not
exist, and it must not come into being. Four base-plugin modules are loaded by
`Two_Gateway::` reference from `view/frontend/layout/hyva_checkout_index_index.xml`
— the panel, the identity, the sole-trader flow and the capture controller — each
framework-free with a UMD tail that attaches a browser global the mounts then read.
The Alpine and Magewire code in this repo's `.phtml` templates is the HOST ADAPTER
those modules ask for, never a second implementation of what they do. A behaviour
change belongs in the base plugin, where both checkouts get it; a new `.js` file
here is the duplication this arrangement exists to prevent.

**ONE IDENTITY AND ONE CONTROLLER PER ADDRESS ROLE.** The checkout can hold two
companies at once — the delivery panel's and the invoice panel's — so
`twoGatewayCompanyIdentity(role)` and `twoGatewayCompanyCapture({role, …})` are
memoized per role in `twoGatewayCompanyIdentityInstances` /
`twoGatewayCompanyCaptureInstances`. Keyed by the role STRING, never by a root
node: a Magewire morph replaces roots, and the captured company has to survive
the re-render. A call with no role is a bug and answers `null` rather than
sharing.

**There is NO propagation between the two panels, of any kind.** Not a mirror,
not a pin, not an event, not a shared field write. A pick in one panel is
invisible to the other. The one thing that reads both is the
ORDER-INTENT/PLACEMENT resolver, which reads the captured identities to decide
which company the API is told about; it writes no identity. Its one deliberate
UI effect is the carve-out from that rule: the payment tile's label and its
order-intent notices name the company the resolver answers, so a delivery-panel
pick IS visible there — a notice naming the company the check ran for is required.
That resolver is `twoGatewayResolveInvoiceCompany()` (TWO-25554): the billing
identity when it presents a company number, else the shipping one, else nothing.
What the surfaces ask is `twoGatewayInvoiceCompany()`, which takes that
resolver's answer and falls back to the tile's own capture. **No surface on this
checkout offers an editable company identifier** (ABN-564): a number reaches the
pair only from a registry hit, so there is no hand-entered value for either to
prefer. `twoGatewayApplyInvoiceCompanyFields()` is the ONLY
writer of the `payment[company_name]` / `payment[company_id]` pair that submits:
it writes each field from that answer and blanks neither while it holds a value
the writer did not put there, which is why the surface mirrors' clear and repaint
call it instead of blanking the pair themselves. The tile hydrates each role's
identity from that role's OWN record at mount, the delivery form not always
being on the page to hydrate its own.

**A stored company carries the country it was captured in** (TWO-26295). Both
records outlive the page and last for the whole quote (a new quote id clears
them), and an organisation number means nothing outside its registry, so a
buyer whose quote moved to an address in another country, a logged-in buyer
picking another saved address included, used to have the old number restored
and sent in the order intent, which the API refuses. Every write of a number stamps `company_country`
(`twoGatewayCompanyCountryStamp()`): a NEW number takes the writing surface's
live country, a rewrite of the same number keeps the stamp it has, so a restore
can never re-stamp a record with whatever country the page shows. Every restore
(the tile's two seeds, the address step's `init()`) skips a record whose stamp
differs from that role's current country, and the resolver answers neither role
for a company whose record was stamped in another country than the one the
intent goes out under (`twoGatewayCompanyCapturedElsewhere()`), which also stops
a delivery company falling back across to an invoice address in another
country. All of it fails OPEN on a missing stamp or a missing country, as the
Luma checkout's own guard does: records written before the stamp existed must
not drop a legitimate company on the first load after an upgrade.

The tile's country is read live. Its quote is the page-load snapshot (the form
is `wire:ignore`d), and a logged-in buyer picking saved addresses has no country
field to read instead, so the tile renders the quote's current billing and
shipping countries in a hidden `[data-two-live-countries]` element outside that
form, which every address re-render refreshes. `getCaptureQuote()` and the
resolver's invoice country overlay it on the snapshot
(`twoGatewayWithLiveCountries()`), billing first, and the order intent is built
from the same quote, so the guard and the intent's country cannot disagree.

Three layers, innermost first:

| Layer                                       | Where                                                                                                                                          | Owns                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popover — the shared company-search panel   | **the base plugin**, whose script this checkout's layout loads and which the mounts reach through the browser global it registers itself under | everything the buyer sees and touches: the panel DOM, open/close, the query field, result rendering, keyboard navigation, the mode chips and the route in and out of manual entry |
| Engine — `twoGatewayCompanySearchEngine()`  | `component/payment/method/gateway_method-csp-js.phtml`                                                                                         | the request, the captured-company state, `selectItem()`, mode toggling, the company-id lock formula, address write-back, storage                                                  |
| Adapter — `twoGatewayCaptureSurfaceMixin()` | same file, layered over the engine                                                                                                             | the six-member search API the popover asks for, which chips this checkout offers and what each one runs, where the panel mounts, and the popover's translated copy                |

**The popover is framework-free with a UMD tail**, which is why this checkout can
load it with no RequireJS, no jQuery and no Knockout. It takes three injected
options — `search`, `translate` and `observe`. This checkout injects the first
two and deliberately withholds `observe`: `$.async` has no equivalent here, and
a MutationObserver per mount is what froze the checkout on this ticket, so the
re-render's own `element.updated` hook drives the re-bind instead. Do not reach
into the panel; if it needs to do something new, change it in the base plugin so
both checkouts get it.

**Its markup is not testable here.** The file is not in this repo and there is no
vendor tree in CI, so `Test/Js/hyva-harness.js` installs a RECORDING stub in
place of the real panel (`installHyvaEnvironment()` returns `companyPanels`,
with `.options` and `.calls`). What this repo tests is its own half of the
contract — the options the adapter passes and the search API it builds over the
engine. The panel's own behaviour is covered where that file
lives, not here. The stub does build the wrapper and panel node the real one
builds, and answers `isBound()` from them: that is the minimum DOM that makes a
re-render's morph observable here, and a constant `true` is the answer that
hides it.

**The popover's STYLING comes from the base plugin too** — its stylesheet is
loaded by this checkout's layout BEFORE `custom.css`, so this module keeps the
last word. Do not copy popover rules into `custom.css`; a test
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
`mountCompanyPopover()` re-points its role's existing panel rather than building
a second one. It stamps `data-two-capture-role` on its control root and the
controller's field selectors are scoped on it alongside
`data-two-capture-host` — the address-step field renderer is registered globally
and mounts on the delivery form AND the invoice form, so a document-wide
selector would give both mounts the first field.

**A surface's role is a live DOM read, resolved fresh, never cached.** An
address panel's is `twoGatewayCaptureRoleForForm()` over the panel that owns its
country field: `billing` where that panel carries a `billing-`prefixed field id,
Hyvä's own `<role>-<field>` convention, else `shipping`. The payment TILE is not
a panel — it is the invoice-role submit surface — and its role is `billing`
unconditionally: it reads and writes the billing record either way, so a role
following `#billing-as-shipping` would seed one role's identity from the other's
record. Its COUNTRY context does follow the checkbox
(`twoGatewayInvoiceRoleCountryField()`), because with one address on the page the
shipping form's country field is the invoice address's country field; identity and
country are resolved separately and only the latter moves. The address-book modal
is shipping-role.

**A Magewire re-render does NOT re-run `init()`.** It MORPHS the server markup
over the live DOM: the popover's `span.two-company-field-wrap` is built at
runtime and is in no server markup, so the morph deletes it — panel, chips and
the mount attribute with it — while KEEPING the element carrying the component's
`x-data`, so Alpine keeps the component and never re-initialises it. Every mount
therefore registers itself in `window.twoGatewayCompanyMounts`, and one
page-level `element.updated` hook remounts any control whose panel reports
`isBound()` false — each entry through its own root's surface, so one role's
remount can never write the other's state. That is also the answer to "why does a shipping-method change
survive": its re-render never touches this form. The same hook puts the caret
back: a morph patches the company input in place and the browser blurs it to
nothing, so the sweep re-focuses the company field — of whichever control still
held the caret when `message.received` fired, only where the drop left focus
unplaced, and once, because the record is spent by the repair (ABN-554).

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

### What focus landing on the checkout does to an open signup popup

The base plugin's sole-trader flow classifies every `focusin` while the hosted
signup window is up, and this checkout inherits all three rules (TWO-25658):

- **the role's own Sole trader chip is inert** — arrival moves the popup neither
  way, and only an activation raises it, the browser delivering Enter and Space on
  a focused chip as a click;
- **any other target closes an open popup**;
- **a target outside that role's popover closes the popover too**, with the company
  field counted as INSIDE it: the field is the popover's own trigger and sits
  outside the panel node, and a buyer typing a query is still inside the control.

A `focusin` the browser re-fires on window return counts as the buyer focusing
that control, so an alt-tab back onto a control is classified like any other
arrival. Opening the popup blurs whatever held focus for exactly that reason —
with nothing focused, a window return settles nothing.

**Focus arriving on ANOTHER capture's Sole trader chip hands the popup over.**
That chip is a different control, so this popup and popover close first; the new
one is then raised by invoking that chip's own click handler, the single place a
launch is spelled out. The exemption is per capture and survives a re-render
because the popover is resolved live as the company field's sibling — a stored
popover node goes stale when a morph deletes the wrap and keeps the field, which
makes a capture's own rebuilt chip read as a sibling's (TWO-25658).

**The POINTER route is not covered.** A chip's `mousedown` cancels, so a real
click fires no `focusin` and reaches none of this: a buyer clicking a second
capture's chip with the mouse can hold two popups open at once. Closing that means
changing the chip's click path, not the focus rule — a mount must not read the
focus rules as covering it.

All of it lives in the base plugin, none of it in this repo. A mount that adds
focus handling of its own to a chip or the company field is competing with rules it
cannot see.

**The open panel takes the company field's tab stop**, inherited the same way:
`tabindex="-1"` while it is up, and on close the field's PRIOR value restored
exactly — a theme's own `tabindex` is given back, and removal is what a field
carrying none gets back (TWO-25503). Without it the
focus opener is a keyboard trap — the opener puts the caret in the query field,
Shift+Tab returns to the field, and the opener pushes focus forward again (WCAG
2.1.2). A mount must not write a `tabindex` onto that field.

### A popup window is in no tab listing

`window.open` returns a window outside a browser extension's tab group, so a tab
list can never answer "did the popup open" — nor can a hang. The authoritative
check is the page's own retained handle and its `.closed`, which means wrapping
`window.open` before the action that should raise one. Judging from a tab list
yields a confident false "no window opened".

### Two addresses, and NOTHING passes between them

The checkout can hold two addresses — shipping, and a separate billing one once
"billing same as shipping" is unticked — and both stay fully editable, always.
Making a company or country read-only was evaluated and rejected: a company with
a branch in a neighbouring country is one legal entity with two genuinely
different valid local pairings.

**The two panels do not interact.** Each has its own identity, its own capture
controller, its own storage record and its own popover, and each writes ONLY its
own surface:

- Role-scoped selectors, never document-wide ones. A surface resolves its own
  fields under its own control root; `data-two-capture-role` is what makes the
  controller's `addressFieldSelector` / `tileFieldSelector` answer for one panel.
- `watchCountryChanges` fires for a country field of the watching role only, by
  id prefix or by which panel contains it. A document-level listener on any
  `*country_id` is a cross-panel write.
- Sole-trader autofill (`captureApplyBuyerAddress`, `captureApplyTelephone`)
  writes the surface's OWN form. A surface with no form of its own — the tile —
  writes nothing, deliberately: filling a form the buyer is not looking at is
  forbidden.
- The identity mirror writes its own surface's state, its own storage record and,
  on the TILE only, the `#company_name` / `#company_id` pair that submits.
- **Per-surface state is keyed on the surface's own root node, never on the kind
  of host.** One renderer mounts the company field on both address forms, so one
  key per kind of host is one key shared between two live surfaces, and the
  second mount tears down the first's subscription.
- **A CAPTURED COMPANY MUST BE ANNOUNCED TO THE MAGEWIRE MODEL, and only this
  host can do it.** The popover announces a pick by writing the field and firing
  `change`; it fires no `input`, and this checkout's company input is
  `wire:model.defer`, whose text-input updates come from `input`. So the
  server-side model never learned the pick, and the next address-form roundtrip
  re-hydrated the input from that model and wrote `null` over the buyer's
  company — measured live at +5.59s after the pick, which is the reported
  "the name disappears after 3 to 4 seconds". The autofilled city/postcode/street
  survive the same roundtrip precisely because the engine's own write DOES fire
  `input` on them. `announceCapturedCompanyToModel()` says it through
  `Magewire.find(...).set(model, name, true)` — deferred, so it costs no request
  — reading the model name off the field, because which model the input binds to
  is the checkout's decision and differs per form. It must NOT be said by
  dispatching the missing `input`: the popover binds `input` on that field and
  reads whatever arrives as the buyer typing, so a synthetic one reopens the
  popover on the name it just captured.
- **The re-render sweep restores CONTENT as well as structure.** Second line of
  defence for the same invariant: a morph can rewrite the company input without
  touching the popover's wrapper, and every other repaint is gated on a change
  that has not happened then — the mirror on the component's own state, the
  popover's rebind on its wrapper being gone. So `mountCompanyPopover()` ends by
  reconciling the captured pair (`repaintCapturedNameFields()`), both directions
  (an empty identity clears the field, because the server's value can equally be
  a company the buyer has since discarded), idempotently and with no event.
- **A surface's subscription is disposed by the re-render that removed it.** The
  `element.updated` hook reaps every watcher whose root has left the document,
  because a teardown that waits for the next mount never runs on a page with one
  control.

Whichever address plays the **billing/invoice role** is the one that requires a
company and org number — never a shipping-only address, and the role is resolved
fresh from the DOM rather than remembered.
