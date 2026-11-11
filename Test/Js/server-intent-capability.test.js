/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * Both halves render the SAME templates with only the injected server-intent
 * flag differing, so a call site that hardcoded either path fails one of them.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const REST_BASE = "https://shop.test.invalid";

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

const SERVER_INTENT_ABSENT = [[/^\$isServerIntentAvailable \? "true" : "false"$/, "false"]];

describe("order intent on a base that does not compose it", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  // TWO-26092: amounts and lines are composed from the quote by the base, so a
  // base that still expects them from the browser gets no intent at all.
  test("sends nothing and resolves with no verdict", async () => {
    tile = mountTile(SERVER_INTENT_ABSENT);

    const pending = tile.component.placeOrderIntent();

    expect(tile.fetchStub.calls).toHaveLength(0);
    expect(await pending).toBeNull();
  });
});

/** A merely truthy value — a `"false"` out of an encoder — must not address a route the base may lack. */
describe("the server-intent flag is read by identity", () => {
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

  test.each(VALUES)("order intent — $label", async ({ flag, proxied }) => {
    tile = mountTile();
    tile.component.isServerIntentAvailable = flag;

    const pending = tile.component.placeOrderIntent();

    if (proxied) {
      const call = tile.fetchStub.last();
      expect(call.url).toBe(REST_BASE + "/rest/V1/two/order-intent");
      const sent = JSON.parse(call.init.body);
      expect(Object.keys(sent)).toEqual(["payload"]);
      expect(Object.keys(JSON.parse(sent.payload))).toEqual(["buyer"]);
      call.respondProxy(APPROVED);
      expect(await pending).toEqual(APPROVED);
    } else {
      // Nothing but the plugin's backend can compose an intent (TWO-26092).
      expect(tile.fetchStub.calls).toHaveLength(0);
      expect(await pending).toBeNull();
    }
  });
});
