/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 / PDEV-4669 — the sole-trader half of the payment tile.
 *
 * The flow itself is the base plugin's `sole-trader.js`: the token mint, the
 * hosted-signup popup, the postMessage handshake and the buyer read all live
 * there, one implementation for both checkouts, and are covered against the real
 * file where that file lives. Neither it nor the capture controller that drives
 * it is in this repo.
 *
 * What IS this repo's, and what this suite pins, is the host adapter the flow
 * calls back into — the URLs it is given, where each value comes from, what it
 * writes into this checkout's DOM and storage — plus the chip route that reaches
 * it. The two ways this port can be wrong are both invisible on screen:
 *
 *  - a value read from the DOM where it has to come from the server. The
 *    `country` the signup is opened for is the compliance-sensitive one
 *    (PDEV-4669): it decides which country's identity verification the buyer
 *    faces, so a DOM-fed value would let them pick. The suite proves
 *    `signupCountry()` ignores an address form that disagrees with the quote.
 *  - a host function that names nothing. The controller throws on a partial
 *    adapter, deep inside a buyer's flow, so every member is checked present.
 *
 * Live verification is still outstanding: Hyvä Checkout is a commercial package
 * and is not installed anywhere reachable from this repo, so nothing here has
 * been run against a real checkout.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT = "twoGatewayHyvaPaymentMethodBase";

/** The base URL the harness emits for `$restBaseUrl`. */
const REST_BASE = "https://shop.test.invalid";

/** Render rule that turns address autopopulation ON for one test. */
const AUTOPOPULATION_ON = [[/^\$isAddressAutopopulationEnabled$/, "true"]];

/** A buyer record as `/autofill/v1/buyer/current` returns one. */
const BUYER = {
  email: "sole@trader.test",
  company_name: "Sole Trader Ltd",
  organization_number: "998877",
  phone_number: "+44 7700 900000",
  billing_address: {
    street_address: "Mill Lane",
    building: "Mill House",
    postal_code: "TN23 1AA",
    city: "Ashford",
  },
};

/**
 * An address form the tile must never write into, the two company inputs
 * `fillCompanyData()` addresses by id, and the tile's own capture mount.
 *
 * `#shipping-country_id` is what `twoGatewayInvoiceRoleCountryField()` resolves
 * with no billing-as-shipping checkbox on the page, and the address inputs are
 * nested one level below it so the resolution has an actual walk to make — a
 * flat fixture would pass with the walk removed entirely.
 *
 * The `data-two-capture-*` pair is how the shared controller finds this mount;
 * without it no popover is bound and the chips never exist.
 *
 * @returns {void}
 */
function installAddressForm() {
  document.body.innerHTML =
    '<div id="checkout">' +
    '<div id="addr-wrap">' +
    '<select id="shipping-country_id" name="country_id">' +
    '<option value="GB" selected>GB</option>' +
    "</select>" +
    '<div id="addr-fields">' +
    '<input name="city" />' +
    '<input name="postcode" />' +
    '<input name="street[0]" />' +
    '<input name="street[1]" />' +
    '<input name="telephone" />' +
    "</div>" +
    "</div>" +
    '<div class="two-company-search" data-two-capture-host="tile">' +
    '<input id="company_name" name="payment[company_name]" data-name="company_name"' +
    " data-two-capture-field />" +
    "</div>" +
    '<input id="company_id" name="payment[company_id]" data-name="company_id" />' +
    "</div>";
}

/**
 * Fail loudly if the mount produced no component.
 *
 * @param {Object|undefined} component
 * @returns {Object}
 */
function expectBootstrapped(component) {
  if (!component) {
    throw new Error(
      "bootstrap check: no Alpine component registered as `" +
        COMPONENT +
        "`. Every assertion below depends on the mounted component.",
    );
  }
  return component;
}

/**
 * Mount the tile and point the page-level capture controller at it.
 *
 * `initialize()` is deliberately NOT called: it fires three watchers and a
 * storage restore, none of which any test here is about. The quote is assigned
 * directly instead, which is what initialize() does with it anyway, and
 * `mountCompanyPopover()` is the one part of it this suite needs.
 *
 * @param {Object} [options]
 * @param {Object} [options.quote] replaces the component's quote
 * @param {Array} [options.extraRules] harness render rules
 * @returns {Object} `{component, capture, flow, panel, fetchStub, env, restore}`
 */
function mountTile(options) {
  const opts = options || {};
  const env = H.installHyvaEnvironment();
  const fetchStub = H.stubFetch();
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  installAddressForm();
  H.loadSharedHelpers(opts.extraRules);
  env.fireAlpineInit();

  const component = expectBootstrapped(
    H.mountComponent(env.alpineComponents[COMPONENT], {
      el: document.getElementById("checkout"),
    }),
  );

  component.quote = Object.assign(
    {
      quote_id: "test-quote-1",
      email: BUYER.email,
      billing_country_id: "GB",
      first_name: "Ada",
      last_name: "Lovelace",
      telephone: "+44 1234",
    },
    opts.quote || {},
  );
  // An intent dispatch is a second network round trip with its own debounce and
  // is not what any test here measures.
  component.isOrderIntentEnabled = "";
  component.mountCompanyPopover();

  const capture = env.captureControllers[env.captureControllers.length - 1];

  return {
    component: component,
    capture: capture,
    host: capture.host(),
    flow: capture.soleTrader(),
    panel: env.companyPanels[env.companyPanels.length - 1],
    fetchStub: fetchStub,
    env: env,
    restore: function () {
      consoleError.mockRestore();
      fetchStub.restore();
      env.restore();
      document.body.innerHTML = "";
    },
  };
}

describe("the host adapter the shared flow is given", () => {
  let tile;

  beforeEach(() => {
    tile = mountTile();
  });

  afterEach(() => tile.restore());

  test.each(H.CAPTURE_HOST_CONTRACT.map((member) => [member]))(
    "carries %s",
    (member) => {
      // The controller throws on a partial adapter, and it throws deep inside a
      // buyer's flow rather than at boot.
      expect(typeof tile.host[member]).toBe("function");
    },
  );

  test.each([
    ["tokensUrl", [], REST_BASE + "/rest/V1/two/get-tokens", "the token mint"],
    [
      "supportedCompanyTypesUrl",
      ["no"],
      REST_BASE + "/rest/V1/two/supported-company-types/no",
      "the registry relay",
    ],
    [
      "supportedCountriesUrl",
      [],
      REST_BASE + "/rest/V1/two/supported-countries",
      "the registry's supported-countries relay",
    ],
  ])("%s builds the store's own REST URL (%s)", (member, args, expected) => {
    // The plugin's server-side relay, never the API direct: the merchant API
    // key must not reach the browser.
    expect(tile.host[member].apply(null, args)).toBe(expected);
  });

  test("the quote id the mint is made for is the quote's own", () => {
    expect(tile.host.quoteId()).toBe("test-quote-1");
  });

  test("this checkout's buyer read carries no client identification", () => {
    expect(tile.host.apiClientParams({})).toEqual({});
  });

  test("clearField blanks the mounted field and tells this surface", () => {
    const field = document.getElementById("company_name");
    field.value = "Something Ltd";
    tile.component.search = "Something Ltd";

    tile.host.clearField(
      '[data-two-capture-host="tile"] input[data-two-capture-field]',
    );

    expect(field.value).toBe("");
    expect(tile.component.search).toBe("");
  });

  test("revertAutofilledAddress is a no-op this checkout can survive", () => {
    // Nothing here records what an autofill wrote, so there is nothing to take
    // back out — but the controller calls it on every country change.
    expect(() => tile.host.revertAutofilledAddress()).not.toThrow();
  });

  test.each([
    [
      '{"X-WAF-TOKEN": "waf-abc123"}',
      { "X-WAF-TOKEN": "waf-abc123" },
      "configured headers are relayed",
    ],
    ["{}", {}, "the default carries no headers at all"],
  ])(
    "custom headers %p reach the flow's own config (%s)",
    (configuredJson, expected) => {
      // The buyer-cookie read behind this config is the shared flow's own
      // fetch — untestable here (see file header) — so this only pins that
      // the value reaches it, the same way checkoutApiUrl and brand do.
      tile.restore();
      tile = mountTile({
        extraRules: [
          [
            /^json_encode\(\s*\$customHeaders[\s\S]*?\)(?:\s*\?:\s*\S+)?$/,
            configuredJson,
          ],
        ],
      });

      expect(tile.capture.config().customHeaders).toEqual(expected);
    },
  );
});

describe("sole-trader availability", () => {
  let tile;

  afterEach(() => tile.restore());

  test.each([
    ["registry offers sole traders", ["LIMITED_COMPANY", "SOLE_TRADER"], true],
    ["business-only country", ["LIMITED_COMPANY"], false],
    ["registry answered nothing", [], false],
  ])("%s — the chip follows the answer", async (_label, types, expected) => {
    tile = mountTile();

    const pending = tile.capture.refreshSoleTraderAvailability();
    tile.fetchStub.last().respond(types);
    await pending;

    expect(tile.env.identity.soleTraderAvailable()).toBe(expected);
    expect(tile.panel.options.isChipVisible("soletrader")).toBe(expected);
  });

  test("the lookup follows the INVOICE-ROLE address, the signup follows the quote", async () => {
    // Two different questions with two different authorities, and the fixture
    // makes them disagree. The registry answer is about the address the company
    // is being captured for (TWO-25461 §1a.3); the signup country decides which
    // identity checks the buyer faces, so it is server-resolved and a DOM read
    // there would let them pick their own (PDEV-4669).
    tile = mountTile({ quote: { billing_country_id: "GB" } });
    document.getElementById("shipping-country_id").innerHTML =
      '<option value="NO" selected>NO</option>';

    const pending = tile.capture.refreshSoleTraderAvailability();
    const url = tile.fetchStub.last().url;
    tile.fetchStub.last().respond(["SOLE_TRADER"]);
    await pending;

    expect(url).toBe(REST_BASE + "/rest/V1/two/supported-company-types/no");
    expect(tile.host.signupCountry()).toBe("GB");
  });
});

describe("the hosted signup (PDEV-4669)", () => {
  let tile;

  afterEach(() => tile.restore());

  /** @returns {Object} the sole-trader chip's definition */
  function soleTraderChip() {
    return tile.panel.options
      .getChips()
      .find((chip) => chip.mode === "soletrader");
  }

  test.each([
    ["a resolved country", "US", "US"],
    ["lower-cased on the quote", "gb", "GB"],
    ["no country resolved", "", ""],
  ])("signupCountry — %s", (_label, billingCountryId, expected) => {
    tile = mountTile({ quote: { billing_country_id: billingCountryId } });

    expect(tile.host.signupCountry()).toBe(expected);
  });

  test("the country comes from the quote even when the address form says otherwise", () => {
    // The compliance rule this feature exists for. The popup renders its
    // country-specific identity step (US biometric consent, for one) off this
    // value; sourcing it from a field the buyer controls would let them choose
    // which checks they face.
    tile = mountTile({ quote: { billing_country_id: "US" } });
    const countryField = document.getElementById("shipping-country_id");
    countryField.innerHTML =
      '<option value="GB" selected>GB</option><option value="NO">NO</option>';
    countryField.value = "GB";

    expect(tile.host.signupCountry()).toBe("US");
  });

  test.each([
    ["email", "sole@trader.test", "who the hosted form authenticates"],
    ["first_name", "Ada", "as the quote holds it"],
    ["last_name", "Lovelace", "likewise"],
    ["phone_number", "+44 1234", "likewise"],
  ])("the prefill's %s is the quote's %s (%s)", (key, expected) => {
    // Every value is the quote's, so the hosted form the buyer lands on
    // describes the order they are placing.
    tile = mountTile();

    expect(tile.host.signupPrefill()[key]).toBe(expected);
  });

  test("the prefill's billing country is the server-resolved one too", () => {
    tile = mountTile({ quote: { billing_country_id: "us" } });

    expect(tile.host.signupPrefill().billing_address.country_code).toBe("US");
  });

  test("the prefill carries the company the buyer has captured so far", () => {
    tile = mountTile();
    tile.env.identity.write({ companyName: "Half Typed Ltd" });

    expect(tile.host.signupPrefill().company_name).toBe("Half Typed Ltd");
  });

  test("the chip reaches the shared flow's signup", () => {
    tile = mountTile();

    soleTraderChip().onActivate();

    expect(tile.flow.calls).toContain("launchSignup");
    expect(tile.env.identity.captureMode()).toBe("soletrader");
  });

  test("clicking the chip again raises the open popup rather than opening a second", () => {
    // Returning focus to the page is what takes the popup down, so the one
    // gesture that means "the popup is what I want" must not replace it.
    tile = mountTile();
    tile.flow.popupOpen = true;

    soleTraderChip().onActivate();

    expect(tile.flow.calls).toContain("focusSignupPopup");
    expect(tile.flow.calls).not.toContain("launchSignup");
  });

  test("a blocked popup raises the on-page fallback, and the link relaunches it", () => {
    tile = mountTile();

    tile.flow.showSignupPrompt(true);

    expect(tile.component.showPopupMessage).toBe(true);
    expect(tile.component.soleTraderPopupMessageVisible).toBe(true);

    tile.component.openSoleTraderSignupFromLink();

    expect(tile.flow.calls).toContain("retrySignup");
  });

  test("the fallback is withdrawn once the signup has answered", () => {
    tile = mountTile();
    tile.flow.showSignupPrompt(true);

    tile.flow.showSignupPrompt(false);

    expect(tile.component.showPopupMessage).toBe(false);
  });

  test("'select a different sole trader' is offered only once one is adopted", () => {
    // The hosted flow needs something to replace.
    tile = mountTile();
    expect(tile.component.selectDifferentSoleTraderVisible).toBe(false);

    soleTraderChip().onActivate();
    tile.capture.adoptSoleTrader(BUYER);

    expect(tile.component.selectDifferentSoleTraderVisible).toBe(true);

    tile.component.selectDifferentSoleTrader();

    expect(tile.flow.calls).toContain("selectDifferentSoleTrader");
  });

  test("the spinner follows the flow's own busy state", () => {
    // The token mint runs before the hosted signup can open, so the wait is
    // real and needs saying.
    tile = mountTile();
    expect(tile.component.soleTraderSpinnerVisible).toBe(false);

    tile.env.identity.beginFlight();

    expect(tile.component.soleTraderSpinnerVisible).toBe(true);
  });

  test("a signup that fails surfaces the merchant's own wording", () => {
    // The shared flow hands its own English literal; this checkout's brand may
    // have configured a replacement, and that one wins.
    tile = mountTile();

    tile.host.showError("Could not complete sole trader signup.");

    expect(tile.env.messages).toHaveLength(1);
    expect(tile.env.messages[0][0].type).toBe("error");
    expect(tile.env.messages[0][0].text).toBe(H.ESCAPED_STRING);
  });
});

describe("what an adopted sole trader writes into this checkout", () => {
  let tile;

  afterEach(() => tile.restore());

  test.each([
    ['input[name="city"]', "the town"],
    ['input[name="postcode"]', "the postcode"],
    ['input[name="street[0]"]', "line 1"],
    ['input[name="street[1]"]', "line 2"],
  ])("applyBuyerAddress leaves %s empty (%s)", (selector) => {
    // The tile is the invoice-role SUBMIT surface and has no address form of
    // its own; filling a form the buyer is not looking at is forbidden.
    tile = mountTile();

    tile.host.applyBuyerAddress(BUYER.billing_address);

    expect(document.querySelector(selector).value).toBe("");
  });

  test.each([
    [AUTOPOPULATION_ON, "autopopulation on"],
    [undefined, "autopopulation off"],
  ])("applyTelephone writes nothing from the tile (%#, %s)", (extraRules) => {
    // Same reason as the address above, so the merchant's autopopulation
    // setting cannot make the tile reach a form either.
    tile = mountTile({ extraRules: extraRules });
    document.querySelector('input[name="telephone"]').value = "+44 typed";

    tile.host.applyTelephone(BUYER.phone_number);

    expect(document.querySelector('input[name="telephone"]').value).toBe(
      "+44 typed",
    );
  });

  test("an adopted sole trader reaches the billing company record", () => {
    // The tile is rebuilt by every Magewire re-render and initialize() restores
    // from this record. An adoption that stopped at the DOM would be undone by
    // the next totals update.
    tile = mountTile();

    tile.capture.adoptSoleTrader(BUYER);

    const stored = JSON.parse(tile.env.storage[H.BILLING_COMPANY_KEY]);
    expect(stored.company_name).toBe("Sole Trader Ltd");
    expect(stored.company_id).toBe("998877");
    expect(stored.manual_mode).toBe(false);
  });

  test("the adopted number counts as vouched, so its field stays locked", () => {
    // It came from the registry through the server-side autofill record, which
    // is the same standing an ordinary search pick's number has.
    tile = mountTile();

    tile.capture.adoptSoleTrader(BUYER);

    expect(tile.component.companyIdSource).toBe("registry");
    expect(tile.component.companyIdDisabled).toBe(true);
  });

  test("the identity reaches the inputs the order submits", () => {
    tile = mountTile();

    tile.capture.adoptSoleTrader(BUYER);

    expect(document.getElementById("company_name").value).toBe(
      "Sole Trader Ltd",
    );
    expect(document.getElementById("company_id").value).toBe("998877");
  });

  test("a sole trader with no trading name writes no name over the pair", () => {
    // Writing a number under whatever name happened to be in the field is a
    // mismatched pair, which is the defect the selection-authority work closed.
    tile = mountTile();

    tile.capture.adoptSoleTrader(
      Object.assign({}, BUYER, { company_name: "" }),
    );

    expect(tile.component.companyName).toBe("");
  });

  test("leaving sole-trader mode discards the identity it captured, storage included", () => {
    tile = mountTile();
    tile.env.identity.captureMode("soletrader");
    tile.capture.adoptSoleTrader(BUYER);

    tile.capture.registeredMode();

    const stored = JSON.parse(tile.env.storage[H.BILLING_COMPANY_KEY]);
    expect(tile.component.companyName).toBe("");
    expect(stored.company_name).toBe("");
    expect(stored.company_id).toBe("");
    expect(tile.flow.calls).toContain("forgetAdoptions");
    // The input that SUBMITS too: the commit hook returns early on an empty
    // name, so nothing else takes the discarded sole trader out of the order.
    expect(document.getElementById("company_name").value).toBe("");
  });

  test("registeredMode() leaves a registered company alone", () => {
    // It is also the tile's initial state, so it runs on a component holding a
    // perfectly good registered company.
    tile = mountTile();
    tile.capture.selectCompany({
      text: "Registered Ltd",
      companyId: "12345678",
    });

    tile.capture.registeredMode();

    expect(tile.component.companyName).toBe("Registered Ltd");
  });
});
