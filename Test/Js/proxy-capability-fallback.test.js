/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * What this checkout does on a base module that does NOT carry the registry
 * and order-intent proxy routes — see CheckoutConfig::getIsProxyAvailable().
 *
 * Both halves are asserted against the SAME rendered templates with only the
 * injected flag differing, so a call site that hardcoded either path fails one
 * of the two.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const API = "https://api.test.invalid";
const REST_BASE = "https://shop.test.invalid";

/** The flag as the templates emit it, forced to the no-routes answer. */
const PROXY_ABSENT = [[/^\$isProxyAvailable \? "true" : "false"$/, "false"]];

/** A decision as the API answers one. */
const APPROVED = { approved: true, decision: "APPROVED" };

/**
 * The company pair the order-intent body is built from, plus the country
 * field the tile resolves the buyer's country through.
 *
 * @returns {void}
 */
function installFixture() {
  document.body.innerHTML =
    '<div id="checkout">' +
    '<select id="shipping-country_id" name="country_id">' +
    '<option value="GB" selected>GB</option>' +
    "</select>" +
    '<input id="company_name" name="payment[company_name]" data-name="company_name" value="Acme Widgets Ltd" />' +
    '<input id="company_id" name="payment[company_id]" data-name="company_id" value="123456789" />' +
    "</div>";
}

/**
 * Mount the payment tile with a quote an intent can be built from.
 *
 * @param {Array<[RegExp, string]>} [extraRules] harness render rules
 * @returns {Object} `{component, fetchStub, restore}`
 */
function mountTile(extraRules) {
  const env = H.installHyvaEnvironment();
  const fetchStub = H.stubFetch();
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  installFixture();
  H.loadSharedHelpers(extraRules);
  env.fireAlpineInit();

  const component = H.mountComponent(env.alpineComponents[COMPONENT], {
    el: document.getElementById("checkout"),
  });
  if (!component) {
    throw new Error("bootstrap check: no component registered as " + COMPONENT);
  }

  component.quote = {
    quote_id: "test-quote-1",
    email: "buyer@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    telephone: "+44 1234",
    quote_currency_code: "GBP",
    grand_total: 120,
    tax_amount: 20,
    shipping_tax_amount: 0,
    shipping_amount: 0,
    shipping_incl_tax: 0,
    items: [],
  };
  component.companyId = "123456789";
  component.companyName = "Acme Widgets Ltd";

  return {
    component: component,
    fetchStub: fetchStub,
    restore: function () {
      consoleError.mockRestore();
      fetchStub.restore();
      env.restore();
      document.body.innerHTML = "";
    },
  };
}

describe("the capability flag reaches the browser", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  // The mutation proof for every assertion below it: the templates carry no
  // literal, so flipping the one PHP value moves every call site.
  test.each([
    { rules: undefined, expected: true, label: "routes present" },
    { rules: PROXY_ABSENT, expected: false, label: "routes absent" },
  ])("the tile reads $label from PHP", ({ rules, expected }) => {
    tile = mountTile(rules);
    expect(tile.component.isProxyAvailable).toBe(expected);
  });
});

describe("order intent without the proxy route", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  test("goes straight to the API, as it did before the route existed", async () => {
    tile = mountTile(PROXY_ABSENT);

    const pending = tile.component.placeOrderIntent();
    const call = tile.fetchStub.last();

    expect(call.url).toContain(API + "/v1/order_intent?");
    expect(call.url).not.toContain("/rest/V1/two/");
    expect(call.init.method).toBe("POST");

    // With no server to set it, identification travels on the query string.
    const query = new URLSearchParams(call.url.split("?")[1]);
    // `client`/`client_v` come from the order-intent config block, which the
    // harness renders as one placeholder; `merchant` has a rule of its own.
    expect(query.get("client")).toBe("test");
    expect(query.get("client_v")).toBe("test");
    expect(query.get("merchant")).toBe("Example Shop");

    // The body is the request itself, not the proxy's `{payload}` wrapper.
    const sent = JSON.parse(call.init.body);
    expect(sent.payload).toBeUndefined();
    expect(sent.buyer.company.organization_number).toBe("123456789");
    expect(sent.currency).toBe("GBP");

    call.respond(APPROVED);
    expect(await pending).toEqual(APPROVED);
  });

  // With no server to resolve the merchant from the store's API key, the
  // request has to name it itself.
  test("names the merchant, which the proxied body deliberately does not", () => {
    tile = mountTile(PROXY_ABSENT);

    tile.component.placeOrderIntent();
    const sent = JSON.parse(tile.fetchStub.last().init.body);

    expect(sent.merchant_id).toBe("test-merchant-id");
    expect(sent.merchant_short_name).toBe("Example Shop");
  });

  test("a refusal still rejects, so the verdict box is painted not blank", async () => {
    tile = mountTile(PROXY_ABSENT);

    const pending = tile.component.placeOrderIntent();
    tile.fetchStub.last().respondWithStatus(500);

    await expect(pending).rejects.toThrow();
  });

  // The whole point of the fallback: a base without the route must not reach
  // one. A 404 from an unregistered route is what a missing capability check
  // would turn a checkout into.
  test("the unregistered route is never addressed", () => {
    tile = mountTile(PROXY_ABSENT);
    tile.component.placeOrderIntent();

    tile.fetchStub.calls.forEach((call) => {
      expect(call.url).not.toContain("/rest/V1/two/order-intent");
    });
  });
});

describe("company lookups without the proxy routes", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  test("search is a GET to the registry endpoint with paging restored", async () => {
    const promise = window.twoGatewayCompanySearch({
      useProxy: false,
      restBaseUrl: REST_BASE,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
      limit: 50,
      client: "magento-hyva",
      clientV: "2.1.0",
      merchant: "Example Shop",
    });

    const call = fetchStub.last();
    expect(call.url).toContain(API + "/companies/v2/company?");
    expect(call.init.method).toBeUndefined();

    const query = new URLSearchParams(call.url.split("?")[1]);
    expect(query.get("country")).toBe("GB");
    expect(query.get("q")).toBe("acme");
    // Paging is the caller's, there being no server to set it.
    expect(query.get("limit")).toBe("50");
    expect(query.get("offset")).toBe("0");
    expect(query.get("merchant")).toBe("Example Shop");

    call.respond({
      items: [
        {
          name: "Acme Widgets",
          highlight: "<em>Acme Widgets</em>",
          national_identifier: { id: "111" },
          lookup_id: "lookup-111",
        },
      ],
    });

    const result = await promise;
    expect(result.status).toBe("ok");
    expect(result.items[0].companyId).toBe("111");
  });

  // The discriminated result is the helper's whole contract, and a failure
  // that collapsed to `items: []` would read to a buyer as "no matches".
  test("a failed direct search still reports failed, not empty", async () => {
    const promise = window.twoGatewayCompanySearch({
      useProxy: false,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
      limit: 50,
    });
    fetchStub.last().respondWithStatus(502);

    expect((await promise).status).toBe("failed");
  });

  // Keyed by the direct URL rather than the proxy's synthetic key, so the two
  // paths cannot serve each other's answers within one page.
  test("a direct search is not answered from the proxy's cache entry", async () => {
    const proxied = window.twoGatewayCompanySearch({
      useProxy: true,
      restBaseUrl: REST_BASE,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
      limit: 10,
    });
    fetchStub.last().respondProxy({ items: [] });
    await proxied;

    const afterProxied = fetchStub.calls.length;
    const direct = window.twoGatewayCompanySearch({
      useProxy: false,
      restBaseUrl: REST_BASE,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
      limit: 10,
    });
    // Same country and query: a shared key would serve the proxy's answer and
    // never reach the wire.
    expect(fetchStub.calls.length).toBe(afterProxied + 1);
    expect(fetchStub.last().url).toContain(API + "/companies/v2/company?");

    fetchStub.last().respond({ items: [] });
    await direct;
  });

  test("a repeated direct search is served from cache", async () => {
    const first = window.twoGatewayCompanySearch({
      useProxy: false,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
      limit: 10,
    });
    fetchStub.last().respond({ items: [] });
    await first;

    const before = fetchStub.calls.length;
    await window.twoGatewayCompanySearch({
      useProxy: false,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
      limit: 10,
    });

    expect(fetchStub.calls).toHaveLength(before);
  });

  test("detail is a GET to the record's own URL", async () => {
    const promise = window.twoGatewayCompanyDetail(REST_BASE, "lookup-111", {
      checkoutApiUrl: API,
      client: "magento-hyva",
      clientV: "2.1.0",
      merchant: "Example Shop",
    });

    const call = fetchStub.last();
    expect(call.url).toContain(API + "/companies/v2/company/lookup-111?");
    expect(call.url).not.toContain("/rest/V1/two/");

    call.respond({ addresses: [{ city: "London" }] });
    expect((await promise).addresses[0].city).toBe("London");
  });

  test("a failed direct detail answers null rather than throwing", async () => {
    const promise = window.twoGatewayCompanyDetail(REST_BASE, "lookup-111", {
      checkoutApiUrl: API,
    });
    fetchStub.last().respondWithStatus(500);

    expect(await promise).toBeNull();
  });

  // Fail closed, matching the engine's own `isProxyAvailable` default: a
  // caller that omits the flag gets the direct call, which works on every
  // base, rather than a proxy route the installed base may not have
  // registered. Every real mount passes the flag, so only a future caller is
  // affected — and it should land on the path that cannot 404 the checkout.
  describe("a caller that omits the flag entirely", () => {
    test("search takes the direct path, not the proxy route", async () => {
      const promise = window.twoGatewayCompanySearch({
        restBaseUrl: REST_BASE,
        checkoutApiUrl: API,
        countryCode: "gb",
        // Its own term: the cache is window-scoped and outlives a test.
        query: "zeta",
      });

      expect(fetchStub.last().url).toContain(API + "/companies/v2/company?");
      expect(fetchStub.last().url).not.toContain("/rest/V1/two/");

      fetchStub.last().respond({ items: [] });
      await promise;
    });

    test("detail takes the direct path, not the proxy route", async () => {
      const promise = window.twoGatewayCompanyDetail(REST_BASE, "lookup-111");

      expect(fetchStub.last().url).toContain(
        "/companies/v2/company/lookup-111?",
      );
      expect(fetchStub.last().url).not.toContain("/rest/V1/two/");

      fetchStub.last().respond({ addresses: [] });
      await promise;
    });

    // Through the engine rather than the helper, because the mounts reach the
    // helper only via this composition and its own default has to agree.
    test("an engine composed without it searches direct", async () => {
      document.body.innerHTML =
        '<div id="checkout">' +
        '<select id="shipping-country_id" name="country_id">' +
        '<option value="GB" selected>GB</option>' +
        "</select></div>";
      const engine = H.mountComponent(
        () =>
          window.twoGatewayCompanySearchEngine({
            restBaseUrl: REST_BASE,
            checkoutApiUrl: API,
            getQuote: () => ({}),
          }),
        { el: document.getElementById("checkout") },
      );

      const pending = engine.runCompanySearch("omega");
      expect(fetchStub.last().url).toContain(API + "/companies/v2/company?");
      expect(fetchStub.last().url).not.toContain("/rest/V1/two/");

      fetchStub.last().respond({ items: [] });
      await pending;
    });
  });
});

/**
 * The flag is the one value in these object literals emitted BARE — every
 * neighbouring config value is a quoted string, and the string "false" is
 * truthy, so a copy-paste matching the surrounding style would flip all three
 * mounts to the proxy on a base that has no proxy routes.
 */
describe("the flag is emitted as a JS boolean, not a quoted string", () => {
  const MOUNTS = [
    ["the payment tile", H.GATEWAY_METHOD_TEMPLATE],
    ["the address step", H.COMPANY_NAME_TEMPLATE],
    ["the address-book modal", H.SHIPPING_COMPANY_TEMPLATE],
  ];

  /**
   * Every value the rendered JS assigns to the flag, source text as written.
   *
   * @param {string} template harness template constant
   * @param {Array<[RegExp, string]>} [rules] harness render rules
   * @returns {Array<string>} raw right-hand sides
   */
  function emitted(template, rules) {
    const matches = H.renderTemplateJs(template, rules).matchAll(
      /isProxyAvailable:\s*([^,\n]+),/g,
    );
    return Array.from(matches, (match) => match[1]);
  }

  test.each(MOUNTS)("%s", (label, template) => {
    // Given both PHP answers / When rendered / Then each arrives unquoted.
    expect(emitted(template)).toContain("true");
    expect(emitted(template, PROXY_ABSENT)).toContain("false");

    const quoted = emitted(template)
      .concat(emitted(template, PROXY_ABSENT))
      .filter((value) => /^['"]/.test(value));
    expect(quoted).toEqual([]);
  });
});
