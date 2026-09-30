/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * 36/37 suites in this directory render with the harness's `isProxyAvailable`
 * default (`true`), and the one dedicated fallback suite
 * (proxy-capability-fallback.test.js) opts a single call or component field
 * into the fallback per test. No suite drives a realistic buyer flow —
 * search a company, pick it, place the order intent — start to finish on the
 * path every currently-releasable base actually takes (composer floor
 * ^2.3.0, Packagist tops out at 2.1.2 — see CheckoutConfig::getIsProxyAvailable()).
 * This file does, under one PROXY_ABSENT mount, so that path has real
 * end-to-end coverage instead of only opt-outs.
 */

"use strict";

const H = require("./hyva-harness");

const FIELD_COMPONENT = "twoGatewayHyvaCompanySearchField";
const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const API = "https://api.test.invalid";
const REST_BASE = "https://shop.test.invalid";

// A base without the routes predates server-side intent too.
const PROXY_ABSENT = [
  [/^\$isProxyAvailable \? "true" : "false"$/, "false"],
  [/^\$isServerIntentAvailable \? "true" : "false"$/, "false"],
];

describe("the fallback path, end to end (search, select, order intent)", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="checkout">',
      '  <select id="shipping-country_id" name="country_id">',
      '    <option value="GB" selected>GB</option>',
      "  </select>",
      '  <div id="root" class="two-company-search" data-two-capture-host="address">',
      '    <input type="text" id="field" data-two-capture-field value="" />',
      "  </div>",
      "</div>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    // The suite-wide default is `true`; this is the config every real
    // install renders with today, not a per-test opt-out.
    H.loadSharedHelpers(PROXY_ABSENT);
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE, PROXY_ABSENT);
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    document.body.innerHTML = "";
  });

  test("a search hits the direct registry endpoint, not the proxy route", async () => {
    const field = document.getElementById("field");
    const component = H.mountComponent(env.alpineComponents[FIELD_COMPONENT], {
      el: field,
      root: document.getElementById("root"),
    });
    component.init();
    component.countryCode = "gb";

    const pending = component.capturePanelSearch({ term: "acme" });
    await H.flushPromises();

    const call = fetchStub.last();
    expect(call.url.startsWith(API + "/companies/v2/company?")).toBe(true);
    expect(call.url).not.toContain("/rest/V1/two/");

    call.respond({
      items: [
        {
          name: "Acme Widgets",
          highlight: "<em>Acme Widgets</em>",
          national_identifier: { id: "123456789" },
          lookup_id: "lookup-1",
        },
      ],
    });

    const result = await pending;
    expect(result.items[0].companyId).toBe("123456789");

    // Selecting the hit hands it to the engine in the engine's own shape —
    // `companyName`, not the panel-mapped `text`.
    component.selectItem({
      companyName: result.items[0].text,
      companyId: result.items[0].companyId,
      lookupId: result.items[0].lookupId,
    });
    expect(component.companyName).toBe("Acme Widgets");
    expect(component.companyId).toBe("123456789");
  });

  test("placing the order intent from that same fallback config sends nothing (TWO-26092)", async () => {
    document.getElementById("company_name") ||
      document.getElementById("checkout").insertAdjacentHTML(
        "beforeend",
        '<input id="company_name" name="payment[company_name]" data-name="company_name" value="Acme Widgets" />' +
          '<input id="company_id" name="payment[company_id]" data-name="company_id" value="123456789" />',
      );

    const tile = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
      el: document.getElementById("checkout"),
    });
    tile.quote = {
      quote_id: "test-quote-1",
      email: "buyer@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      telephone: "+44 1234",
    };
    tile.companyId = "123456789";
    tile.companyName = "Acme Widgets";

    const before = fetchStub.calls.length;
    const pending = tile.placeOrderIntent();

    // Amounts and lines are composed server-side, and a base without the route has none to compose.
    expect(fetchStub.calls).toHaveLength(before);
    expect(await pending).toBeNull();
  });
});
