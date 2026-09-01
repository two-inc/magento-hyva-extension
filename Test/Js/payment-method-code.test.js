/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259 / TWO-25326. `company-name-payment.phtml`'s order-intent re-arm:
 * it compares against the BRAND's payment method code, and it resolves the
 * company from the BILLING record alone.
 *
 * The method-code half: the literal `two_payment` was harmless only for as long
 * as every brand shipped its own fork of this template. On the de-forked file a
 * branded store's checkout selects its own method code, the comparison never
 * matches, and the order intent is silently never dispatched. The harness
 * substitutes `getMethodCode()` with `two_payment` by default — exactly what a
 * hardcoded literal would give — so these tests render with a DIFFERENT brand
 * code, which is the only way to tell "reads the view model" from "happens to
 * say two_payment".
 *
 * The record half: the tile's company is the invoice-role one, so the shipping
 * step's selection is not a candidate here. A shipping record is seeded
 * throughout, and every case that must not dispatch is a case a shipping
 * fallback would have dispatched for.
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

const CURRENT_QUOTE = "test-quote-1";

describe("payment-fields template order-intent re-arm", () => {
  let env;
  let intents;
  let onIntent;

  beforeEach(() => {
    env = H.installHyvaEnvironment();

    intents = [];
    onIntent = function () {
      intents.push("dispatch-order-intent");
    };
    window.addEventListener("dispatch-order-intent", onIntent);

    // A shipping-step company, in the current quote so the stale-data clearer
    // leaves it alone. Nothing here may resolve it.
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({
        quote_id: CURRENT_QUOTE,
        company_name: "Shipping Step Ltd",
        company_id: "12345678",
        manual_mode: false,
      }),
    );
  });

  afterEach(() => {
    window.removeEventListener("dispatch-order-intent", onIntent);
    env.restore();
    document.body.innerHTML = "";
  });

  /**
   * Load publisher then template, and fire the DOMContentLoaded jsdom has
   * already dispatched by the time the template is evaluated.
   *
   * The publisher FIRST: the billing record is reached only through
   * `window.twoGatewayReadBillingCompany`, behind a `function(){ return {}; }`
   * fallback so a page without the publisher degrades instead of throwing.
   * Without it every negative case below would pass against a template that
   * never read a record at all.
   *
   * @param {Object} [billingRecord] seeded before boot, so the new-order clear sees it
   * @returns {void}
   */
  function run(billingRecord) {
    if (billingRecord) {
      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
        JSON.stringify(billingRecord),
      );
    }
    H.loadSharedHelpers();
    H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE, BRAND_RULES);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }

  /**
   * @param {string} method
   * @returns {void}
   */
  function activate(method) {
    window.dispatchEvent(
      new CustomEvent("checkout:payment:method-activate", {
        detail: { method: method },
      }),
    );
  }

  const CAPTURED = {
    quote_id: CURRENT_QUOTE,
    company_name: "Tile Captured Ltd",
    company_id: "87654321",
    company_id_source: "registry",
  };

  /*
   * Asserted as "any intent" rather than a count: the activation listener is
   * anonymous and on `window`, so each template load in this file leaves one
   * more handler firing on every dispatch.
   */
  test.each([
    {
      method: BRAND_METHOD,
      expected: true,
      description: "the brand's own method code re-arms the intent",
    },
    {
      method: "two_payment",
      expected: false,
      description:
        "another brand's method code, which a hardcoded literal would match, does not",
    },
  ])("$description", ({ method, expected }) => {
    run(CAPTURED);

    activate(method);

    expect(intents.length > 0).toBe(expected);
  });

  /*
   * A billing record can be non-empty while naming no company:
   * `{manual_mode}`, the `{quote_id}` stamp clearStaleBillingCompanyIfNeeded
   * leaves behind, and the blanked pair forgetStaleCompanyId writes are all of
   * that shape. Both halves of the pair are required, because the intent
   * request carries the identifier.
   */
  test.each([
    {
      billing: CAPTURED,
      expected: true,
      description: "a billing company with an identifier dispatches",
    },
    {
      billing: { quote_id: CURRENT_QUOTE },
      expected: false,
      description: "the new-order quote-id stamp alone dispatches nothing",
    },
    {
      billing: { quote_id: CURRENT_QUOTE, manual_mode: true },
      expected: false,
      description: "a mode flag alone dispatches nothing",
    },
    {
      billing: { quote_id: CURRENT_QUOTE, company_name: "Half Captured Ltd" },
      expected: false,
      description:
        "a billing company with no identifier yet dispatches nothing",
    },
    {
      billing: {
        quote_id: CURRENT_QUOTE,
        company_id: "87654321",
        company_id_source: "",
      },
      expected: false,
      description: "an identifier naming no company dispatches nothing",
    },
    {
      billing: null,
      expected: false,
      description:
        "no billing record dispatches nothing, shipping company or not",
    },
  ])("$description", ({ billing: billingRecord, expected }) => {
    run(billingRecord);

    // Page load itself arms nothing — the re-arm is the activation event's.
    expect(intents.length).toBe(0);

    activate(BRAND_METHOD);

    expect(intents.length > 0).toBe(expected);
  });

  test("the template carries no hardcoded method code in its logic", () => {
    const js = H.renderTemplateJs(H.PAYMENT_FIELDS_TEMPLATE, BRAND_RULES);

    // Rendered with a non-default brand, so any surviving `two_payment` is a
    // literal in the source rather than a substituted view-model value.
    expect(js).not.toContain("two_payment");
    expect(js).toContain(BRAND_METHOD);
  });
});
