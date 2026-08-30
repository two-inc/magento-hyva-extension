/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The order-intent check runs through the plugin's own backend rather than
 * straight from the browser, so the merchant API key — and a firewall token
 * where a merchant's network needs one — stay server-side. The tile's job is
 * to address the right route, hand over the request body intact, and turn the
 * `{ok, status, body}` answer back into the resolve/reject the dispatcher and
 * its verdict rendering were already written against.
 *
 * `placeOrderIntent()` is stubbed out in every other suite in this directory
 * (it is their seam), so this is the only place the real one runs.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const REST_BASE = "https://shop.test.invalid";
const ROUTE = REST_BASE + "/rest/V1/two/order-intent";

/** A decision as the API answers one. */
const APPROVED = { approved: true, decision: "APPROVED" };

/**
 * The company pair the request body is built from, plus the country field the
 * tile resolves the buyer's country through.
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
 * Mount the tile with a quote an intent can be built from.
 *
 * @returns {Object} `{component, fetchStub, restore}`
 */
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

  // The merchant is resolved server-side and whatever the browser sent would be
  // overwritten there; sending it anyway would be a second, staler source of
  // the same fact.
  test("no merchant identity is sent", async () => {
    tile = mountTile();

    const pending = tile.component.placeOrderIntent();
    const call = tile.fetchStub.last();
    const payload = JSON.parse(call.jsonBody().payload);

    // Absent from the object, not merely undefined — a payload that decoded to
    // `{}` would satisfy toBeUndefined() having sent nothing at all. The two
    // fields that DO belong in it prove this is the real body.
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

  // Every failure the check can meet reaches the dispatcher as a rejection —
  // which is what puts the general error wording in the verdict box. An
  // upstream refusal arrives as a 200 carrying `ok: false`, so it is
  // recognised from the envelope rather than from the HTTP status.
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
