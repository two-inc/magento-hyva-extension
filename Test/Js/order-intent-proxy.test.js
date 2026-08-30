/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * `placeOrderIntent()` is stubbed in every other suite here, so this is the
 * only place the real one runs.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const REST_BASE = "https://shop.test.invalid";
const ROUTE = REST_BASE + "/rest/V1/two/order-intent";

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

function mountTile() {
  const env = H.installHyvaEnvironment();
  const fetchStub = H.stubFetch();
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  installFixture();
  H.loadSharedHelpers();
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

describe("order intent through the plugin's own backend", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  test("the request is a POST to the proxy route carrying the body as one string", async () => {
    tile = mountTile();

    const pending = tile.component.placeOrderIntent();
    const call = tile.fetchStub.last();

    expect(call.url).toBe(ROUTE);
    expect(call.init.method).toBe("POST");

    const sent = call.jsonBody();
    expect(Object.keys(sent)).toEqual(["payload"]);
    const payload = JSON.parse(sent.payload);
    expect(payload.buyer.company.organization_number).toBe("123456789");
    expect(payload.buyer.company.country_prefix).toBe("GB");
    expect(payload.currency).toBe("GBP");

    call.respondProxy(APPROVED);
    await pending;
  });

  test("no merchant identity is sent", async () => {
    tile = mountTile();

    const pending = tile.component.placeOrderIntent();
    const call = tile.fetchStub.last();
    const payload = JSON.parse(call.jsonBody().payload);

    // Key-absence, not undefined: a payload decoding to `{}` satisfies toBeUndefined().
    expect(payload.buyer.company.organization_number).toBe("123456789");
    expect(payload.currency).toBe("GBP");
    expect(Object.keys(payload)).not.toContain("merchant_id");
    expect(Object.keys(payload)).not.toContain("merchant_short_name");

    call.respondProxy(APPROVED);
    await pending;
  });

  test("an approval resolves to the decision itself, unwrapped", async () => {
    tile = mountTile();

    const pending = tile.component.placeOrderIntent();
    tile.fetchStub.last().respondProxy(APPROVED);

    expect(await pending).toEqual(APPROVED);
  });

  // An upstream refusal arrives as a 200 carrying `ok: false` — recognised from
  // the envelope, not the HTTP status.
  test.each([
    {
      settle: (call) =>
        call.respondProxy({ error_code: "ORDER_INVALID" }, false, 400),
      label: "the envelope reporting the API call failed",
    },
    {
      settle: (call) => call.respondWithStatus(500),
      label: "the proxy route itself answering non-2xx",
    },
    { settle: (call) => call.networkError(), label: "the connection dropping" },
  ])("the check rejects on $label", async ({ settle }) => {
    tile = mountTile();

    const pending = tile.component.placeOrderIntent();
    settle(tile.fetchStub.last());

    await expect(pending).rejects.toThrow();
  });

  test("no company means no request at all", async () => {
    tile = mountTile();
    tile.component.companyId = "";
    document.getElementById("company_id").value = "";

    expect(await tile.component.placeOrderIntent()).toBeNull();
    expect(tile.fetchStub.calls).toHaveLength(0);
  });
});
