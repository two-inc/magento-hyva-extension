/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 §7.4 (2026-08-04). Client-side enforcement that a company was
 * actually captured before Place Order, in the configuration where the tile
 * is text-only.
 *
 * In that configuration (`isCompanySearchInPaymentTile` = false, the
 * production default) the tile renders ONLY two hidden mirror inputs
 * (`#company_name` / `#company_id`), which carry no `required` /
 * `data-validate` — a hidden field cannot use the browser's own
 * required-field UI. `hyva.formValidation()` only examines elements that DO
 * carry one of those attributes, so before this it silently passed an order
 * with neither field filled whenever the address step's own control never
 * ran (a saved address chosen without opening the address form, or a virtual
 * cart with no shipping step). `hasRequiredCompanyCapture()` is the explicit
 * check that closes that gap; this file is what verifies it fires rather
 * than merely existing.
 *
 * The opposite configuration (tile is the active location) needs no
 * additional check: the tile's own inputs there carry `required` +
 * `data-validate` and are already covered by `hyva.formValidation()`, which
 * `hasRequiredCompanyCapture()` itself documents and returns `true`
 * unconditionally for — asserted below so a future change cannot silently
 * make this check start double-enforcing (or worse, disagreeing with) the
 * native validation on that path.
 */

"use strict";

const H = require("./hyva-harness");

const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const ADDRESS_AREA = [[/^\$isCompanySearchInPaymentTile$/, ""]];
const PAYMENT_TILE = [[/^\$isCompanySearchInPaymentTile$/, "1"]];

/**
 * Mount the payment form component against a bare form carrying the two
 * hidden mirror inputs, the way the text-only tile renders them.
 *
 * @param {Object} env from installHyvaEnvironment()
 * @param {Array<[RegExp, string]>} extraRules
 * @returns {Object} the mounted component
 */
function mountForm(env, extraRules) {
  document.body.innerHTML = [
    '<form id="two_payment_form">',
    '  <input type="hidden" id="company_name" name="payment[company_name]" />',
    '  <input type="hidden" id="company_id" name="payment[company_id]" />',
    "</form>",
  ].join("\n");

  H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE, extraRules);
  env.fireAlpineInit();

  const root = document.getElementById("two_payment_form");
  return H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
    el: root,
    root: root,
    wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
  });
}

describe("payment-form company-capture enforcement (TWO-25326 §7.4)", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  describe("address-area configuration (tile is text-only)", () => {
    test("blocks when neither hidden mirror field has a value", () => {
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");

      expect(form.hasRequiredCompanyCapture(root)).toBe(false);
    });

    test("passes when only the company name mirror is filled — the id is legitimately optional", () => {
      // Round-2 review (TWO-25326 §7.4): fillCompanyData() above documents
      // that the id may be legitimately absent (the search response is
      // allowed to omit the national identifier). Requiring both fields
      // here would re-block exactly the buyers that documented allowance
      // exists to unblock.
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");
      root.querySelector("#company_name").value = "Acme Ltd";

      expect(form.hasRequiredCompanyCapture(root)).toBe(true);
    });

    test("blocks when only the company id mirror is filled", () => {
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");
      root.querySelector("#company_id").value = "123456";

      expect(form.hasRequiredCompanyCapture(root)).toBe(false);
    });

    test("passes once both mirrors carry a captured company", () => {
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");
      root.querySelector("#company_name").value = "Acme Ltd";
      root.querySelector("#company_id").value = "123456";

      expect(form.hasRequiredCompanyCapture(root)).toBe(true);
    });

    test("a blank (whitespace-only) mirror value still blocks", () => {
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");
      root.querySelector("#company_name").value = "   ";
      root.querySelector("#company_id").value = "123456";

      expect(form.hasRequiredCompanyCapture(root)).toBe(false);
    });

    test("dispatches a visible error message when it blocks", () => {
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");

      form.hasRequiredCompanyCapture(root);

      expect(env.messages.length).toBeGreaterThan(0);
      const flattened = env.messages.reduce(
        (acc, payload) => acc.concat(payload),
        [],
      );
      expect(flattened.some((m) => m.type === "error")).toBe(true);
    });

    test("does not dispatch a message when it passes", () => {
      const form = mountForm(env, ADDRESS_AREA);
      const root = document.getElementById("two_payment_form");
      root.querySelector("#company_name").value = "Acme Ltd";
      root.querySelector("#company_id").value = "123456";

      form.hasRequiredCompanyCapture(root);

      expect(env.messages.length).toBe(0);
    });
  });

  describe("payment-tile configuration (tile owns the one control)", () => {
    test("is a no-op pass — hyva.formValidation() already covers this path", () => {
      const form = mountForm(env, PAYMENT_TILE);
      const root = document.getElementById("two_payment_form");

      // Deliberately not filling anything: the tile's own required inputs
      // are what would fail native validation on this configuration, not
      // this check, which returns true unconditionally here.
      expect(form.hasRequiredCompanyCapture(root)).toBe(true);
      expect(env.messages.length).toBe(0);
    });
  });
});
