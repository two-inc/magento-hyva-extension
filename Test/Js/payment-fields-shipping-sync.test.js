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
    // The publisher FIRST. This template reads and writes the company selection
    // only through `window.twoGatewayReadCompanySelection` /
    // `…WriteCompanySelection`, resolved once into a local with a
    // `function(){ return {}; }` fallback. That fallback is what keeps a page
    // missing the publisher from throwing — but in a test it also reads `{}` and
    // writes nowhere, so every assertion below would pass against a bridge that
    // never saw the seeded selection. A real checkout always renders
    // gateway_method-csp-js.phtml, so loading it here is the faithful page, not
    // a convenience.
    H.loadSharedHelpers();
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

    env.browserStorage.removeItem(H.COMPANY_SELECTION_KEY);

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
      H.COMPANY_SELECTION_KEY,
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
    //
    // The value assertions are load-bearing, not decoration: the fixture starts
    // undisabled, so a sync that did nothing at all would satisfy the `disabled`
    // expectations on its own. Pinning the value is what proves the sync ran and
    // still left the field alone.
    selectShippingCompany("Example Trading Ltd", "12345678");
    expect(companyIdInput().value).toBe("12345678");
    expect(companyIdInput().disabled).toBe(false);

    selectShippingCompany("Other Example Ltd", "");

    expect(companyIdInput().value).toBe("");
    expect(companyIdInput().disabled).toBe(false);
  });

  test("does not grey the field out imperatively", () => {
    // The grey belongs to `input.company_id:disabled` in custom.css, so that it
    // cannot get out of step with the disabled state it is supposed to signal.
    //
    // Same reason for the value assertion as the test above: the fixture's
    // `style` starts empty, so a no-op sync would pass without it.
    selectShippingCompany("Example Trading Ltd", "12345678");

    expect(companyIdInput().value).toBe("12345678");
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

  describe("the billing-as-shipping Magewire handler", () => {
    // Registered inside a `DOMContentLoaded` callback, behind a poll for the
    // `Magewire` global. jsdom has already fired DOMContentLoaded by the time
    // the template is evaluated, so the callback is driven by hand — and the
    // `Magewire` stub is installed BEFORE dispatching, because the else branch
    // arms a 100ms `setTimeout` retry loop that would otherwise run forever.
    //
    // Without this, the `billing_as_shipping_address_updated` gate was the one
    // change in this PR with no coverage at all: reverting it to
    // `shippingCompany && shippingCompanyId` left the whole suite green.
    let handler;

    beforeEach(() => {
      handler = null;
      global.Magewire = {
        on: (eventName, callback) => {
          if (eventName === "billing_as_shipping_address_updated") {
            handler = callback;
          }
        },
      };
      document.dispatchEvent(new Event("DOMContentLoaded"));
      if (typeof handler !== "function") {
        throw new Error(
          "the template did not register a billing_as_shipping_address_updated " +
            "handler — this throws rather than skipping, so a template change " +
            "cannot quietly reduce these tests to testing nothing",
        );
      }
    });

    afterEach(() => {
      delete global.Magewire;
    });

    /**
     * Store a shipping selection WITHOUT firing `shipping-company-selected`,
     * so only the Magewire handler under test can have moved the fields.
     *
     * @param {string} companyName
     * @param {string} companyId
     * @returns {void}
     */
    function storeShippingSelection(companyName, companyId) {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: companyName,
          company_id: companyId,
          manual_mode: false,
        }),
      );
    }

    test("syncs a shipping company whose identifier is empty", () => {
      // The RED for a revert to `shippingCompany && shippingCompanyId`: that
      // gate skips this sync entirely, so toggling "billing same as shipping"
      // back on leaves whatever the payment tile was already holding.
      storeShippingSelection("Other Example Ltd", "");

      handler({ billingAsShipping: true });

      expect(companyNameInput().value).toBe("Other Example Ltd");
      expect(companyIdInput().value).toBe("");
      expect(syncedEvents).toEqual([
        { companyName: "Other Example Ltd", companyId: "" },
      ]);
    });

    test("overwrites a previously synced identified company", () => {
      // The wrong-data path in full: company A is on the tile, the buyer's
      // shipping pick is identifier-less company B, and place-order must not
      // submit A's name or A's number.
      selectShippingCompany("Example Trading Ltd", "12345678");
      expect(companyIdInput().value).toBe("12345678");

      storeShippingSelection("Other Example Ltd", "");
      handler({ billingAsShipping: true });

      expect(companyNameInput().value).toBe("Other Example Ltd");
      expect(companyIdInput().value).toBe("");
    });

    test("syncs an identified shipping company too", () => {
      storeShippingSelection("Example Trading Ltd", "12345678");

      handler({ billingAsShipping: true });

      expect(companyNameInput().value).toBe("Example Trading Ltd");
      expect(companyIdInput().value).toBe("12345678");
    });

    test("still skips a stored selection with no company name", () => {
      // The relaxed gate is about the IDENTIFIER. An empty name is not a
      // selection and syncing it would blank the payment tile.
      selectShippingCompany("Example Trading Ltd", "12345678");

      storeShippingSelection("", "");
      handler({ billingAsShipping: true });

      expect(companyNameInput().value).toBe("Example Trading Ltd");
      expect(companyIdInput().value).toBe("12345678");
    });

    test("does nothing when billing is no longer the same as shipping", () => {
      storeShippingSelection("Other Example Ltd", "");

      handler({ billingAsShipping: false });

      expect(companyNameInput().value).toBe("");
      expect(syncedEvents).toEqual([]);
    });

    test("dispatches no order intent, identified or not", () => {
      // The handler passes `triggerOrderIntent = false` outright: this is a
      // billing-address toggle, not a company change.
      activateTwoPayment();
      const dispatched = [];
      const listener = () => dispatched.push("intent");
      window.addEventListener("dispatch-order-intent", listener);

      try {
        storeShippingSelection("Example Trading Ltd", "12345678");
        handler({ billingAsShipping: true });

        expect(companyIdInput().value).toBe("12345678");
        expect(dispatched).toEqual([]);
      } finally {
        window.removeEventListener("dispatch-order-intent", listener);
      }
    });
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

  describe("the checkout:payment:method-activate listener", () => {
    // TWO-25326 §7.4 round 2: this handler had its own, separate
    // `shippingCompany && shippingCompanyId` gate — a second recurrence of
    // the exact bug class the other handlers in this file were already
    // fixed against (see the module docblock above). Without this test,
    // reverting this one handler back to requiring both fields would leave
    // the whole suite green.
    function activateMethod() {
      window.dispatchEvent(
        new CustomEvent("checkout:payment:method-activate", {
          detail: { method: "two_payment" },
        }),
      );
    }

    test("syncs an id-less company on activation", () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "",
          manual_mode: false,
        }),
      );

      activateMethod();

      expect(companyNameInput().value).toBe("Example Trading Ltd");
      expect(companyIdInput().value).toBe("");
    });

    test("does not overwrite fields that are already populated", () => {
      companyNameInput().value = "Already Here Ltd";
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "12345678",
          manual_mode: false,
        }),
      );

      activateMethod();

      expect(companyNameInput().value).toBe("Already Here Ltd");
    });

    test("ignores activation of a different payment method", () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "",
          manual_mode: false,
        }),
      );

      window.dispatchEvent(
        new CustomEvent("checkout:payment:method-activate", {
          detail: { method: "some_other_method" },
        }),
      );

      expect(companyNameInput().value).toBe("");
    });
  });
});
