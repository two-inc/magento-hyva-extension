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

  describe("selecting a company keeps the scope the initialisers set", () => {
    // Every selectItem() used to rebuild the blob from an explicit key list
    // carrying `quote_id` and nothing else, so one selection — the normal path —
    // dropped `store_id`. The arming branch then re-stamped the blob with the
    // CURRENT store, making the next excursion undetectable: the leak survived
    // its own fix. All three surfaces now merge into the existing blob.
    const SCOPED = {
      quote_id: "test-quote-1",
      store_id: CURRENT_STORE,
      company_name: "",
      company_id: "",
      manual_mode: false,
    };

    /**
     * A dropdown row in the shape all three pickers pass to selectItem().
     *
     * @returns {Object}
     */
    function pick() {
      return {
        companyName: "Example Trading Ltd",
        companyDisplayName: "Example Trading Ltd",
        companyId: "12345678",
        lookupId: "",
      };
    }

    /**
     * @param {string} template
     * @param {string} componentName
     * @returns {Object}
     */
    function mount(template, componentName) {
      H.loadSharedHelpers();
      if (template !== H.GATEWAY_METHOD_TEMPLATE) H.loadTemplate(template);
      env.fireAlpineInit();
      const root = document.getElementById("scope-root");
      const mounted = H.mountComponent(env.alpineComponents[componentName], {
        el: root,
        root: root,
      });
      mounted.$watch = function () {};
      return mounted;
    }

    beforeEach(() => {
      document.body.innerHTML = [
        '<div id="scope-root">',
        '  <input type="text" id="company_name" value="" />',
        '  <input type="text" id="company_id" value="" disabled />',
        '  <input type="hidden" id="shipping-company" value="" />',
        '  <input type="hidden" id="shipping-company_id" value="" />',
        "</div>",
      ].join("\n");
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    test("the payment tile preserves store_id", () => {
      seed(SCOPED);
      const component = mount(
        H.GATEWAY_METHOD_TEMPLATE,
        "twoGatewayHyvaPaymentMethodBase",
      );
      component.initialize(JSON.parse(H.QUOTE_JSON));

      component.selectItem(pick());

      expect(stored().store_id).toBe(CURRENT_STORE);
      expect(stored().quote_id).toBe("test-quote-1");
      expect(stored().company_name).toBe("Example Trading Ltd");
    });

    test("the address picker preserves store_id", () => {
      seed(SCOPED);
      const component = mount(
        H.COMPANY_NAME_TEMPLATE,
        "twoGatewayHyvaCompanySearchField",
      );
      component.init();

      component.selectItem(pick());

      expect(stored().store_id).toBe(CURRENT_STORE);
      expect(stored().quote_id).toBe("test-quote-1");
    });

    test("the shipping-step picker preserves store_id", () => {
      seed(SCOPED);
      const component = mount(H.SHIPPING_COMPANY_TEMPLATE, "searchInput");

      component.selectItem(pick());

      expect(stored().store_id).toBe(CURRENT_STORE);
      expect(stored().quote_id).toBe("test-quote-1");
      expect(document.getElementById("shipping-company").value).toBe(
        "Example Trading Ltd",
      );
    });

    test("and a store excursion after a selection still clears", () => {
      seed(Object.assign({}, SCOPED, { store_id: CURRENT_STORE }));
      const component = mount(
        H.GATEWAY_METHOD_TEMPLATE,
        "twoGatewayHyvaPaymentMethodBase",
      );
      component.initialize(JSON.parse(H.QUOTE_JSON));
      component.selectItem(pick());

      // Now the buyer is in the OTHER store view, same quote. Simulated by
      // rewriting the stored store id, since the current one comes from PHP.
      const afterSelect = stored();
      afterSelect.store_id = OTHER_STORE;
      seed(afterSelect);

      H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
      env.fireAlpineInit();

      expect(stored().company_name).toBe("");
      expect(stored().store_id).toBe(CURRENT_STORE);
    });
  });

  describe("a manual_mode left in storage by the address form", () => {
    // The payment tile must not restore it. An order cannot be placed without a
    // company id — the sole-trader flow mints a synthetic one — and placement
    // credit-checks whatever id is submitted, so manual company entry is only
    // meaningful on a checkout NOT using this payment method. Restoring the flag
    // gave the tile a live-looking search box whose every keystroke returned
    // early at the `manualMode` guard: no request, no spinner, no dropdown, and
    // no way back, because the tile has no binding for enableSearch().
    let fetchStub;

    beforeEach(() => {
      document.body.innerHTML = [
        '<div id="tile-root">',
        '  <input type="text" id="company_name" value="" />',
        '  <input type="text" id="company_id" value="" disabled />',
        "</div>",
      ].join("\n");
      jest.useFakeTimers();
      fetchStub = H.stubFetch();
      jest.spyOn(console, "error").mockImplementation(() => {});
      H.loadSharedHelpers();
      env.fireAlpineInit();
    });

    afterEach(() => {
      fetchStub.restore();
      jest.useRealTimers();
    });

    test("leaves the tile able to search", async () => {
      seed({
        quote_id: "test-quote-1",
        store_id: CURRENT_STORE,
        company_name: "",
        company_id: "",
        manual_mode: true,
      });

      const input = document.getElementById("company_name");
      const component = H.mountComponent(
        env.alpineComponents.twoGatewayHyvaPaymentMethodBase,
        { el: input, root: document.getElementById("tile-root") },
      );
      component.$watch = function () {};
      component.initialize(JSON.parse(H.QUOTE_JSON));

      expect(component.manualMode).toBe(false);

      input.value = "Exa";
      component.getItems();
      await H.flushPromises();

      // A request actually on the wire is the whole assertion: with the flag
      // restored, getItems() returned at the guard and nothing happened at all.
      expect(fetchStub.calls.length).toBe(1);
      expect(component.isSearching).toBe(true);
    });
  });
});
