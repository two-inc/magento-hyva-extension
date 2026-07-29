/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. The payment tile's manual/search mode is ONE fact.
 *
 * It used to be two properties with no watcher between them — `manualMode`
 * (behaviour: `getItems()` refuses to search) and `showManual` (visibility:
 * which of the duplicated inputs is `x-show`n). `initialize()` restored only the
 * first from browser storage, and the address form writes `manual_mode: true`
 * into that same key, so the tile came up showing a live search box that could
 * not search — no request, no spinner, no dropdown — and its own two links wrote
 * only the display flag, so there was no way back.
 *
 * `showManual` is gone; the template binds `manualMode` / `!manualMode`. It was
 * briefly a `get showManual()` alias, which was wrong for a reason worth
 * pinning: the component the template actually binds,
 * `twoGatewayHyvaPaymentFormWithValidation`, is built by SPREADING the base, and
 * object spread reads an accessor and copies its VALUE. The alias froze to
 * `false` on the only component that matters, so the manual inputs could never
 * appear. The last describe here is that regression's guard.
 */

"use strict";

const H = require("./hyva-harness");

const BASE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";

describe("payment tile manual/search mode", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="payment-root">',
      '  <input type="text" id="company_name" value="" />',
      '  <input type="text" id="company_id" value="" disabled />',
      "</div>",
    ].join("\n");

    // The template arms a 500ms debounce whenever `dispatch-order-intent`
    // fires; fake timers keep that off the real clock.
    jest.useFakeTimers();

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * Mount the payment component with `$el` bound to the company-name input the
   * way the template's `@input` handler binds it, and with a `$watch` that
   * actually fires.
   *
   * The components are plain object literals rather than Alpine proxies, so an
   * assignment cannot trigger anything by itself. Recording the callbacks and
   * firing them from `setManualMode()` keeps the `manualMode` watcher →
   * `applyCompanyIdEditability()` chain in the test's path; stubbing `$watch` to
   * a no-op would let that chain regress unnoticed.
   *
   * @param {string} [componentName]
   * @returns {Object} the component, with a `setManualMode` helper attached
   */
  function mountPaymentComponent(componentName) {
    const input = document.getElementById("company_name");
    const mounted = H.mountComponent(
      env.alpineComponents[componentName || BASE_COMPONENT],
      { el: input, root: document.getElementById("payment-root") },
    );
    const watchers = {};
    mounted.$watch = function (name, callback) {
      watchers[name] = callback;
    };
    mounted.initialize(JSON.parse(H.QUOTE_JSON));
    mounted.setManualMode = function (value) {
      this.manualMode = value;
      if (watchers.manualMode) watchers.manualMode(value);
    };
    return mounted;
  }

  /**
   * Seed the storage key both checkout surfaces share.
   *
   * @param {Object} data
   * @returns {void}
   */
  function seedStorage(data) {
    env.browserStorage.setItem(
      "shipping_company_selection",
      JSON.stringify(data),
    );
  }

  /** @returns {Object} the persisted shipping-company selection */
  function storedSelection() {
    return JSON.parse(
      env.browserStorage.getItem("shipping_company_selection") || "{}",
    );
  }

  /**
   * The id and submitted name of whichever company-name input is VISIBLE, plus
   * the same for the company-id pair. This is the buyer-visible consequence of
   * the mode — what decides which values Magento receives — rather than the
   * flag that produced it.
   *
   * @param {Object} component
   * @returns {Object}
   */
  function visibleFields(component) {
    return {
      nameId: component.twoGatewayHyvaGetCompanyNameId(),
      nameField: component.twoGatewayHyvaGetCompanyNameField(),
      idId: component.twoGatewayHyvaGetCompanyIdFieldId(),
      idField: component.twoGatewayHyvaGetCompanyIdFieldName(),
    };
  }

  /**
   * Type into the search field and run the debounced handler, as the template's
   * `@input.debounce.300ms="getItems"` does.
   *
   * @param {Object} component
   * @param {string} value
   * @returns {Promise<void>}
   */
  async function type(component, value) {
    document.getElementById("company_name").value = value;
    // Deliberately NOT awaited: getItems() only settles once the stubbed fetch
    // is settled by hand, and the assertions here are about the request being
    // on the wire at all. Draining microtasks is enough to get it there.
    component.getItems();
    await H.flushPromises();
  }

  describe("a manual_mode restored from browser storage", () => {
    test("puts the SUBMITTING fields in manual mode, not a dead search box", () => {
      seedStorage({ quote_id: "test-quote-1", manual_mode: true });

      const component = mountPaymentComponent();

      // The bug: behaviour said manual (search refused to run) while
      // visibility said search, so the buyer got a field that did nothing.
      expect(component.manualMode).toBe(true);
      expect(component["!manualMode"]()).toBe(false);
      // The manual inputs are now the pair Magento will read.
      expect(visibleFields(component)).toEqual({
        nameId: "manual_company_name",
        nameField: "payment[manual_company_name]",
        idId: "manual_company_id",
        idField: "payment[manual_company_id]",
      });
      // And the company-id field is typeable, because in manual mode the buyer
      // is the only source for it.
      expect(component.companyIdDisabled).toBe(false);
    });

    test("can be left from the tile itself, and searching then works", async () => {
      seedStorage({ quote_id: "test-quote-1", manual_mode: true });
      const component = mountPaymentComponent();

      // The tile's own "Search for company" link.
      component.twoGatewayHyvaOnSearchModeClick();

      expect(component.manualMode).toBe(false);
      expect(visibleFields(component).nameField).toBe("payment[company_name]");
      // Persisted too — otherwise the next render restores the dead state.
      expect(storedSelection().manual_mode).toBe(false);

      await type(component, "Exa");

      // A real request on the wire is the whole point: before the fix
      // getItems() returned at the `manualMode` guard and nothing happened.
      expect(fetchStub.calls.length).toBe(1);
      expect(component.isSearching).toBe(true);
    });
  });

  describe("with no manual mode in storage", () => {
    test("searching works and the manual-entry link persists the switch", async () => {
      const component = mountPaymentComponent();
      expect(visibleFields(component).nameField).toBe("payment[company_name]");

      await type(component, "Exa");
      expect(fetchStub.calls.length).toBe(1);

      // The dropdown's "Enter details manually" link.
      component.twoGatewayHyvaOnManualEntryClick();
      await H.flushPromises();

      expect(component.manualMode).toBe(true);
      expect(visibleFields(component).nameField).toBe(
        "payment[manual_company_name]",
      );
      expect(storedSelection().manual_mode).toBe(true);
      // In-flight search superseded, so a late response cannot reopen the
      // dropdown over the manual fields or leave the spinner up.
      expect(component.isSearching).toBe(false);
      expect(component.isOpen).toBe(false);
      expect(component.items).toEqual([]);
    });

    test("the company-id field unlocks on the way into manual mode", () => {
      // A restored pick that DID carry a registry identifier is the locked
      // state — see the derivation in initialize(). Empty storage deliberately
      // yields unlocked, so it cannot be the precondition here.
      seedStorage({
        quote_id: "test-quote-1",
        store_id: "1",
        company_name: "Example Trading Ltd",
        company_id: "12345678",
        manual_mode: false,
      });
      const component = mountPaymentComponent();
      expect(component.companyIdDisabled).toBe(true);

      component.setManualMode(true);

      // Through the registered watcher, not an inline assignment: the derived
      // state has one owner, applyCompanyIdEditability().
      expect(component.companyIdDisabled).toBe(false);
    });
  });

  describe("the markup carries the one flag", () => {
    // State bound to nothing has no effect on the page, and this branch RENAMED
    // the thing the template binds — so the binding is read out of the template
    // rather than assumed. Without this, dropping `showManual` from the JS while
    // leaving `x-show="showManual"` in the markup would leave both blocks
    // permanently hidden and every state assertion above still green.
    const MANUAL_ID_SELECTOR = "input.company_id:not([data-name])";
    const SEARCH_ID_SELECTOR = 'input[data-name="company_id"]';

    test("the manual-mode input shows on a bare `manualMode`", () => {
      expect(
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          MANUAL_ID_SELECTOR,
          "x-show",
        ),
      ).toBe("manualMode");
    });

    test("the search-mode input shows on the negating getter", () => {
      // Not via readAlpineBinding(): `!manualMode` is CSP-legal but is not a
      // bare property name, so that helper rejects it by design.
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector(SEARCH_ID_SELECTOR).getAttribute("x-show")).toBe(
        "!manualMode",
      );
      // And the component answers that exact key.
      const component = H.mountComponent(
        env.alpineComponents[FORM_COMPONENT],
        {},
      );
      expect(typeof component["!manualMode"]).toBe("function");
    });
  });

  describe("the component the template actually binds", () => {
    // gateway_method.phtml binds x-data="…PaymentFormWithValidation", which is
    // built as `{ ...PaymentMethodBase(), ...twoValidatePaymentForm(…) }`.
    // Object spread reads accessors and copies their VALUE, so a
    // `get showManual()` on the base flattened to a static `false` here: the
    // manual inputs became unreachable while `!manualMode` correctly hid the
    // search block, leaving the buyer with BOTH blocks hidden. Nothing else in
    // the suite mounts this factory, which is why CI was green on it.
    test("tracks manualMode through the spread", () => {
      const component = mountPaymentComponent(FORM_COMPONENT);

      expect(component["!manualMode"]()).toBe(true);
      expect(visibleFields(component).nameField).toBe("payment[company_name]");

      component.setManualMode(true);

      expect(component["!manualMode"]()).toBe(false);
      expect(visibleFields(component).nameField).toBe(
        "payment[manual_company_name]",
      );
      expect(component.companyIdDisabled).toBe(false);
    });
  });

  describe("syncing a shipping company into a tile in manual mode", () => {
    // The consequence of making manual mode VISIBLE. company-name-payment.phtml
    // pushes the shipping selection into the tile, and it used to find the
    // fields by `[data-name]` — which is on the SEARCH-mode pair only. While a
    // restored `manual_mode` still displayed the search inputs (the state that
    // made the search box dead) that happened to be the submitting pair. Once
    // manual mode is actually shown, the same selector writes the HIDDEN
    // `payment[manual_*]` mirror: the order would carry the buyer's previous
    // company while the order intent was approved against the new one.
    //
    // In manual mode the ids swap, so `#company_name` is the manual input and
    // the search input — the one still carrying `data-name` — is
    // `#manual_company_name`. That is the shape asserted here.
    beforeEach(() => {
      document.body.innerHTML = [
        '<input type="hidden" id="shipping-company" value="" />',
        '<input type="hidden" id="shipping-company_id" value="" />',
        '<div x-data="stub">',
        '  <input type="text" id="company_name" data-manual="true" value="Previous Holdings Ltd" />',
        '  <input type="text" id="manual_company_name" data-name="company_name" value="Previous Holdings Ltd" />',
        '  <input type="text" id="company_id" data-manual="true" value="99999999" />',
        '  <input type="text" id="manual_company_id" data-name="company_id" value="99999999" />',
        "</div>",
      ].join("\n");
      env.browserStorage.setItem(
        "shipping_company_selection",
        JSON.stringify({
          quote_id: "test-quote-1",
          store_id: "1",
          company_name: "Example Trading Ltd",
          company_id: "12345678",
          manual_mode: true,
        }),
      );
    });

    test("writes the SUBMITTING field, not the hidden mirror", () => {
      H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
      document.dispatchEvent(new Event("DOMContentLoaded"));

      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(document.getElementById("company_id").value).toBe("12345678");
      // The search-mode mirror is what `[data-name]` points at, and it is
      // hidden and submits `payment[manual_*]`, so it must NOT be the target.
      expect(document.getElementById("manual_company_name").value).toBe(
        "Previous Holdings Ltd",
      );
    });
  });
});
