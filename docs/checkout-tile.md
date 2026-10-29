---
description: "Payment tile rules: base-module copy, the consent checkbox, order intent, the charged term, term chips and repricing"
---

# Checkout payment tile

### Buyer-facing copy and links come from the base module

The payment tile's subtitle and the explainer come from the base module's
`CheckoutTileCopy` service through `CheckoutConfig`, never from a hardcoded URL,
a translated string here or a re-derivation of brand data (ABN-496). A brand that
supplies no URL gets no anchor and no tagline at all — never an empty `href`,
never an empty element.

**The explainer is ONE control, and it is the icon** (ABN-554) — the icon IS the
anchor to the brand's about page, describing itself through a `role="tooltip"`
body it names with `aria-describedby`. `component/tooltip.phtml` renders it into
the method row and translates nothing of its own; the tile body carries no second
explainer.

The theme's payment-method-icon toggle gates the brand logo, not the explainer:
`MethodMetaDataPlugin` gates each half on its own rule and wraps neither when it
is withheld, an empty wrapper still costing its padding and its share of the row.

Whether the intent-declined notice renders at all, and its wording, come from two
separate brand-registry declarations: only the switch suppresses it, and the copy
override is inert when empty — an empty override never doubles as an off switch
(TWO-25326). A base declaring no declined switch falls back to the approved
notice's switch, so a brand that turned that one off gets neither; a base
declaring no switch of either kind leaves the notice on.

`dev/base-tile-copy-parity.sh` pins the tile-copy methods this checkout calls
against the base module's declarations, and `ci.yml` invokes it as
`bash dev/base-tile-copy-parity.sh`. **Invoke anything whose failure mode is "did
not execute" through `bash`**: run as `./script.sh` it depends on the committed
mode, and a `100644` script exits 126 — on a CI dashboard indistinguishable from a
check that ran and failed, so the guard's own absence reads as its verdict.

### The consent checkbox is named by reference, never by a label

The payment-terms checkbox takes its accessible name from an `aria-labelledby`
pointing at the element that holds the consent sentence (ABN-554). The sentence
is deliberately not wrapped in a `label`: it carries the link to the terms
document, and activating a label activates its control, so a label would leave
the link hard to reach. No `aria-label` either — the visible sentence is the
name, and a second copy of it is a second string to keep in step (WCAG 2.5.3).

Both ids are keyed on `BrandedHyvaViewModelInterface::getMethodCode()`, so a
second brand's tile on the same page names its own sentence rather than this
one's.

### Order intent: one box, and a verdict that can be repainted

The tile shows **at most one VERDICT** — available, not available, could not be
determined — plus an in-progress row that is a separate fact and may legitimately
be up alongside nothing. All four are one box style in one place. The rules that bite:

- **ONE PAINTER.** `refreshOrderIntentVerdict()` is the only thing that writes a
  verdict notice. The reply handlers RECORD and then call it; they do not paint.
  `clearOrderIntentNotices()` takes all three states down and deliberately does
  NOT touch the in-progress row. Assignment lists that name only the siblings a
  caller happens to remember are how a state gets forgotten when a fourth one is
  added.
- **A CHECK IN PROGRESS OUTRANKS EVERY RECORDED VERDICT.** `refresh` paints
  nothing while `orderIntentChecking` is true, and nothing under an open results
  panel. "Checking availability" and a conclusion may never be on screen together.
  The corollary is the part that bites: because a verdict can be _suppressed_,
  something must repaint it when the check stops — so `setOrderIntentChecking()`
  is the ONLY way the row goes down, and it re-derives the box. Lowering the flag
  by hand reintroduces a blank box that nothing can refill. Guarding one route at
  a time, instead of stating the rule, always leaves one more route to a verdict
  beside a progress row.
- **Records are PER COMPANY, keyed by id.**
  `orderIntentDecisions[id] = { name, approved, basket }` and
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
- **A DECISION STANDS ONLY FOR THE BASKET IT WAS PRICED ON** (TWO-26296). The base
  prices the intent from the quote when the request arrives, so a check sent when
  the company is picked, before shipping and tax are known, was priced on a basket
  the order will not have. `GetQuoteDetails::getIntentBasketKey()` is an opaque
  hash of the totals the intent is priced on (currency, grand total, quantity, and
  each address's country, tax, shipping amount and method, the country because
  the intent is sent under it), rendered into
  `#<method code>_intent_basket` OUTSIDE the tile's `wire:ignore` form, so every
  re-render carries the current one; the form's own `data-hyvacsp1` snapshot is
  page-load only. A decision records the basket its request was SENT under, and a
  decision for another basket is no decision: it does not satisfy the dedup gate
  or paint a verdict. A Magewire `element.updated` hook calls
  `recheckOrderIntentIfBasketMoved()`, which re-asks when the basket differs from
  the one the company's latest check was sent under (`orderIntentSentBaskets`,
  module scope beside `orderIntentSeq`). Keyed on SENT, not decided, so a check
  still in flight when shipping is chosen is replaced and its late reply dropped by
  the sequence guard. An unchanged basket re-asks nothing, so repeated re-renders
  cost no requests, and the many `element.updated` calls of one re-render fall
  inside the dispatcher's 500ms debounce. A DECLINE for an older basket still
  refuses placement (`isOrderIntentPlacementRefused()`, which both the button
  and the validator read) until the re-check answers: a decision or a failure for
  the current basket replaces it. Otherwise a declined buyer could place in the
  window between a basket change and the new verdict. An approval for an older
  basket does not hold placement during that window, as no check in flight ever
  has. Every term chip click reprices the quote, so it moves the basket and costs
  one re-check; that is correct, not a request storm.
  A tile template that does not render the basket element reads `''` throughout
  and keeps the old single-check behaviour.
- **ONE VERDICT, ONE NOTICE — never a toast while the box exists** (TWO-25326).
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
- **Every order-intent gate asks `twoGatewayInvoiceCompany()`** (TWO-25554)
  — the dispatch trigger, the per-company dedup and verdict records, the notice
  copy and the tile label alike, so a company picked in the DELIVERY form gets the
  same client-side pre-check as one picked in the invoice form. The tile's own
  state stays its own role's mirror; only the reads move.
  `company-name-payment.phtml`'s `checkout:payment:method-activate` handler
  exists because a company picked before Two became the active payment method
  never got its intent fired — the global listener drops a dispatch while another
  method is active. That re-arm asks the resolver first and falls back to the
  BILLING record for a page whose identities are not seeded yet; it writes no
  field either way. Both markup modes keep
  `data-name` on the company pair so a surface that is not the payment form can
  resolve it without a document-wide id lookup.
- **The payload assembly is NOT part of the check.** `setPaymentData` carries the
  captured company number onto the quote payment, and that is the only thing that
  puts it there — the server refuses placement without it — so it runs whether or
  not the merchant has the intent call switched on (ABN-554).
- **A DECLINE REFUSES PLACEMENT** (TWO-25657). The `hyvaCheckout.validation` callback
  returns false for a recorded `approved: false` on the company being placed for; no
  record and a recorded FAILURE both place normally. The declined message is toasted
  because a click-time refusal needs a click-time signal. The BUTTON is disabled as
  well, from the same record — `applyOrderIntentPlacementGate()`, which calls Hyvä's
  own `navigation.disableButtonPlaceOrder()`/`enableButtonPlaceOrder()` and sets the
  `disabled` attribute those events no longer reach in Hyvä Checkout 1.3.13, lifting
  only its own decline so a placement already in flight stays blocked.

### Placement states the charged term

`Plugin\Payment\RecordSelectedTermPlugin` states the payment term this checkout
is charged for on the quote payment immediately before placement, reading the
base module's own charged-term resolver — the same object that module prices the
surcharge through, so the order and the fee cannot name different terms. Without
it the payload carried no term at all, the composer substituted the configured
default, and every other offered term was refused as unavailable (ABN-556).

It belongs at placement rather than in the tile's payload assembly: that
assembly runs a round trip earlier, so a chip clicked afterwards would leave the
recorded term behind. Both brands route placement through the same plugged
service, so the plugin is the one place that covers every store view.

**The chip state stays the buyer's raw choice, not the resolved one.** A term the
merchant withdraws mid-checkout matches no chip, which is what leaves the default
chip clickable — and clicking it is the only thing that rewrites the session, so
rendering the resolved fallback as already-selected would make the chip inert and
strand the buyer behind the term re-check that runs first at placement
(TWO-24812).

**The payment tile's Magewire component takes new dependencies LAST, after the
method code.** Subclasses outside this repository forward the constructor
positionally, so a dependency inserted ahead of the method code lands in the
wrong parameter and the tile stops constructing. No CI leg here pairs the
extension with such a subclass, so
`Test/Unit/Magewire/Checkout/Payment/GatewayMethodConstructorTest.php` is the
guard (ABN-556).

**The chosen term is guarded end to end** (ABN-621). `Test/Chain/` runs the
buyer's clicks (chip selection, the tile saving its form, a late chip change, a
term the merchant withdraws) through the tile's component and the plugins
registered in `etc/frontend/di.xml` in their registered order, against the base
module's real charged-term resolver, and asserts the term on the quote payment
that the order composer reads. It is a config of its own,
`phpunit -c phpunit.chain.xml`, because the unit suite stubs that resolver; it
needs a base-module checkout in `./base-module` (or `TWO_BASE_MODULE`) and CI
checks out the base's `staging` for it. It stops at the payment: composing the
order needs the Magento framework, which no PHPUnit suite here loads. A
withdrawn term is refused at placement by the availability re-check that runs
first, and is never stated on the payment.

### A chip states its term type, not just a day count

An end-of-month term falls due that many days after the end of the month, so a
chip reading "30 days" on a shop configured that way states the wrong due date
(ABN-554). The visible text is `30 days` under standard terms and `EOM+30` under
end of month, and only the end-of-month chip carries a `title` and an
`aria-label`, both reading `EOM+30: pay 30 days after the end of the month`. The
name opens with the visible token because WCAG 2.5.3 requires the accessible name
to contain the visible text, so the phrase may not be reordered to lead with the
explanation. A standard chip carries neither, since a name restating its visible
text would risk the same criterion.

The name states the surcharge too, because an `aria-label` replaces the whole
accessible name and the `+€n.nn` rendered inside the chip is then announced
nowhere: `EOM+30: pay 30 days after the end of the month, plus a €7.25
surcharge`. Each wording is one translated sentence rather than an assembled
one, so a translator can order the clauses. A term carrying no surcharge, a set
where every term quotes nothing, and a chip mid-round-trip all name no amount.

**The templates and both name sentences come from the Magewire component, not
from the template file.** Alpine's CSP build forbids expressions in attribute
bindings, so the chip's own script can only read a bare identifier; the day count
and the stored term type are both known server-side. That also makes each of them
directly unit-testable, where a conditional buried in the `.phtml` is not. Only
the amount is left for the browser, as `%2` in the fee sentence, because the quote
lands after the chip does — which is why the chip binds its `title` and
`aria-label` to a getter rather than taking the rendered literals and stopping
there.

### The sole offered term is a disabled button

One offered term is not a choice, but it still carries the name spelling the term
out, and ARIA prohibits naming a role-less element — which a bare `span` is. So
the sole chip is a `button` with the native `disabled` attribute: naming works,
and a natively disabled button is not focusable, so the tab order skips a chip
with nothing to select. Its appearance is unchanged, which takes one CSS
exclusion: the rule that fades a chip while any term round-trip is in flight
keys off `[disabled]`, and the sole chip is permanently disabled rather than
busy.

### A term change is never left unpriced

`selectTerm()` writes the session term and reprices; a failed save restores the
previous term and reprices again, in that order. The surcharge is priced off
the session term, and placement compares the term it composes the order with
against the term the fee was priced on — it refuses a disagreement and charges
an agreement, so a restored-but-unpriced term would compose the previous term
carrying the abandoned term's fee. When the compensating repricing also fails
the session goes back to the abandoned term, whose fee it is still holding.
