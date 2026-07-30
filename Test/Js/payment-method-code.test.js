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
  });

  test("the template carries no hardcoded method code in its logic", () => {
    const js = H.renderTemplateJs(H.PAYMENT_FIELDS_TEMPLATE, BRAND_RULES);

    // Rendered with a non-default brand, so any surviving `two_payment` is a
    // literal in the source rather than a substituted view-model value.
    expect(js).not.toContain("two_payment");
    expect(js).toContain(BRAND_METHOD);
  });
});
