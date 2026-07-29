/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. Browser storage being unusable must not kill the checkout step.
 *
 * The company-selection accessors run inside the `alpine:init` and
 * `DOMContentLoaded` handlers that go on to call `Alpine.data()` and to start the
 * payment-form MutationObserver. Anything that throws in them takes those
 * registrations with it, and the buyer is left with a checkout step that renders
 * and does nothing — the same shape as an inline block the CSP refuses.
 *
 * This is not hypothetical. An earlier revision of the read accessor guarded only
 * its `JSON.parse`, leaving `getBrowserStorage()`, `getItem` and `removeItem`
 * outside the try — and a throwing storage stub left `searchInput` unregistered.
 * Storage throws for real reasons: disabled in browser settings, private-browsing
 * quotas, and embedded webviews.
 *
 * Its own file because `initShippingCompanyStorage()` registers an `alpine:init`
 * listener the harness cannot remove, so listeners accumulate across tests in a
 * file and would fire against each other's storage stubs.
 */

"use strict";

const H = require("./hyva-harness");

describe("company selection when storage is unusable", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    env.restore();
    document.body.innerHTML = "";
  });

  /**
   * Load the publisher and the shipping step, then fire the event whose handler
   * both reads storage and registers the picker.
   *
   * @returns {void}
   */
  function bootShippingStep() {
    H.loadSharedHelpers();
    H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
    env.fireAlpineInit();
  }

  /** @returns {boolean} whether the shipping-step picker survived */
  function pickerRegistered() {
    return typeof env.alpineComponents.searchInput === "function";
  }

  test("a throwing getBrowserStorage() still leaves the picker registered", () => {
    env.hyva.getBrowserStorage = function () {
      throw new Error("storage is disabled");
    };

    bootShippingStep();

    expect(pickerRegistered()).toBe(true);
  });

  test("a throwing getItem() still leaves the picker registered", () => {
    env.hyva.getBrowserStorage = function () {
      return {
        getItem: function () {
          throw new Error("SecurityError");
        },
        setItem: function () {},
        removeItem: function () {},
      };
    };

    bootShippingStep();

    expect(pickerRegistered()).toBe(true);
  });

  test("a storage with no removeItem still leaves the picker registered", () => {
    // The legacy-key purge calls removeItem. A storage shim without one is the
    // narrowest way to reach that specific line.
    env.browserStorage.setItem("shipping_company_selection", '{"a":1}');
    const partial = {
      getItem: env.browserStorage.getItem,
      setItem: env.browserStorage.setItem,
    };
    env.hyva.getBrowserStorage = function () {
      return partial;
    };

    bootShippingStep();

    expect(pickerRegistered()).toBe(true);
  });

  describe("the payment step's DOMContentLoaded handler", () => {
    /**
     * Boot the payment-fields template the way the page does.
     *
     * @returns {void}
     */
    function bootPaymentStep() {
      H.loadSharedHelpers();
      H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    }

    test("starts the payment-form observer even when storage throws", () => {
      // The handler used to touch a second storage key here — a write-only
      // "already saved" marker whose only reader assigned it to two variables
      // nothing used. It was unguarded, sitting between the clearer and
      // observeForPaymentForm(), so a throwing storage stopped the observer from
      // ever starting and the tile never synced the company. The key is deleted
      // rather than guarded; this case is what proves the handler survives.
      // The observer starting is asserted through its effect: a company-name
      // input added AFTER boot gets populated from the stored selection.
      document.body.innerHTML = "";
      let live = true;
      env.hyva.getBrowserStorage = function () {
        if (live) throw new Error("storage is disabled");
        return env.browserStorage;
      };

      expect(bootPaymentStep).not.toThrow();

      // Storage comes back and a selection exists; the observer must still be
      // watching for the payment form to appear.
      live = false;
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "12345678",
        }),
      );
      document.body.innerHTML = [
        '<div x-data="stub">',
        '  <input type="text" id="company_name" data-name="company_name" value="" />',
        '  <input type="text" id="company_id" data-name="company_id" value="" />',
        "</div>",
      ].join("\n");

      return new Promise(function (resolve) {
        setTimeout(function () {
          expect(document.getElementById("company_name").value).toBe(
            "Example Trading Ltd",
          );
          resolve();
        }, 0);
      });
    });
  });

  test("a stored primitive is not handed back as a selection", () => {
    // `|| {}` alone only rescues a FALSY parse, so `42` would flow out and
    // contradict the accessor's own contract.
    env.browserStorage.setItem(H.COMPANY_SELECTION_KEY, "42");

    H.loadSharedHelpers();

    expect(window.twoGatewayReadCompanySelection()).toEqual({});
  });

  describe("when the store view cannot be resolved", () => {
    // GetQuoteDetails::getCurrentStoreId() returns '' if the store manager
    // cannot answer. The key must NOT become `shipping_company_selection:` — a
    // store-less bucket every store view would share is the cross-store leak
    // this keying exists to remove.
    const NO_STORE = [[/^\$currentStoreId$/, ""]];

    test("no bucket is shared: reads answer empty and writes are dropped", () => {
      H.loadSharedHelpers(NO_STORE);

      expect(window.TWO_GATEWAY_COMPANY_SELECTION_KEY).toBe("");

      window.twoGatewayWriteCompanySelection({ company_name: "Example Ltd" });

      expect(window.twoGatewayReadCompanySelection()).toEqual({});
      expect(env.browserStorage.getItem("shipping_company_selection")).toBe(
        null,
      );
      expect(env.browserStorage.getItem("shipping_company_selection:")).toBe(
        null,
      );
      // And not under the empty key either: real localStorage accepts '' as a
      // key, so dropping the `if (key)` guard writes there rather than throwing.
      // Without this assertion the guard was a fourth, unpinned change.
      expect(env.browserStorage.getItem("")).toBe(null);
    });
  });
});
