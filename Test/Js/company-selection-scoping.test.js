/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. What scopes the `shipping_company_selection` browser-storage key.
 *
 * The key is a single global with no quote, store or checkout suffix, and both
 * of the things that clear it used to compare QUOTE ids only. A buyer who
 * visited another store view kept the same quote by design, so neither clearer
 * ever fired: the company chosen in the other checkout, and any `manual_mode:
 * true` set there, survived for the whole quote.
 *
 * A second bug kept it that way. The payment step's restore path rewrote the
 * blob as a two-key object, dropping `quote_id` — and its clearer requires both
 * quote ids to be non-empty, so one page load through there disarmed the
 * new-order clear permanently.
 *
 * Test/Js/README.md previously listed initShippingCompanyStorage()'s
 * new-session detection as out of scope. This file is that scope.
 */

"use strict";

const H = require("./hyva-harness");

describe("company-selection storage scoping", () => {
  let env;

  beforeEach(() => {
    // The payment template's second DOMContentLoaded listener polls for
    // Magewire on a 100ms setTimeout; fake timers keep that off the clock.
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
  });

  afterEach(() => {
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  /**
   * @param {Object} data
   * @returns {void}
   */
  function seed(data) {
    env.browserStorage.setItem(
      "shipping_company_selection",
      JSON.stringify(data),
    );
  }

  /** @returns {Object} */
  function stored() {
    return JSON.parse(
      env.browserStorage.getItem("shipping_company_selection") || "{}",
    );
  }

  /**
   * A selection made in another checkout, still sitting in storage.
   *
   * @param {string} storeId the store view it was made in
   * @returns {Object}
   */
  function selectionFromStore(storeId) {
    return {
      quote_id: "test-quote-1",
      store_id: storeId,
      company_name: "Example Trading Ltd",
      company_id: "12345678",
      manual_mode: true,
    };
  }

  // The harness renders `store_id: "1"` as the current store view, matching
  // QUOTE_JSON and the `$currentStoreId` rule.
  const CURRENT_STORE = "1";
  const OTHER_STORE = "7";

  describe("the shipping step (initShippingCompanyStorage)", () => {
    /**
     * Load the shipping-step template and fire the event its initializer
     * listens for.
     *
     * @returns {void}
     */
    function run() {
      H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
      env.fireAlpineInit();
    }

    test("a store-view excursion on the SAME quote clears the selection", () => {
      seed(selectionFromStore(OTHER_STORE));

      run();

      // The leak: quote-only comparison never fired here, so the other
      // checkout's company AND its manual_mode came through.
      expect(stored().company_name).toBe("");
      expect(stored().company_id).toBe("");
      expect(stored().manual_mode).toBe(false);
      expect(stored().store_id).toBe(CURRENT_STORE);
      expect(stored().quote_id).toBe("test-quote-1");
    });

    test("staying in the same store view on the same quote keeps it", () => {
      seed(selectionFromStore(CURRENT_STORE));

      run();

      expect(stored().company_name).toBe("Example Trading Ltd");
      expect(stored().company_id).toBe("12345678");
      expect(stored().manual_mode).toBe(true);
    });

    test("a new quote still clears, as it always did", () => {
      seed({
        quote_id: "an-older-quote",
        store_id: CURRENT_STORE,
        company_name: "Example Trading Ltd",
        company_id: "12345678",
      });

      run();

      expect(stored().company_name).toBe("");
      expect(stored().quote_id).toBe("test-quote-1");
    });

    test("a blob written before store scoping is armed, not wiped", () => {
      // A missing store id is not evidence of an excursion. Treating it as one
      // would throw away a live selection under a buyer mid-checkout, once.
      seed({
        quote_id: "test-quote-1",
        company_name: "Example Trading Ltd",
        company_id: "12345678",
      });

      run();

      expect(stored().company_name).toBe("Example Trading Ltd");
      expect(stored().store_id).toBe(CURRENT_STORE);
    });
  });

  describe("the payment step (company-name-payment.phtml)", () => {
    /**
     * Load the payment-fields template and fire DOMContentLoaded, which jsdom
     * has already dispatched by the time the template is evaluated.
     *
     * @returns {void}
     */
    function run() {
      H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    }

    test("a store-view excursion on the SAME quote clears the selection", () => {
      seed(selectionFromStore(OTHER_STORE));
      env.browserStorage.setItem(
        "already_saved_company_details",
        JSON.stringify({ company_name: "Example Trading Ltd" }),
      );

      run();

      expect(stored().company_name).toBe("");
      expect(stored().manual_mode).toBe(false);
      expect(stored().store_id).toBe(CURRENT_STORE);
      expect(
        JSON.parse(env.browserStorage.getItem("already_saved_company_details")),
      ).toEqual({});
    });

    test("staying in the same store view keeps the selection", () => {
      seed(selectionFromStore(CURRENT_STORE));

      run();

      expect(stored().company_name).toBe("Example Trading Ltd");
      expect(stored().manual_mode).toBe(true);
    });

    describe("restoring a backend-persisted shipping company", () => {
      beforeEach(() => {
        document.body.innerHTML = [
          '<input type="hidden" id="shipping-company" value="Example Trading Ltd" />',
          '<input type="hidden" id="shipping-company_id" value="12345678" />',
          '<div x-data="stub">',
          '  <input type="text" data-name="company_name" value="" />',
          '  <input type="text" data-name="company_id" value="" />',
          "</div>",
        ].join("\n");
      });

      test("keeps the ids the two clearers depend on, and the mode", () => {
        // No company in storage, so the restore path runs off the hidden
        // fields the backend rendered.
        seed({
          quote_id: "test-quote-1",
          store_id: CURRENT_STORE,
          manual_mode: true,
        });

        run();

        expect(stored().company_name).toBe("Example Trading Ltd");
        expect(stored().company_id).toBe("12345678");
        // Dropping either of these disarmed the corresponding clearer for the
        // rest of the quote — the reason the leak was permanent.
        expect(stored().quote_id).toBe("test-quote-1");
        expect(stored().store_id).toBe(CURRENT_STORE);
        // And a reload must not throw a buyer mid-manual-entry back to search.
        expect(stored().manual_mode).toBe(true);
      });
    });
  });
});
