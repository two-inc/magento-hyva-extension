/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 / PDEV-4669 — the sole-trader half of the payment tile.
 *
 * This flow is a PORT, not a new design: Hyvä's checkout never loaded the Luma
 * renderer that owns it, so every step below had no Alpine equivalent at all.
 * The assertions are therefore mostly about the PROVENANCE of a value rather
 * than its appearance, because the two ways this port can be wrong are both
 * invisible on screen:
 *
 *  - a value read from the DOM where it has to come from the server. The
 *    `country` param on the signup URL is the compliance-sensitive one
 *    (PDEV-4669): it decides which country's identity verification the buyer
 *    faces, so a DOM-fed value would let them pick. The suite proves the
 *    builder ignores an address form that disagrees with the quote.
 *  - a binding that names nothing. Under this checkout's CSP-friendly Alpine an
 *    attribute expression is a KEY LOOKUP, so a `:class` naming a getter the
 *    component does not define resolves to undefined and the chip silently
 *    never paints. Every binding in the markup is checked against the mounted
 *    component.
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
/** The base URL the harness emits for `$checkoutApiUrl`. */
const CHECKOUT_API = "https://checkout-api.test.invalid";
/** `$checkoutPageUrl` resolves through the harness's escapeUrl rule. */
const CHECKOUT_PAGE = "/checkout";

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
 * The address form the tile writes into, plus the two company inputs
 * `fillCompanyData()` addresses by id.
 *
 * `#shipping-country_id` is what `twoGatewayInvoiceRoleCountryField()` resolves
 * with no billing-as-shipping checkbox on the page, and the address inputs are
 * nested one level below it so the resolution has an actual walk to make — a
 * flat fixture would pass with the walk removed entirely.
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
    '<input id="company_name" name="payment[company_name]" data-name="company_name" />' +
    '<input id="company_id" name="payment[company_id]" data-name="company_id" />' +
    "</div>";
}

/**
 * Fail loudly if the mount produced no component.
 *
 * The chips are server-rendered markup, so a suite that skipped the mount would
 * still find them and pass. This is what makes "the component never registered"
 * a red test rather than an invisible one.
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
 * Mount the tile with the sole-trader state ready to drive.
 *
 * `initialize()` is deliberately NOT called: it fires a registry lookup, three
 * watchers and a storage restore, none of which any test here is about, and all
 * of which would have to be settled before the real subject could be reached.
 * The quote is assigned directly instead, which is what initialize() does with
 * it anyway.
 *
 * @param {Object} [options]
 * @param {Object} [options.quote] replaces the component's quote
 * @param {Array} [options.extraRules] harness render rules
 * @returns {Object} `{component, fetchStub, env, restore}`
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

  return {
    component: component,
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

/** A `message` event as the signup popup posts one. */
function popupMessage(component, data) {
  return {
    origin: component.checkoutPageUrl,
    source: component._soleTraderPopupWindow,
    data: data,
  };
}

describe("toggle visibility gating", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  test.each([
    ["registry offers sole traders", ["LIMITED_COMPANY", "SOLE_TRADER"], true],
    ["business-only country", ["LIMITED_COMPANY"], false],
    ["registry answered nothing", [], false],
  ])("%s", async (_label, types, expected) => {
    tile = mountTile();

    const pending = tile.component.refreshSoleTraderAvailability();
    tile.fetchStub.last().respond(types);
    await pending;

    expect(tile.component.showModeTab).toBe(expected);
    expect(tile.component.soleTraderTabVisible).toBe(expected);
  });

  test("the lookup is made for the QUOTE's billing country, not the address form's", async () => {
    // The fixture's country select says GB while the quote says NO. The tile is
    // not in an address form and its company is the invoice-role one, so the
    // quote is the authority — and a lookup made against the form's country
    // would offer sole trader for a country the order is not billed in.
    tile = mountTile({ quote: { billing_country_id: "NO" } });

    const pending = tile.component.refreshSoleTraderAvailability();
    const url = tile.fetchStub.last().url;
    tile.fetchStub.last().respond(["SOLE_TRADER"]);
    await pending;

    expect(url).toBe(REST_BASE + "/rest/V1/two/supported-company-types/no");
  });

  test("a country already answered is not asked again", async () => {
    tile = mountTile();

    const first = tile.component.refreshSoleTraderAvailability();
    tile.fetchStub.last().respond(["SOLE_TRADER"]);
    await first;
    const callsAfterFirst = tile.fetchStub.calls.length;

    await tile.component.refreshSoleTraderAvailability();

    expect(tile.fetchStub.calls.length).toBe(callsAfterFirst);
    expect(tile.component.showModeTab).toBe(true);
  });

  test("a failed lookup is NOT memoized, so the next attempt retries", async () => {
    // A transport failure inherited as "this country is business-only" would
    // hide the chip for the rest of the checkout with nothing able to restore
    // it. The country has to stay askable.
    tile = mountTile();

    const first = tile.component.refreshSoleTraderAvailability();
    tile.fetchStub.last().respondWithStatus(500);
    await first;

    expect(tile.component.showModeTab).toBe(false);

    const second = tile.component.refreshSoleTraderAvailability();
    tile.fetchStub.last().respond(["SOLE_TRADER"]);
    await second;

    expect(tile.component.showModeTab).toBe(true);
  });

  test("losing sole-trader support mid-checkout leaves the mode it was in", async () => {
    tile = mountTile();
    tile.component.showModeTab = true;
    tile.component.showSoleTrader = true;

    const pending = tile.component.refreshSoleTraderAvailability();
    tile.fetchStub.last().respond(["LIMITED_COMPANY"]);
    await pending;

    expect(tile.component.showModeTab).toBe(false);
    expect(tile.component.showSoleTrader).toBe(false);
  });
});

describe("token minting", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  test("the chip click POSTs the quote id to get-tokens and keeps both tokens", async () => {
    tile = mountTile();
    tile.component.showModeTab = true;

    const pending = tile.component.lookupSoleTrader();
    const mint = tile.fetchStub.last();

    expect(mint.url).toBe(REST_BASE + "/rest/V1/two/get-tokens");
    expect(mint.init.method).toBe("POST");
    expect(JSON.parse(mint.init.body)).toEqual({ cartId: "test-quote-1" });

    mint.respond([{ delegation_token: "dt-1", autofill_token: "at-1" }]);
    await H.flushPromises();
    tile.fetchStub.last().respond(BUYER);
    await pending;

    expect(tile.component.delegationToken).toBe("dt-1");
    expect(tile.component.autofillToken).toBe("at-1");
    expect(tile.component.hasSignupTokens()).toBe(true);
  });

  test("nothing is minted for a country with no sole traders", async () => {
    // The chip is not on screen at all in that configuration, so a mint would
    // be a request made for a control the buyer cannot have clicked.
    tile = mountTile();
    tile.component.showModeTab = false;

    await tile.component.lookupSoleTrader();

    expect(tile.fetchStub.calls.length).toBe(0);
  });

  test("the buyer read carries the token this lookup minted", async () => {
    tile = mountTile();
    tile.component.showModeTab = true;

    const pending = tile.component.lookupSoleTrader();
    tile.fetchStub
      .last()
      .respond([{ delegation_token: "dt-1", autofill_token: "at-1" }]);
    await H.flushPromises();

    const read = tile.fetchStub.last();
    expect(read.url).toBe(CHECKOUT_API + "/autofill/v1/buyer/current");
    expect(read.init.headers["two-delegated-authority-token"]).toBe("at-1");
    expect(read.init.credentials).toBe("include");

    read.respond(BUYER);
    await pending;
  });

  test("a cookie buyer whose email is not the quote's does not count", async () => {
    // Nothing on the passive path proves the cookie's buyer is the person
    // checking out, so an unmatched record must send them to signup instead of
    // adopting someone else's identity.
    tile = mountTile();
    tile.component.showModeTab = true;

    const pending = tile.component.lookupSoleTrader();
    tile.fetchStub
      .last()
      .respond([{ delegation_token: "dt-1", autofill_token: "at-1" }]);
    await H.flushPromises();
    tile.fetchStub
      .last()
      .respond(Object.assign({}, BUYER, { email: "someone@else.test" }));
    await pending;

    expect(tile.component.soleTraderLookup.ready).toBe(true);
    expect(tile.component.soleTraderLookup.matches).toBe(false);
  });

  test("a repeated click for the same email returns the outstanding chain rather than re-minting", async () => {
    // The dedupe key is set synchronously, so a second click landing mid-flight
    // would otherwise resume immediately on a lookup that has recorded nothing
    // and minted nothing — no adoption, no popup, and no link fallback either.
    tile = mountTile();
    tile.component.showModeTab = true;

    const first = tile.component.lookupSoleTrader();
    const second = tile.component.lookupSoleTrader();
    const mintCalls = tile.fetchStub.calls.filter(
      (call) => call.url.indexOf("get-tokens") !== -1,
    );

    expect(mintCalls.length).toBe(1);

    tile.fetchStub
      .last()
      .respond([{ delegation_token: "dt-1", autofill_token: "at-1" }]);
    await H.flushPromises();
    tile.fetchStub.last().respond(BUYER);
    await Promise.all([first, second]);

    expect(tile.component.soleTraderLookup.matches).toBe(true);
  });
});

describe("signup popup URL (PDEV-4669)", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  /** Mint tokens without going through the lookup's email dedupe. */
  function withTokens(component) {
    component.delegationToken = "dt-1";
    component.autofillToken = "at-1";
    component.showSoleTrader = true;
    return component;
  }

  /** Record `window.open` and hand back what it was called with. */
  function stubOpen() {
    const opened = [];
    const original = window.open;
    window.open = function (url, target, features) {
      opened.push({ url: url, target: target, features: features });
      return { closed: false, close: function () {} };
    };
    return {
      opened: opened,
      urlParams: function () {
        return new URL(opened[0].url, "https://store.test.invalid")
          .searchParams;
      },
      restore: function () {
        window.open = original;
      },
    };
  }

  test.each([
    ["a resolved country", "US", "US"],
    ["lower-cased on the quote", "gb", "GB"],
    ["no country resolved", "", null],
  ])("the country param — %s", (_label, billingCountryId, expected) => {
    tile = mountTile({ quote: { billing_country_id: billingCountryId } });
    withTokens(tile.component);
    const open = stubOpen();

    try {
      tile.component.openSoleTraderSignup();
      expect(open.urlParams().get("country")).toBe(expected);
    } finally {
      open.restore();
    }
  });

  test("the country comes from the quote even when the address form says otherwise", () => {
    // The compliance rule this feature exists for. The popup renders its
    // country-specific identity step (US biometric consent, for one) off this
    // param; sourcing it from a field the buyer controls would let them choose
    // which checks they face. The fixture's country select says GB throughout.
    tile = mountTile({ quote: { billing_country_id: "US" } });
    withTokens(tile.component);
    const countryField = document.getElementById("shipping-country_id");
    countryField.innerHTML =
      '<option value="GB" selected>GB</option><option value="NO">NO</option>';
    countryField.value = "GB";
    const open = stubOpen();

    try {
      tile.component.openSoleTraderSignup();
      expect(open.urlParams().get("country")).toBe("US");
    } finally {
      open.restore();
    }
  });

  test("the URL builder itself never reads the DOM", () => {
    // Belt and braces on the rule above, and the reason the builder is a free
    // function rather than a method: with a country field on the page saying
    // something else entirely, a builder given no country must still produce
    // none. A builder that could reach the DOM would be one refactor away from
    // reintroducing the defect.
    tile = mountTile();
    document.getElementById("shipping-country_id").value = "GB";

    const url = window.twoGatewaySoleTraderSignupUrl({
      checkoutPageUrl: CHECKOUT_PAGE,
      delegationToken: "dt-1",
      autofillToken: "at-1",
      autofillData: "e30=",
    });

    expect(
      new URL(url, "https://store.test.invalid").searchParams.get("country"),
    ).toBeNull();
  });

  test("the URL carries both tokens and the base64 prefill", () => {
    tile = mountTile();
    withTokens(tile.component);
    const open = stubOpen();

    try {
      tile.component.openSoleTraderSignup();
      const params = open.urlParams();

      expect(
        open.opened[0].url.indexOf(CHECKOUT_PAGE + "/soletrader/signup?"),
      ).toBe(0);
      expect(params.get("businessToken")).toBe("dt-1");
      expect(params.get("autofillToken")).toBe("at-1");
      expect(JSON.parse(atob(params.get("autofillData"))).email).toBe(
        BUYER.email,
      );
    } finally {
      open.restore();
    }
  });

  test("no popup opens before the tokens exist", () => {
    // A signup link built with an empty businessToken is rejected by the hosted
    // flow, so offering it is worse than offering nothing.
    tile = mountTile();
    tile.component.showSoleTrader = true;
    const open = stubOpen();

    try {
      expect(tile.component.openSoleTraderSignup()).toBeNull();
      expect(open.opened.length).toBe(0);
    } finally {
      open.restore();
    }
  });

  test("'select a different sole trader' suppresses the hosted flow's auto-pick", () => {
    tile = mountTile();
    withTokens(tile.component);
    const open = stubOpen();

    try {
      tile.component.selectDifferentSoleTrader();
      expect(open.urlParams().get("autoselect")).toBe("false");
    } finally {
      open.restore();
    }
  });

  test("a second popup closes the first rather than running two", () => {
    // A popup left running can post a stale ACCEPTED that wins a race against
    // whichever one the buyer actually completed.
    tile = mountTile();
    withTokens(tile.component);
    const closed = [];
    const original = window.open;
    window.open = function () {
      const handle = { closed: false };
      handle.close = function () {
        handle.closed = true;
        closed.push(handle);
      };
      return handle;
    };

    try {
      const first = tile.component.openSoleTraderSignup();
      tile.component.openSoleTraderSignup();
      expect(closed).toContain(first);
    } finally {
      window.open = original;
    }
  });
});

describe("autofill on signup completion", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  /** Put the component where an ACCEPTED message is legitimate. */
  function awaitingPopup(component) {
    component.showSoleTrader = true;
    component.autofillToken = "at-1";
    component.delegationToken = "dt-1";
    component._soleTraderPopupWindow = { closed: false, close() {} };
    return component;
  }

  test("ACCEPTED re-reads the buyer and writes the identity and the address", async () => {
    tile = mountTile();
    awaitingPopup(tile.component);

    tile.component.handleSoleTraderPopupMessage(
      popupMessage(tile.component, "ACCEPTED"),
    );
    tile.fetchStub.last().respond(BUYER);
    await H.flushPromises();

    expect(tile.component.companyName).toBe("Sole Trader Ltd");
    expect(tile.component.companyId).toBe("998877");
    expect(document.getElementById("company_name").value).toBe(
      "Sole Trader Ltd",
    );
    expect(document.getElementById("company_id").value).toBe("998877");
    expect(document.querySelector('input[name="city"]').value).toBe("Ashford");
    expect(document.querySelector('input[name="postcode"]').value).toBe(
      "TN23 1AA",
    );
    // Building present ⇒ it takes line 1 and the street moves to line 2.
    expect(document.querySelector('input[name="street[0]"]').value).toBe(
      "Mill House",
    );
    expect(document.querySelector('input[name="street[1]"]').value).toBe(
      "Mill Lane",
    );
  });

  test("the ACCEPTED path does NOT require the buyer's email to match the quote's", async () => {
    // The buyer has just authenticated server-side, so the email they
    // authenticated with IS the identity — the order's contact email has no say
    // in it. Requiring a match here left the company field permanently blank
    // with no route forward (TWO-25461).
    tile = mountTile();
    awaitingPopup(tile.component);

    tile.component.handleSoleTraderPopupMessage(
      popupMessage(tile.component, "ACCEPTED"),
    );
    tile.fetchStub
      .last()
      .respond(Object.assign({}, BUYER, { email: "changed@trader.test" }));
    await H.flushPromises();

    expect(tile.component.companyName).toBe("Sole Trader Ltd");
  });

  test("the phone number is written when address autopopulation is ON", async () => {
    tile = mountTile({ extraRules: AUTOPOPULATION_ON });
    awaitingPopup(tile.component);

    expect(tile.component.isAddressAutopopulationEnabled).toBe(true);

    tile.component.handleSoleTraderPopupMessage(
      popupMessage(tile.component, "ACCEPTED"),
    );
    tile.fetchStub.last().respond(BUYER);
    await H.flushPromises();

    expect(document.querySelector('input[name="telephone"]').value).toBe(
      BUYER.phone_number,
    );
  });

  test("the phone number is left alone when address autopopulation is OFF", async () => {
    tile = mountTile();
    awaitingPopup(tile.component);
    document.querySelector('input[name="telephone"]').value = "+44 typed";

    tile.component.handleSoleTraderPopupMessage(
      popupMessage(tile.component, "ACCEPTED"),
    );
    tile.fetchStub.last().respond(BUYER);
    await H.flushPromises();

    expect(document.querySelector('input[name="telephone"]').value).toBe(
      "+44 typed",
    );
    // The ADDRESS is still written: its gate is TWO-25461 §5, not this setting.
    expect(document.querySelector('input[name="city"]').value).toBe("Ashford");
  });

  test("a record carrying no phone number does not blank the one the buyer typed", async () => {
    tile = mountTile({ extraRules: AUTOPOPULATION_ON });
    awaitingPopup(tile.component);
    document.querySelector('input[name="telephone"]').value = "+44 typed";

    tile.component.handleSoleTraderPopupMessage(
      popupMessage(tile.component, "ACCEPTED"),
    );
    tile.fetchStub
      .last()
      .respond(Object.assign({}, BUYER, { phone_number: "" }));
    await H.flushPromises();

    expect(document.querySelector('input[name="telephone"]').value).toBe(
      "+44 typed",
    );
  });

  test("a message from a popup that is not the tracked one is ignored", async () => {
    // Stale popups can outlive the adoption they belong to; one posting ACCEPTED
    // late must never overwrite a later identity.
    tile = mountTile();
    awaitingPopup(tile.component);

    tile.component.handleSoleTraderPopupMessage({
      origin: tile.component.checkoutPageUrl,
      source: { closed: true },
      data: "ACCEPTED",
    });
    await H.flushPromises();

    expect(tile.fetchStub.calls.length).toBe(0);
  });

  test("a message from another origin is ignored", async () => {
    tile = mountTile();
    awaitingPopup(tile.component);

    tile.component.handleSoleTraderPopupMessage({
      origin: "https://evil.test.invalid",
      source: tile.component._soleTraderPopupWindow,
      data: "ACCEPTED",
    });
    await H.flushPromises();

    expect(tile.fetchStub.calls.length).toBe(0);
  });

  test("a non-ACCEPTED reply surfaces the sole-trader error message", () => {
    tile = mountTile();
    awaitingPopup(tile.component);

    tile.component.handleSoleTraderPopupMessage(
      popupMessage(tile.component, "REJECTED"),
    );

    expect(tile.env.messages.length).toBe(1);
    expect(tile.env.messages[0][0].type).toBe("error");
    expect(tile.env.messages[0][0].text).toBe(H.ESCAPED_STRING);
  });
});

describe("persistence through the company-save path", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  test("an adopted sole trader is written to the billing company record", () => {
    // The tile is rebuilt by every Magewire re-render and initialize() restores
    // from this record. An adoption that stopped at the DOM would be undone by
    // the next totals update.
    tile = mountTile();

    tile.component.adoptSoleTraderBuyer(BUYER);

    const stored = JSON.parse(tile.env.storage[H.BILLING_COMPANY_KEY]);
    expect(stored.company_name).toBe("Sole Trader Ltd");
    expect(stored.company_id).toBe("998877");
    expect(stored.manual_mode).toBe(false);
  });

  test("the adopted number counts as vouched, so its field stays locked", () => {
    // It came from the registry through the server-side autofill record, which
    // is the same standing an ordinary search pick's number has.
    tile = mountTile();

    tile.component.adoptSoleTraderBuyer(BUYER);

    expect(tile.component.companyIdSource).toBe("registry");
    expect(tile.component.companyIdDisabled).toBe(true);
  });

  test("a sole trader with no trading name writes no identity, but still fills the address", () => {
    // Writing a number under whatever name happened to be in the field is a
    // mismatched pair, which is the defect the selection-authority work closed.
    tile = mountTile();

    tile.component.adoptSoleTraderBuyer(
      Object.assign({}, BUYER, { company_name: "" }),
    );

    expect(tile.component.companyName).toBe("");
    expect(document.querySelector('input[name="city"]').value).toBe("Ashford");
  });

  test("leaving sole-trader mode discards the identity it captured, storage included", () => {
    tile = mountTile();
    tile.component.adoptSoleTraderBuyer(BUYER);
    tile.component.showSoleTrader = true;

    tile.component.registeredOrganisationMode();

    const stored = JSON.parse(tile.env.storage[H.BILLING_COMPANY_KEY]);
    expect(tile.component.companyName).toBe("");
    expect(stored.company_name).toBe("");
    expect(stored.company_id).toBe("");
    expect(document.getElementById("company_name").value).toBe("");
  });

  test("registeredOrganisationMode() is a no-op when sole trader was never active", () => {
    // It is also the tile's initial state, so it runs on a component holding a
    // perfectly good registered company.
    tile = mountTile();
    tile.component.fillCompanyData("12345678", "Registered Ltd");

    tile.component.registeredOrganisationMode();

    expect(tile.component.companyName).toBe("Registered Ltd");
  });
});

describe("the wires between markup and component", () => {
  let tile;

  afterEach(() => tile && tile.restore());

  test.each([
    ['[data-name="mode_registered"]', ":class"],
    ['[data-name="mode_soletrader"]', ":class"],
    ['[data-name="soletrader_signup_link"]', "@click"],
    ['[data-name="select_different_soletrader"]', "@click"],
  ])("%s %s names a key the component defines", (selector, attribute) => {
    tile = mountTile();
    const name = H.readAlpineBinding(
      H.GATEWAY_METHOD_MARKUP_TEMPLATE,
      selector,
      attribute,
    );

    expect(name in tile.component).toBe(true);
  });

  test.each([
    [".two-mode-chips", "soleTraderTabVisible"],
    ['[data-name="mode_registered"]', null],
  ])("%s is bound to the component's own gate", (selector, expectedGate) => {
    tile = mountTile();
    const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
    const element = new DOMParser()
      .parseFromString(markup, "text/html")
      .querySelector(selector);

    expect(element).not.toBeNull();
    expect(element.getAttribute("x-show")).toBe(expectedGate);
    if (expectedGate) {
      expect(expectedGate in tile.component).toBe(true);
    }
  });

  test("the toggle renders in BOTH company-search-location modes", () => {
    // The sole-trader entry point is a property of the payment method, not of
    // where the company-search control happens to be mounted.
    [["1"], ["0"]].forEach((value) => {
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE, [
        [/^\$isCompanySearchInPaymentTile$/, value[0]],
      ]);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector('[data-name="mode_soletrader"]')).not.toBeNull();
    });
  });
});
