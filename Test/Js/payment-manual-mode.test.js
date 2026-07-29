/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. The payment tile's manual/search mode is ONE fact.
 *
 * It used to be two properties with no watcher between them — `manualMode`
 * (behaviour: getItems() refuses to search) and `showManual` (visibility: which
 * of the duplicated inputs is x-show'd) — and initialize() restored only the
 * first from browser storage. The address form's "Enter details manually" link
 * writes `manual_mode: true` into that same storage key, so the payment tile
 * came up rendering a live search box that could not search: every keystroke
 * returned early with no request, no spinner and no dropdown.
 *
 * It was also inescapable. The tile's own two links wrote `showManual` only,
 * and the one function that clears `manualMode` — enableSearch() — is bound in
 * the address template, never on the tile.
 *
 * These tests assert the two properties can no longer disagree, and that the
 * tile can talk itself out of a restored manual mode on its own.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

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
   * Mount the payment component and run initialize(), with `$el` bound to the
   * company-name input the way the template's `@input` handler binds it.
   *
   * @returns {Object} the component
   */
  function mountPaymentComponent() {
    const input = document.getElementById("company_name");
    const mounted = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: input,
      root: document.getElementById("payment-root"),
    });
    mounted.$watch = function () {};
    mounted.initialize(JSON.parse(H.QUOTE_JSON));
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
   * Type into the search field and run the debounced handler, as the
   * template's `@input.debounce.300ms="getItems"` does.
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
    test("switches the tile to the manual fields, not a dead search box", () => {
      seedStorage({ quote_id: "test-quote-1", manual_mode: true });

      const component = mountPaymentComponent();

      // The bug: manualMode true (search refuses to run) while showManual
      // stayed false (search box on screen). One fact now, so they agree.
      expect(component.manualMode).toBe(true);
      expect(component.showManual).toBe(true);
      expect(component["!showManual"]()).toBe(false);
    });

    test("can be left from the tile itself, and searching then works", async () => {
      seedStorage({ quote_id: "test-quote-1", manual_mode: true });
      const component = mountPaymentComponent();

      // The tile's own "Search for company" link.
      component.twoGatewayHyvaOnSearchModeClick();

      expect(component.manualMode).toBe(false);
      expect(component.showManual).toBe(false);
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
      expect(component.showManual).toBe(false);

      await type(component, "Exa");
      expect(fetchStub.calls.length).toBe(1);

      // The dropdown's "Enter details manually" link.
      component.twoGatewayHyvaOnManualEntryClick();
      await H.flushPromises();

      expect(component.manualMode).toBe(true);
      expect(component.showManual).toBe(true);
      expect(storedSelection().manual_mode).toBe(true);
      // In-flight search superseded, so a late response cannot reopen the
      // dropdown over the manual fields or leave the spinner up.
      expect(component.isSearching).toBe(false);
      expect(component.isOpen).toBe(false);
      expect(component.items).toEqual([]);
    });

    test("the dual-input ids follow the one flag", () => {
      const component = mountPaymentComponent();

      expect(component.twoGatewayHyvaGetCompanyNameId()).toBe("company_name");
      expect(component.twoGatewayHyvaGetCompanyIdFieldId()).toBe("company_id");

      component.manualMode = true;

      expect(component.twoGatewayHyvaGetCompanyNameId()).toBe(
        "manual_company_name",
      );
      expect(component.twoGatewayHyvaGetCompanyIdFieldId()).toBe(
        "manual_company_id",
      );
      expect(component.twoGatewayHyvaGetManualCompanyNameId()).toBe(
        "company_name",
      );
    });
  });
});
