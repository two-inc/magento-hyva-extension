/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. What scopes the company-selection browser-storage key.
 *
 * It used to be one global `shipping_company_selection` shared by every store
 * view, and both of the things that clear it compare QUOTE ids only. The quote
 * is shared across store views by design, so a buyer who switched store view —
 * typically a language toggle — kept the same quote, no comparison fired, and
 * the company chosen in the other checkout (plus any `manual_mode: true` set
 * there) survived for the whole quote.
 *
 * The fix is scope, not clearing: the key is now
 * `shipping_company_selection:<store_id>`. A store excursion is a DIFFERENT KEY,
 * so the other store view's selection is simply invisible and is left entirely
 * alone — nothing to detect, nothing to wipe, and a language toggle destroys
 * nothing. `store_id` is consequently NOT a field inside the blob any more; the
 * key carries it, and a test asserting on such a field would be asserting on
 * dead weight.
 *
 * A second bug used to keep the leak permanent: the payment step's restore path
 * rewrote the blob as a two-key object, dropping `quote_id` — and both clearers
 * require both quote ids to be non-empty, so one page load through there
 * disarmed the new-order clear for the rest of the quote. Every writer now
 * MERGES, through window.twoGatewayWriteCompanySelection().
 *
 * Test/Js/README.md previously listed initShippingCompanyStorage()'s
 * new-session detection as out of scope. This file is that scope.
 *
 * Every test here uses the same CURRENT quote id, `test-quote-1`.
 * `initShippingCompanyStorage()` registers an `alpine:init` listener the harness
 * cannot remove, so listeners accumulate across tests within a file and a test
 * whose current quote differed from its neighbours' would have its seed cleared
 * by theirs. The numeric-quote-id cases live in
 * Test/Js/quote-id-normalisation.test.js for exactly that reason.
 */

"use strict";

const H = require("./hyva-harness");

describe("company-selection storage scoping", () => {
  let env;

  // The current store view's key, built by the harness from the same
  // `$currentStoreId` rule the templates render — never spelled out as a
  // literal here, so the suffix cannot drift from that rule.
  const CURRENT_STORE_KEY = H.COMPANY_SELECTION_KEY;
  // Another store view's key. Nothing under test may read or write it.
  const OTHER_STORE_KEY = "shipping_company_selection:7";
  // The pre-scoping global key, retired on first read.
  const LEGACY_KEY = "shipping_company_selection";

  const CURRENT_QUOTE = "test-quote-1";

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
   * Write a blob under an arbitrary key, returning the exact string stored.
   *
   * The string comes back so a test can compare another store view's slot BYTE
   * FOR BYTE: a re-parsed comparison would hide a rewrite that happened to
   * round-trip to an equal object, and a write into another store's slot is the
   * defect whether or not the value changed.
   *
   * @param {string} key
   * @param {Object} data
   * @returns {string} the JSON as written
   */
  function seedKey(key, data) {
    const json = JSON.stringify(data);
    env.browserStorage.setItem(key, json);
    return json;
  }

  /**
   * @param {Object} data
   * @returns {string} the JSON as written
   */
  function seed(data) {
    return seedKey(CURRENT_STORE_KEY, data);
  }

  /** @returns {Object} the current store view's blob */
  function stored() {
    return JSON.parse(env.browserStorage.getItem(CURRENT_STORE_KEY) || "{}");
  }

  /**
   * A company selection in the shape the three pickers write.
   *
   * No `store_id` field — the key carries the store view now.
   *
   * @param {string} quoteId
   * @returns {Object}
   */
  function selection(quoteId) {
    return {
      quote_id: quoteId,
      company_name: "Example Trading Ltd",
      company_id: "12345678",
      manual_mode: true,
    };
  }

  /**
   * Assert this store view's blob carries nothing out of another key's.
   *
   * Keyed on absence of the PROPERTY rather than on an empty string, because a
   * cleared selection and an adopted-then-cleared one look identical by value
   * and only one of them means a foreign key was read. A `quote_id` stamped by
   * the initialiser is expected and is not "from" the foreign key.
   *
   * @returns {void}
   */
  function expectNothingAdopted() {
    const blob = stored();
    expect(Object.prototype.hasOwnProperty.call(blob, "company_name")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(blob, "company_id")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(blob, "manual_mode")).toBe(
      false,
    );
  }

  /**
   * The cases both initialisers must satisfy identically.
   *
   * The two clearers are the same shape on purpose — the shipping-step template
   * is behind the company-search config flag, so on a store with that flag OFF
   * the payment step's is the only clearer there is. Running one table against
   * both is what stops them diverging.
   *
   * @param {Function} run loads publisher + template and fires the ready event
   * @returns {void}
   */
  function describeInitialiser(run) {
    test("a new quote clears this store view's selection", () => {
      seed(selection("an-older-quote"));

      run();

      expect(stored().company_name).toBe("");
      expect(stored().company_id).toBe("");
      expect(stored().manual_mode).toBe(false);
      expect(stored().quote_id).toBe(CURRENT_QUOTE);
    });

    test("the same quote keeps it, mode and all", () => {
      seed(selection(CURRENT_QUOTE));

      run();

      expect(stored().company_name).toBe("Example Trading Ltd");
      expect(stored().company_id).toBe("12345678");
      expect(stored().manual_mode).toBe(true);
    });

    test("a blob with no quote id is stamped, not wiped", () => {
      // A blob from an older tab, or written before the id was stored at all.
      // Wiping it would throw away a live selection under a buyer mid-checkout;
      // leaving it UNSTAMPED would keep the new-quote comparison above disarmed
      // for the rest of the quote, which is what made the original leak
      // permanent once a partial write had dropped the id.
      seed({
        company_name: "Example Trading Ltd",
        company_id: "12345678",
      });

      run();

      expect(stored().company_name).toBe("Example Trading Ltd");
      expect(stored().company_id).toBe("12345678");
      expect(stored().quote_id).toBe(CURRENT_QUOTE);
    });

    test("another store view's selection is neither read nor touched", () => {
      // THE central case, and the whole reason the store-view CLEARING this
      // file used to assert no longer exists. Store 7's selection must be
      // invisible to a store-1 page load and must come out of it unmodified, so
      // that toggling language and coming back destroys nothing.
      const untouched = seedKey(OTHER_STORE_KEY, selection(CURRENT_QUOTE));

      run();

      expect(env.browserStorage.getItem(OTHER_STORE_KEY)).toBe(untouched);
      // …and nothing of it bled into this store view. Adoption would be the
      // very cross-store leak the scoping removes, merely relocated.
      expectNothingAdopted();
    });

    test("the pre-scoping global key is dropped, not adopted", () => {
      // Adopting it would reproduce the cross-store leak exactly once for every
      // buyer mid-checkout at deploy time — precisely the population whose blob
      // could have been written in either store view, so there is no way to
      // tell a safe one from a leaked one. Dropping it costs them one re-pick
      // from a dropdown that works, which is the cheaper failure. Retired on
      // FIRST read so no later consumer can adopt it either.
      seedKey(LEGACY_KEY, selection(CURRENT_QUOTE));

      run();

      expect(env.browserStorage.getItem(LEGACY_KEY)).toBeNull();
      expectNothingAdopted();
    });
  }

  describe("the shipping step (initShippingCompanyStorage)", () => {
    describeInitialiser(function run() {
      // The publisher FIRST. Both accessors are resolved into locals behind a
      // `function(){ return {}; }` fallback, so a page missing
      // gateway_method-csp-js.phtml degrades instead of throwing inside the
      // very `alpine:init` handler that registers the picker. In a test that
      // fallback reads `{}` and writes nowhere — so skipping the publisher
      // would let every case above pass without one comparison having happened.
      // A real checkout always renders it.
      H.loadSharedHelpers();
      H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
      env.fireAlpineInit();
    });
  });

  describe("the payment step (company-name-payment.phtml)", () => {
    /**
     * Load publisher + payment template and fire DOMContentLoaded, which jsdom
     * has already dispatched by the time the template is evaluated.
     *
     * @returns {void}
     */
    function run() {
      H.loadSharedHelpers();
      H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    }

    describeInitialiser(run);

    describe("the BILLING record's own new-order clear (TWO-25326)", () => {
      // The billing key is a second store with the same lifetime problem as the
      // first. Without its own clear, a company named on one order's payment
      // step comes back on the NEXT order as a captured read-only label, for a
      // buyer who never chose it and cannot see where it came from.

      test("a billing record from a previous quote is REMOVED", () => {
        seedKey(H.BILLING_COMPANY_KEY, {
          quote_id: "some-previous-quote",
          company_name: "Last Order's Company Ltd",
          company_id: "55556666",
        });

        run();

        // Removed, not blanked: the tile's fallback-to-shipping keys on the
        // record being absent, so a blank one would suppress it all checkout.
        expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).toBeNull();
      });

      test("a billing record for THIS quote survives untouched", () => {
        const kept = seedKey(H.BILLING_COMPANY_KEY, {
          quote_id: CURRENT_QUOTE,
          company_name: "This Order's Company Ltd",
          company_id: "11112222",
        });

        run();

        expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).toBe(kept);
      });

      test("an unstamped billing record is stamped rather than dropped", () => {
        seedKey(H.BILLING_COMPANY_KEY, {
          company_name: "Unstamped Company Ltd",
          company_id: "33334444",
        });

        run();

        const billing = JSON.parse(
          env.browserStorage.getItem(H.BILLING_COMPANY_KEY) || "{}",
        );
        expect(billing.quote_id).toBe(CURRENT_QUOTE);
        expect(billing.company_name).toBe("Unstamped Company Ltd");
      });

      test("no billing record is not created by the clear", () => {
        run();

        expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).toBeNull();
      });
    });

    describe("restoring a backend-persisted shipping company", () => {
      beforeEach(() => {
        // Publisher before the DOM, and that order is load-bearing. Each
        // preceding test in this describe left a MutationObserver watching
        // `document.body` — the template installs one and nothing can remove
        // it — and those stale observers fire on the very next mutation, which
        // is this line. They call the accessor by name off `window`, so with the
        // globals still torn down by the previous test's `restore()` they throw
        // out of an observer callback, failing this test for something that has
        // nothing to do with it.
        H.loadSharedHelpers();
        document.body.innerHTML = [
          '<input type="hidden" id="shipping-company" value="Example Trading Ltd" />',
          '<input type="hidden" id="shipping-company_id" value="12345678" />',
          '<div x-data="stub">',
          '  <input type="text" data-name="company_name" value="" />',
          '  <input type="text" data-name="company_id" value="" />',
          "</div>",
        ].join("\n");
      });

      test("keeps the quote id the clearers depend on, and the mode", () => {
        // No company in storage, so the restore path runs off the hidden fields
        // the backend rendered. It used to substitute a two-key object for the
        // whole blob: that dropped `quote_id`, disarming the new-quote clear for
        // the rest of the quote, and dropped `manual_mode`, throwing a buyer
        // mid-manual-entry on the ADDRESS form back into search mode on reload.
        seed({
          quote_id: CURRENT_QUOTE,
          manual_mode: true,
        });

        run();

        expect(stored().company_name).toBe("Example Trading Ltd");
        expect(stored().company_id).toBe("12345678");
        expect(stored().quote_id).toBe(CURRENT_QUOTE);
        expect(stored().manual_mode).toBe(true);
      });
    });
  });

  describe("selecting a company preserves the blob it merges into", () => {
    // Every selectItem() used to rebuild the blob from an explicit key list, so
    // one selection — the ordinary path — dropped whatever the list did not
    // name. `quote_id` was the casualty that mattered: without it the
    // initialisers' new-quote comparison stays disarmed and the PREVIOUS
    // order's company survives into the next one. All three surfaces now merge.
    const SEEDED = {
      quote_id: CURRENT_QUOTE,
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

    test("the payment tile merges rather than rebuilds — into the BILLING key", () => {
      // Re-pointed by TWO-25326: the tile writes its own billing-scoped record
      // now, because the checkout can hold two different companies at once. The
      // merge-not-rebuild property being asserted is unchanged, and still the
      // thing that keeps `quote_id` alive for the new-order clear.
      seedKey(H.BILLING_COMPANY_KEY, { quote_id: CURRENT_QUOTE });
      seed(SEEDED);
      const shippingBefore = env.browserStorage.getItem(CURRENT_STORE_KEY);
      const component = mount(
        H.GATEWAY_METHOD_TEMPLATE,
        "twoGatewayHyvaPaymentMethodBase",
      );
      component.initialize(JSON.parse(H.QUOTE_JSON));

      component.selectItem(pick());

      const billing = JSON.parse(
        env.browserStorage.getItem(H.BILLING_COMPANY_KEY) || "{}",
      );
      expect(billing.quote_id).toBe(CURRENT_QUOTE);
      expect(billing.company_name).toBe("Example Trading Ltd");
      // And the shipping slot is byte-for-byte untouched by a tile write.
      expect(env.browserStorage.getItem(CURRENT_STORE_KEY)).toBe(shippingBefore);
    });

    test("the address picker merges rather than rebuilds", () => {
      seed(SEEDED);
      const component = mount(
        H.COMPANY_NAME_TEMPLATE,
        "twoGatewayHyvaCompanySearchField",
      );
      component.init();

      component.selectItem(pick());

      expect(stored().quote_id).toBe(CURRENT_QUOTE);
      expect(stored().company_name).toBe("Example Trading Ltd");
    });

    test("the shipping-step picker merges rather than rebuilds", () => {
      seed(SEEDED);
      const component = mount(H.SHIPPING_COMPANY_TEMPLATE, "searchInput");

      component.selectItem(pick());

      expect(stored().quote_id).toBe(CURRENT_QUOTE);
      expect(stored().company_name).toBe("Example Trading Ltd");
      expect(document.getElementById("shipping-company").value).toBe(
        "Example Trading Ltd",
      );
    });

    test("and a selection stays inside this store view's key", () => {
      // The write half of the central case. A picker merges through the same
      // accessor it reads through, so the key built once per page is the only
      // thing between a selection and another store view's slot.
      const untouched = seedKey(OTHER_STORE_KEY, selection(CURRENT_QUOTE));
      seed(SEEDED);
      const component = mount(H.SHIPPING_COMPANY_TEMPLATE, "searchInput");

      component.selectItem(pick());

      expect(env.browserStorage.getItem(OTHER_STORE_KEY)).toBe(untouched);
      expect(stored().company_name).toBe("Example Trading Ltd");
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
        quote_id: CURRENT_QUOTE,
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

      // A request actually on the wire is the whole assertion. With the flag
      // restored, getItems() returned at the guard and NOTHING happened — no
      // error, no state change, nothing else that could tell "search works"
      // apart from "search silently declines".
      expect(fetchStub.calls.length).toBe(1);
      expect(component.isSearching).toBe(true);
    });
  });
});
