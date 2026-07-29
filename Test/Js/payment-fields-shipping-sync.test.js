/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25253. `company-name-payment.phtml` — the bridge that copies the shipping
 * step's company selection onto the payment tile.
 *
 * This is the other half of the identifier guard, and the half that submits an
 * order. `national_identifier` is optional in the search response, so a shipping
 * selection can legitimately carry an empty identifier. The bridge used to
 * require both a name AND an identifier before syncing anything, so such a
 * selection was skipped entirely: the payment tile kept the PREVIOUS company's
 * name and identifier, nothing prompted the buyer to re-enter anything, and
 * place-order submitted company A while the buyer had selected company B.
 *
 * It also disabled `#company_id` on every sync — `disabled = false; value = …;
 * disabled = true` plus a grey background — and never reversed it, so the
 * declarative `:disabled` state in the Alpine component could not win. That
 * imperative lock is gone; these tests are what stops it coming back.
 *
 * Own file rather than an addition to payment-company-selection.test.js: this
 * template registers top-level `window` listeners that cannot be removed, and
 * that file's own listener leak is documented in Test/Js/README.md.
 */

"use strict";

const H = require("./hyva-harness");

describe("shipping to payment company sync", () => {
  let env;
  let syncedEvents;

  // The template is evaluated ONCE. Its `shipping-company-selected` listener is
  // anonymous and registered on `window`, so a per-test load would leave one
  // handler per preceding test firing on every dispatch.
  beforeAll(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
  });

  afterAll(() => {
    env.restore();
  });

  beforeEach(() => {
    // `x-data` on the wrapper because updatePaymentFields() reaches the Alpine
    // component with `closest('[x-data]')`. No `disabled` attribute on
    // `#company_id`: the point of this file is that the sync must not add one.
    document.body.innerHTML = [
      '<div id="payment-root" x-data="twoGatewayHyvaPaymentMethodBase">',
      '  <input type="text" id="company_name" data-name="company_name" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" value="" />',
      "</div>",
    ].join("\n");

    env.browserStorage.removeItem("shipping_company_selection");
    env.browserStorage.removeItem("already_saved_company_details");

    syncedEvents = [];
    document
      .getElementById("payment-root")
      .addEventListener("update-company-data", (event) => {
        syncedEvents.push(event.detail);
      });
  });

  /**
   * Store a shipping selection and fire the event the shipping picker fires.
   *
   * @param {string} companyName
   * @param {string} companyId
   * @returns {void}
   */
  function selectShippingCompany(companyName, companyId) {
    env.browserStorage.setItem(
      "shipping_company_selection",
      JSON.stringify({
        quote_id: "test-quote-1",
        company_name: companyName,
        company_id: companyId,
        manual_mode: false,
      }),
    );
    window.dispatchEvent(new Event("shipping-company-selected"));
  }

  /** @returns {HTMLInputElement} */
  function companyIdInput() {
    return document.getElementById("company_id");
  }

  /** @returns {HTMLInputElement} */
  function companyNameInput() {
    return document.getElementById("company_name");
  }

  /** Mark Two as the active payment method, which arms the order-intent path. */
  function activateTwoPayment() {
    const option = document.createElement("input");
    option.type = "radio";
    option.name = "payment-method-option";
    option.value = "two_payment";
    option.checked = true;
    document.body.appendChild(option);
  }

  test("syncs a company whose identifier the response omitted", () => {
    selectShippingCompany("Example Trading Ltd", "");

    expect(companyNameInput().value).toBe("Example Trading Ltd");
    expect(companyIdInput().value).toBe("");
    expect(syncedEvents).toEqual([
      { companyName: "Example Trading Ltd", companyId: "" },
    ]);
  });

  test("overwrites the previous company rather than leaving it in place", () => {
    // The wrong-data path: without this, place-order submits the first
    // company's name and identifier for a buyer who selected the second.
    selectShippingCompany("Example Trading Ltd", "12345678");
    expect(companyIdInput().value).toBe("12345678");

    selectShippingCompany("Other Example Ltd", "");

    expect(companyNameInput().value).toBe("Other Example Ltd");
    expect(companyIdInput().value).toBe("");
    expect(syncedEvents[syncedEvents.length - 1]).toEqual({
      companyName: "Other Example Ltd",
      companyId: "",
    });
  });

  test("never disables the company-number field itself", () => {
    // The blocker: this function used to disable the field on every sync and
    // never re-enable it, so an identifier-less selection landed in a required
    // field that was empty AND uneditable. The locked state belongs to the
    // Alpine component's `companyIdDisabled` alone.
    selectShippingCompany("Example Trading Ltd", "12345678");
    expect(companyIdInput().disabled).toBe(false);

    selectShippingCompany("Other Example Ltd", "");

    expect(companyIdInput().disabled).toBe(false);
  });

  test("does not grey the field out imperatively", () => {
    // The grey belongs to `input.company_id:disabled` in custom.css, so that it
    // cannot get out of step with the disabled state it is supposed to signal.
    selectShippingCompany("Example Trading Ltd", "12345678");

    expect(companyIdInput().style.backgroundColor).toBe("");
  });

  test("still skips a selection with no company name at all", () => {
    // Relaxing the gate is about the IDENTIFIER being optional. An empty name
    // is not a selection, and syncing it would blank the payment tile.
    selectShippingCompany("Example Trading Ltd", "12345678");

    selectShippingCompany("", "");

    expect(companyNameInput().value).toBe("Example Trading Ltd");
    expect(companyIdInput().value).toBe("12345678");
    expect(syncedEvents).toHaveLength(1);
  });

  test("dispatches an order intent for an identified company", () => {
    activateTwoPayment();
    const dispatched = [];
    const listener = () => dispatched.push("intent");
    window.addEventListener("dispatch-order-intent", listener);

    try {
      selectShippingCompany("Example Trading Ltd", "12345678");
      expect(dispatched).toEqual(["intent"]);
    } finally {
      window.removeEventListener("dispatch-order-intent", listener);
    }
  });

  test("dispatches no order intent when there is no identifier", () => {
    // The identifier is part of the intent request, so an empty one dispatches
    // nothing — matching fillCompanyData()'s own `companyId &&` term. Relaxing
    // the sync gate without this would have started firing intents the listener
    // discards, which still read as real submissions in the event log.
    activateTwoPayment();
    const dispatched = [];
    const listener = () => dispatched.push("intent");
    window.addEventListener("dispatch-order-intent", listener);

    try {
      selectShippingCompany("Example Trading Ltd", "");
      expect(dispatched).toEqual([]);
      // …but the fields were still synced.
      expect(companyNameInput().value).toBe("Example Trading Ltd");
    } finally {
      window.removeEventListener("dispatch-order-intent", listener);
    }
  });

  test("does not sync when billing is not the same as shipping", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "billing-as-shipping";
    checkbox.checked = false;
    document.body.appendChild(checkbox);

    selectShippingCompany("Example Trading Ltd", "");

    expect(companyNameInput().value).toBe("");
    expect(syncedEvents).toEqual([]);
  });
});
