/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 §7.4 (2026-08-04 unification). All THREE Hyvä company-search
 * mount points — the address-step field (`companyName-csp-js.phtml`), the
 * payment tile (`gateway_method-csp-js.phtml`), and the shipping-address
 * picker registered by `shipping_company.phtml` — must run their search
 * through the ONE shared request-lifecycle implementation,
 * `window.twoCompanySearchCore.runSearch()`, rather than each building its
 * own `fetch`/`AbortController`/status-mapping around
 * `window.twoGatewayCompanySearch()`.
 *
 * This is the grep-verifiable half of "exactly one implementation" made
 * executable: a spy on the shared core catches any of the three silently
 * regressing back to its own copy, which a text grep alone would not catch
 * if a future edit re-inlined the same logic under a different local name.
 */

"use strict";

const H = require("./hyva-harness");

const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";
const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const SHIPPING_COMPONENT = "searchInput";

describe("company-search core is the single shared implementation (TWO-25326 §7.4)", () => {
  let env;
  let fetchStub;
  let runSearchSpy;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  test("the address-step picker's getItems() delegates to the shared core", async () => {
    document.body.innerHTML = [
      '<input id="shipping-country_id" value="GB" />',
      '<div id="company-root">',
      '  <input type="text" id="company-field" value="" />',
      '  <input type="text" class="two-company-query" id="company-query" value="acme" />',
      "</div>",
    ].join("\n");

    H.loadSharedHelpers();
    runSearchSpy = jest.spyOn(window.twoCompanySearchCore, "runSearch");
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    const component = H.mountComponent(
      env.alpineComponents[ADDRESS_COMPONENT],
      {
        el: document.getElementById("company-field"),
        root: document.getElementById("company-root"),
      },
    );
    component.init();

    const pending = component.getItems();
    await H.flushPromises();
    fetchStub.last().respond({ items: [] });
    await pending;

    expect(runSearchSpy).toHaveBeenCalledTimes(1);
    expect(runSearchSpy.mock.calls[0][0]).toBe(component);
    expect(runSearchSpy.mock.calls[0][1].term).toBe("acme");
  });

  test("the payment tile's getItems() delegates to the same shared core", async () => {
    document.body.innerHTML = [
      '<input id="shipping-country_id" value="GB" />',
      '<input type="text" id="company_name" value="acme" />',
    ].join("\n");

    H.loadSharedHelpers();
    runSearchSpy = jest.spyOn(window.twoCompanySearchCore, "runSearch");
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();

    const component = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
      el: document.getElementById("company_name"),
    });
    component.quote = {};
    component.search = "acme";

    const pending = component.getItems();
    await H.flushPromises();
    fetchStub.last().respond({ items: [] });
    await pending;

    expect(runSearchSpy).toHaveBeenCalledTimes(1);
    expect(runSearchSpy.mock.calls[0][0]).toBe(component);
    expect(runSearchSpy.mock.calls[0][1].term).toBe("acme");
  });

  test("the shipping-address picker's getItems() delegates to the same shared core", async () => {
    document.body.innerHTML = [
      "<form>",
      '  <input type="hidden" id="shipping-company_id" value="" />',
      '  <input type="hidden" id="shipping-company" value="" />',
      '  <input type="text" id="company-search" value="acme" />',
      "</form>",
    ].join("\n");

    H.loadSharedHelpers();
    runSearchSpy = jest.spyOn(window.twoCompanySearchCore, "runSearch");
    H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
    env.fireAlpineInit();

    const component = H.mountComponent(
      env.alpineComponents[SHIPPING_COMPONENT],
      { el: document.getElementById("company-search") },
    );
    component.quote = { shipping_country_id: "GB" };

    const pending = component.getItems();
    await H.flushPromises();
    fetchStub.last().respond({ items: [] });
    await pending;

    expect(runSearchSpy).toHaveBeenCalledTimes(1);
    expect(runSearchSpy.mock.calls[0][0]).toBe(component);
    expect(runSearchSpy.mock.calls[0][1].term).toBe("acme");
  });

  test("both surfaces share the identical dedup-key logic (getCompanyRowKey)", () => {
    H.loadSharedHelpers();

    expect(
      window.twoCompanySearchCore.getCompanyRowKey({ companyId: "" }, 3),
    ).toBe("two-idx-3");
    expect(
      window.twoCompanySearchCore.getCompanyRowKey({ companyId: "123" }, 3),
    ).toBe("123");
  });
});
