/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * Both halves render the SAME templates with only the injected flag differing,
 * so a call site that hardcoded either path fails one of the two.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const API = "https://api.test.invalid";
const REST_BASE = "https://shop.test.invalid";

const PROXY_ABSENT = [[/^\$isProxyAvailable \? "true" : "false"$/, "false"]];

const APPROVED = { approved: true, decision: "APPROVED" };

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

  // Mutation proof: no literal in the templates, so one PHP value moves every site.
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
    expect(call.init.method).toBe("POST");

    // Anchored outside the loop: a forEach body with no calls asserts nothing.
    expect(tile.fetchStub.calls.length).toBeGreaterThan(0);
    tile.fetchStub.calls.forEach((made) => {
      expect(made.url).not.toContain("/rest/V1/two/");
    });

    const query = new URLSearchParams(call.url.split("?")[1]);
    // The harness renders `client`/`client_v` as one placeholder; `merchant` has its own rule.
    expect(query.get("client")).toBe("test");
    expect(query.get("client_v")).toBe("test");
    expect(query.get("merchant")).toBe("Example Shop");

    const sent = JSON.parse(call.init.body);
    expect(sent.payload).toBeUndefined();
    expect(sent.buyer.company.organization_number).toBe("123456789");
    expect(sent.currency).toBe("GBP");

    call.respond(APPROVED);
    expect(await pending).toEqual(APPROVED);
  });

  test("names the merchant, which the proxied body deliberately does not", async () => {
    tile = mountTile(PROXY_ABSENT);

    const pending = tile.component.placeOrderIntent();
    const call = tile.fetchStub.last();
    const sent = JSON.parse(call.init.body);

    expect(sent.merchant_id).toBe("test-merchant-id");
    expect(sent.merchant_short_name).toBe("Example Shop");

    call.respond(APPROVED);
    await pending;
  });

  test("a refusal still rejects, so the verdict box is painted not blank", async () => {
    tile = mountTile(PROXY_ABSENT);

    const pending = tile.component.placeOrderIntent();
    tile.fetchStub.last().respondWithStatus(500);

    await expect(pending).rejects.toThrow();
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

  // A failure collapsing to `items: []` would read to a buyer as "no matches".
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
    // Same country and query: a shared cache key would never reach the wire.
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

  // Fail closed — see twoGatewayCompanySearch's useProxy.
  describe("a caller that omits the flag entirely", () => {
    test("search takes the direct path, not the proxy route", async () => {
      const promise = window.twoGatewayCompanySearch({
        restBaseUrl: REST_BASE,
        checkoutApiUrl: API,
        countryCode: "gb",
        query: "zeta",
      });

      expect(fetchStub.last().url).toContain(API + "/companies/v2/company?");
      expect(fetchStub.last().url).not.toContain("/rest/V1/two/");

      fetchStub.last().respond({ items: [] });
      await promise;
    });

    // The whole URL, not a substring: a host-less relative URL still contains the
    // path and still omits the proxy route, so substring assertions pass on the bug.
    test("detail builds the store's own direct URL, host and all", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => {});
      const promise = window.twoGatewayCompanyDetail(REST_BASE, "lookup-111");

      expect(fetchStub.last().url).toBe(
        API +
          "/companies/v2/company/lookup-111" +
          "?client=magento-hyva&client_v=2.1.0&merchant=Example+Shop",
      );

      fetchStub.last().respond({ addresses: [] });
      await promise;
    });

    test("detail warns that it was called with no direct config", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const promise = window.twoGatewayCompanyDetail(REST_BASE, "lookup-111");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("no direct config");

      fetchStub.last().respond({ addresses: [] });
      await promise;
    });

    // Through the engine: mounts reach the helper only via this composition.
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

/** A merely truthy value — a `"false"` out of an encoder — must not address a route the base may lack. */
describe("the capability flag is read by identity at every selection site", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  const VALUES = [
    { flag: true, proxied: true, label: "true, the boolean PHP emits" },
    { flag: false, proxied: false, label: "false, the other boolean" },
    { flag: undefined, proxied: false, label: "an omitted flag" },
    {
      flag: "false",
      proxied: false,
      label: 'a stringified "false" — truthy, and the bug this guards',
    },
    {
      flag: "true",
      proxied: false,
      label: 'a stringified "true" is still not the boolean',
    },
    { flag: 1, proxied: false, label: "a numeric 1 is not the boolean" },
    { flag: 0, proxied: false, label: "a numeric 0" },
  ];

  test.each(VALUES)("company search — $label", async ({ flag, proxied }) => {
    tile = mountTile();

    const pending = window.twoGatewayCompanySearch({
      useProxy: flag,
      restBaseUrl: REST_BASE,
      checkoutApiUrl: API,
      countryCode: "gb",
      query: "acme",
    });
    const call = tile.fetchStub.last();

    expect(call.url === REST_BASE + "/rest/V1/two/company-search").toBe(
      proxied,
    );
    expect(call.url.startsWith(API + "/companies/v2/company?")).toBe(!proxied);

    if (proxied) {
      call.respondProxy({ items: [] });
    } else {
      call.respond({ items: [] });
    }
    await pending;
  });

  test.each(VALUES)("address lookup — $label", async ({ flag, proxied }) => {
    tile = mountTile();
    tile.component.isProxyAvailable = flag;

    const pending = tile.component.addressLookup(
      "lookup-111",
      document.getElementById("checkout"),
    );
    const call = tile.fetchStub.last();

    expect(call.url === REST_BASE + "/rest/V1/two/company").toBe(proxied);
    expect(call.url.startsWith(API + "/companies/v2/company/lookup-111?")).toBe(
      !proxied,
    );

    if (proxied) {
      call.respondProxy({ addresses: [] });
    } else {
      call.respond({ addresses: [] });
    }
    await pending;
  });

  test.each(VALUES)("order intent — $label", async ({ flag, proxied }) => {
    tile = mountTile();
    tile.component.isProxyAvailable = flag;

    const pending = tile.component.placeOrderIntent();
    const call = tile.fetchStub.last();
    const sent = JSON.parse(call.init.body);

    expect(call.url === REST_BASE + "/rest/V1/two/order-intent").toBe(proxied);
    expect(call.url.startsWith(API + "/v1/order_intent?")).toBe(!proxied);

    if (proxied) {
      expect(Object.keys(sent)).toEqual(["payload"]);
      const payload = JSON.parse(sent.payload);
      expect(Object.keys(payload)).not.toContain("merchant_id");
      expect(Object.keys(payload)).not.toContain("merchant_short_name");
      call.respondProxy(APPROVED);
    } else {
      expect(sent.merchant_id).toBe("test-merchant-id");
      expect(sent.merchant_short_name).toBe("Example Shop");
      call.respond(APPROVED);
    }
    await pending;
  });
});

/** Quoting the flag to match its neighbours would flip all three mounts open. */
describe("the flag is emitted as a JS boolean, not a quoted string", () => {
  const MOUNTS = [
    ["the payment tile", H.GATEWAY_METHOD_TEMPLATE],
    ["the address step", H.COMPANY_NAME_TEMPLATE],
    ["the address-book modal", H.SHIPPING_COMPANY_TEMPLATE],
  ];

  /** Raw source text of every value the rendered JS assigns to the flag. */
  function emitted(template, rules) {
    const matches = H.renderTemplateJs(template, rules).matchAll(
      /isProxyAvailable:\s*([^,\n]+),/g,
    );
    return Array.from(matches, (match) => match[1]);
  }

  test.each(MOUNTS)("%s", (label, template) => {
    // Given both PHP answers / When rendered / Then true→false, nothing quoted.
    const present = emitted(template);
    const absent = emitted(template, PROXY_ABSENT);

    // Identified by the position that MOVED, never by matching "false" anywhere:
    // the engine's own `isProxyAvailable: false` default would satisfy that alone.
    expect(absent).toHaveLength(present.length);
    const moved = present
      .map((value, index) => [value, absent[index]])
      .filter(([before, after]) => before !== after);
    expect(moved).toEqual([["true", "false"]]);

    const quoted = present
      .concat(absent)
      .filter((value) => /^['"]/.test(value));
    expect(quoted).toEqual([]);
  });
});
