/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. company-name-payment.phtml compares against the BRAND's payment
 * method code, not the literal `two_payment`.
 *
 * The literal was harmless only for as long as every brand shipped its own fork
 * of this template. Once the overlay was de-forked onto the vanilla file, a
 * branded store's checkout selects its own method code, the comparison never
 * matched, and the order intent was simply never dispatched — silently, because
 * nothing errors when a company is available and no intent goes out.
 *
 * The harness substitutes `getMethodCode()` with `two_payment` by default, which
 * is exactly the value a hardcoded literal would have, so these tests render the
 * template with a DIFFERENT brand code via `extraRules`. That is the only way to
 * tell "reads the view model" from "happens to say two_payment".
 */

"use strict";

const H = require("./hyva-harness");

const BRAND_METHOD = "examplebrand_payment";
// The template hoists the view-model call into `$methodCode` and interpolates
// that; both spellings are pinned so neither can silently stop being covered.
const BRAND_RULES = [
  [/^\$brandedViewModel->getMethodCode\(\)$/, BRAND_METHOD],
  [/^\$methodCode$/, BRAND_METHOD],
];

describe("payment-fields template method code", () => {
  let env;
  let intents;
  let onIntent;

  beforeEach(() => {
    // The template's Magewire poll is a 100ms setTimeout chain.
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();

    intents = [];
    onIntent = function () {
      intents.push("dispatch-order-intent");
    };
    window.addEventListener("dispatch-order-intent", onIntent);

    // A company already chosen in the current quote, so the stale-data clearer
    // leaves it alone and the order-intent path is reachable.
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({
        quote_id: "test-quote-1",
        company_name: "Example Trading Ltd",
        company_id: "12345678",
        manual_mode: false,
      }),
    );
  });

  afterEach(() => {
    window.removeEventListener("dispatch-order-intent", onIntent);
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  /**
   * The payment form as the checkout renders it, with one method radio checked.
   *
   * @param {string} checkedMethod
   * @returns {void}
   */
  function renderPaymentForm(checkedMethod) {
    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="' +
        checkedMethod +
        '" checked />',
      '<div x-data="stub">',
      // As the tile renders them. `data-name` is both the readiness signal the
      // MutationObserver waits for and what the sync writes through; the ids are
      // here because they are what the template emits, and the assertions read
      // them rather than depending on the selector the writer happens to use.
      '  <input type="text" id="company_name" data-name="company_name" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" value="" />',
      "</div>",
    ].join("\n");
  }

  /**
   * @param {Array<[RegExp, string]>} [extraRules]
   * @returns {void}
   */
  function run(extraRules) {
    // The publisher FIRST, then the consumer. The company selection is reached
    // only through `window.twoGatewayReadCompanySelection`, which this template
    // resolves into a local behind a `function(){ return {}; }` fallback so a
    // page without the publisher degrades instead of throwing. Without the
    // publisher loaded here that fallback returns `{}`, no company is ever
    // found, and the order-intent path these tests are about is unreachable —
    // a suite that passes its negative cases while testing nothing.
    H.loadSharedHelpers();
    H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE, extraRules);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }

  describe("on page load, with a company already selected", () => {
    test("dispatches the order intent for the BRAND's method code", () => {
      renderPaymentForm(BRAND_METHOD);

      run(BRAND_RULES);

      expect(intents.length).toBeGreaterThan(0);
    });

    test("does not dispatch for a method that is not this brand's", () => {
      renderPaymentForm("two_payment");

      run(BRAND_RULES);

      // The mirror image of the bug: a hardcoded `two_payment` would fire here
      // and stay silent above, which is precisely backwards on a branded store.
      expect(intents).toEqual([]);
    });
  });

  describe("on checkout:payment:method-activate", () => {
    test("acts on the brand's method code", () => {
      renderPaymentForm(BRAND_METHOD);
      run(BRAND_RULES);
      intents.length = 0;

      window.dispatchEvent(
        new CustomEvent("checkout:payment:method-activate", {
          detail: { method: BRAND_METHOD },
        }),
      );

      expect(intents.length).toBeGreaterThan(0);
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
    });

    test("ignores another brand's method code", () => {
      renderPaymentForm(BRAND_METHOD);
      run(BRAND_RULES);
      intents.length = 0;

      window.dispatchEvent(
        new CustomEvent("checkout:payment:method-activate", {
          detail: { method: "two_payment" },
        }),
      );

      expect(intents).toEqual([]);
    });

    /**
     * TWO-25326 tile bugfix batch, bug 3.
     *
     * A company picked IN THE PAYMENT TILE is written to the BILLING storage
     * key (window.twoGatewayWriteBillingCompany), never the shipping one — see
     * TWO-25326 review round 3's key split. This listener is the deferred
     * retry for a pick made before Two became the active payment method (the
     * initial dispatch-order-intent, fired from fillCompanyData() at pick
     * time, is dropped while a different method is active, by design). Before
     * the fix it read ONLY the shipping key, so a tile-mode pick's retry
     * always found nothing and the buyer's order intent never fired at all.
     */
    test("fires the deferred order intent for a company captured in the TILE (billing key)", () => {
      // No SHIPPING record at all — only the billing one the tile itself
      // writes. `beforeEach` already seeded the shipping key; this test is
      // specifically about the case where the buyer has NO shipping-step pick
      // and picked their company in the tile instead, so it overwrites that
      // seed with an empty record. Seeded BEFORE `run()`: the template's own
      // page-load path (`initializePaymentFieldsFromShipping()`) also reads
      // storage and fills the field synchronously on `DOMContentLoaded`, and
      // `updatePaymentFields()` only ever writes an EMPTY field — seeding
      // after `run()` would leave the page-load path's (stale) value in place
      // and mask the very fallback this test is about.
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({ quote_id: "test-quote-1" }),
      );
      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Tile Captured Ltd",
          company_id: "87654321",
          company_id_source: "registry",
        }),
      );

      renderPaymentForm(BRAND_METHOD);
      run(BRAND_RULES);
      intents.length = 0;
      // The page-load path (gated on `activePaymentMethod.value === method
      // code`) may already have populated and fired for the billing record —
      // reset the field to isolate the method-activate listener's OWN fallback.
      document.getElementById("company_name").value = "";
      document.getElementById("company_id").value = "";
      intents.length = 0;

      window.dispatchEvent(
        new CustomEvent("checkout:payment:method-activate", {
          detail: { method: BRAND_METHOD },
        }),
      );

      expect(intents.length).toBeGreaterThan(0);
      expect(document.getElementById("company_name").value).toBe(
        "Tile Captured Ltd",
      );
      expect(document.getElementById("company_id").value).toBe("87654321");
    });

    test("prefers the BILLING record over the shipping one when both exist", () => {
      // Mirrors the identical billing-first fallback the tile's own
      // initialize() uses (gateway_method-csp-js.phtml) — two surfaces
      // answering "which company is this?" differently is how a buyer ends up
      // with the wrong one on the order.
      renderPaymentForm(BRAND_METHOD);
      run(BRAND_RULES);
      intents.length = 0;

      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Billing Wins Ltd",
          company_id: "11112222",
          company_id_source: "registry",
        }),
      );
      // The page-load path already filled the field from the SHIPPING record
      // `beforeEach` seeds — reset it so the assertion below is isolated to
      // what THIS event's own fallback resolves, not a value an earlier path
      // already wrote and the `!companyNameInput.value` guard then preserved.
      document.getElementById("company_name").value = "";
      document.getElementById("company_id").value = "";

      window.dispatchEvent(
        new CustomEvent("checkout:payment:method-activate", {
          detail: { method: BRAND_METHOD },
        }),
      );

      expect(document.getElementById("company_name").value).toBe(
        "Billing Wins Ltd",
      );
    });
  });

  test("the template carries no hardcoded method code in its logic", () => {
    const js = H.renderTemplateJs(H.PAYMENT_FIELDS_TEMPLATE, BRAND_RULES);

    // Rendered with a non-default brand, so any surviving `two_payment` is a
    // literal in the source rather than a substituted view-model value.
    expect(js).not.toContain("two_payment");
    expect(js).toContain(BRAND_METHOD);
  });
});
