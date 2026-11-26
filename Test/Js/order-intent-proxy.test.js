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
    // twoGatewayProxyPost is the one fetch wrapper behind every proxy route;
    // covering it here covers search/detail/order-intent alike.
    expect(call.init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
    });

    const sent = call.jsonBody();
    expect(Object.keys(sent)).toEqual(["payload"]);
    const payload = JSON.parse(sent.payload);
    // Only the buyer: the plugin composes amounts and lines from the quote (TWO-26092).
    expect(Object.keys(payload)).toEqual(["buyer"]);
    expect(payload.buyer.company.organization_number).toBe("123456789");
    expect(payload.buyer.company.country_prefix).toBe("GB");
    expect(payload.buyer.representative).toEqual({
      email: "buyer@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      phone_number: "+44 1234",
    });

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

  // ABN-643: the error handler reads only the status, to tell a rate limit
  // from every other failure, whether the API or the shop's own route answered.
  test.each([
    { settle: (c) => c.respondProxy({ error_code: "ORDER_INVALID" }, false, 400), status: 400, label: "an API refusal" },
    { settle: (c) => c.respondProxy({ error_code: "RATE_LIMITED" }, false, 429), status: 429, label: "an API rate limit" },
    { settle: (c) => c.respondProxy({ error_code: "PROXY_REFUSED" }, false, 503), status: 503, label: "a module refusal" },
    { settle: (c) => c.respondWithStatus(404), status: 404, label: "the shop route missing" },
    { settle: (c) => c.respondWithStatus(429), status: 429, label: "a shop webapi 429" },
  ])("$label rejects carrying its status", async ({ settle, status, label }) => {
    tile = mountTile();

    const pending = tile.component.placeOrderIntent();
    settle(tile.fetchStub.last());
    const error = await pending.catch((e) => e);

    expect([label, error.status]).toEqual([label, status]);
  });

  test("no company means no request at all", async () => {
    tile = mountTile();
    tile.component.companyId = "";
    document.getElementById("company_id").value = "";

    expect(await tile.component.placeOrderIntent()).toBeNull();
    expect(tile.fetchStub.calls).toHaveLength(0);
  });
});
