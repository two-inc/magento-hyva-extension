/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25461 §2. The two-address sync model: editable, mirrored, and pinned by
 * CONTENT rather than by a flag.
 *
 * What this replaces is the reason the file exists. The tile used to decide
 * whether the billing address was the buyer's own by asking whether a billing
 * company RECORD EXISTED — which latched permanently. Any write to that key,
 * including the bare `{quote_id}` stamp the new-order clear leaves behind,
 * stopped the shipping→billing sync for the rest of the checkout, and nothing
 * in the codebase could ever restart it. There was no resumption path at all.
 *
 * The model here is a pure content match, recomputed on every read:
 *
 *   - all tracked fields still match what the mirror would write → SYNCED
 *   - ONE tracked field differs → the WHOLE address is pinned, including the
 *     four fields the buyer never touched
 *   - the two agree again → synced again, by itself, with no control to press
 *
 * The tracked set is five fields, not two: country, company name, company id,
 * address line 2, region. A buyer typing into address line 2 is exactly as
 * strong a signal of independent editing as one retyping the company, and the
 * old two-field set could not see it.
 *
 * Own file rather than an addition to payment-fields-shipping-sync.test.js
 * because it loads the same template — whose `shipping-company-selected`
 * listener is anonymous and registered on `window`, so it is evaluated ONCE
 * here for the same reason.
 */

"use strict";

const H = require("./hyva-harness");

/**
 * The tile's own company pair, as the mirror writes it.
 *
 * Kept out of the address fixture below: these are the mirror's OUTPUT, not
 * part of the billing ADDRESS, and the distinction is load-bearing. The pin
 * reads the billing address form; if it read the tile's pair instead, a
 * collapse back to one address would leave the previous billing company sitting
 * in the tile and the pin would never release.
 */
const TILE_MARKUP = [
  '<div id="payment-root" x-data="twoGatewayHyvaPaymentMethodBase">',
  '  <input type="text" id="company_name" data-name="company_name" value="" />',
  '  <input type="text" id="company_id" data-name="company_id" value="" />',
  "</div>",
].join("\n");

/**
 * Two addresses that agree on every tracked field — the synced baseline every
 * pin case below is one edit away from.
 */
const MATCHING = {
  "shipping-country_id": "GB",
  "shipping-company": "Example Trading Ltd",
  "shipping-company_id": "12345678",
  "shipping-street1": "Floor 2",
  "shipping-region": "Kent",
  "billing-country_id": "GB",
  "billing-company": "Example Trading Ltd",
  "billing-company_id": "12345678",
  "billing-street1": "Floor 2",
  "billing-region": "Kent",
};

describe("billing address sync pin (content match)", () => {
  let env;
  const magewireHandlers = {};

  beforeAll(() => {
    env = H.installHyvaEnvironment();
    /*
     * Magewire is stubbed BEFORE the template loads and DOMContentLoaded is
     * dispatched by hand, because the collapse handler — the resumption path —
     * is registered inside that listener and jsdom has already fired the event
     * by the time a test file runs. Recording the callback rather than
     * asserting it was registered: what matters below is what it DOES.
     */
    global.Magewire = {
      on: (name, callback) => {
        magewireHandlers[name] = callback;
      },
    };
    // The publisher first: the bridge resolves the pin off `window` with a
    // permissive fallback, so without the publisher every mirror assertion here
    // would pass against a bridge that never consulted a pin at all.
    H.loadSharedHelpers();
    H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  });

  afterAll(() => {
    delete global.Magewire;
    env.restore();
  });

  beforeEach(() => {
    env.browserStorage.removeItem(H.COMPANY_SELECTION_KEY);
    env.browserStorage.removeItem(H.BILLING_COMPANY_KEY);
  });

  /**
   * Render the tile plus a shipping and a billing address form.
   *
   * `overrides` are applied over the matching baseline; a value of `null`
   * OMITS the field entirely, which is how "this form has no such field" is
   * expressed — a different fact from "the buyer left it blank".
   *
   * @param {Object} [overrides] tracked field id (without role prefix omitted) → value or null
   * @param {Object} [options]
   * @param {boolean} [options.hideBilling] wrap the billing form in a hidden container
   * @param {boolean} [options.dropBilling] render no billing form at all
   * @returns {void}
   */
  function renderAddresses(overrides, options) {
    const opts = options || {};
    const values = Object.assign({}, MATCHING, overrides || {});
    const field = (id) =>
      values[id] === null || values[id] === undefined
        ? ""
        : '<input type="text" id="' + id + '" value="' + values[id] + '" />';

    const shipping = [
      '<div id="shipping-form">',
      field("shipping-country_id"),
      field("shipping-company"),
      field("shipping-company_id"),
      field("shipping-street1"),
      field("shipping-region"),
      "</div>",
    ].join("\n");

    const billing = opts.dropBilling
      ? ""
      : [
          '<div id="billing-form"' +
            (opts.hideBilling ? ' class="hidden"' : "") +
            ">",
          field("billing-country_id"),
          field("billing-company"),
          field("billing-company_id"),
          field("billing-street1"),
          field("billing-region"),
          "</div>",
        ].join("\n");

    document.body.innerHTML = [TILE_MARKUP, shipping, billing].join("\n");
  }

  /**
   * Seed the stored shipping selection and fire the event the shipping picker
   * fires, which is the mirror's own entry point.
   *
   * @param {string} companyName
   * @param {string} companyId
   * @returns {void}
   */
  function mirrorShippingCompany(companyName, companyId) {
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({
        quote_id: "test-quote-1",
        company_name: companyName,
        company_id: companyId,
        manual_mode: false,
      }),
    );
    window.dispatchEvent(new Event("shipping-company-selected"));
  }

  /** @returns {string} whatever the mirror last wrote into the tile's name field */
  function tileCompanyName() {
    return document.querySelector('[data-name="company_name"]').value;
  }

  /*
   * ------------------------------------------------------------------
   * (a) The pin check, across every one of the five tracked fields
   * ------------------------------------------------------------------
   *
   * `expectedPinned` and `expectedMirrorWrites` are asserted TOGETHER on
   * purpose. The first is the helper's own answer; the second is whether the
   * bridge actually respected it. A pin nothing consults is the failure mode
   * this whole change exists to avoid, and asserting only the boolean would not
   * see it.
   *
   * The rows that edit a NON-company field are the whole-address granularity
   * proof: the company fields still match perfectly, and the mirror must still
   * refuse to write them.
   */
  const PIN_CASES = [
    {
      edit: {},
      pinned: false,
      mirrors: true,
      description: "two addresses agreeing on every tracked field stay synced",
    },
    {
      edit: { "billing-country_id": "IE" },
      pinned: true,
      mirrors: false,
      description: "a country edit pins the address, company fields included",
    },
    {
      edit: { "billing-company": "Another Trading Ltd" },
      pinned: true,
      mirrors: false,
      description: "a company-name edit pins the address",
    },
    {
      edit: { "billing-company_id": "87654321" },
      pinned: true,
      mirrors: false,
      description: "a company-id edit pins the address",
    },
    {
      edit: { "billing-street1": "Floor 3" },
      pinned: true,
      mirrors: false,
      description:
        "an address line 2 edit pins — the field the old model could not see",
    },
    {
      edit: { "billing-region": "Surrey" },
      pinned: true,
      mirrors: false,
      description:
        "a region edit pins — the other field the old model could not see",
    },
    {
      edit: { "billing-company": "  example TRADING ltd  " },
      pinned: false,
      mirrors: true,
      description:
        "a difference of case and surrounding space only is not an edit",
    },
    {
      edit: { "billing-street1": "" },
      pinned: false,
      mirrors: true,
      description:
        "a blank billing field is waiting to be filled, not a mismatch",
    },
    {
      edit: { "billing-region": null },
      pinned: false,
      mirrors: true,
      description: "a field this address format does not have cannot pin",
    },
    {
      edit: { "billing-country_id": "IE", "billing-region": "Surrey" },
      pinned: true,
      mirrors: false,
      description: "two edits pin no harder than one",
    },
  ];

  test.each(PIN_CASES)("$description", ({ edit, pinned, mirrors }) => {
    renderAddresses(edit);

    expect(window.twoGatewayIsBillingAddressPinned()).toBe(pinned);

    mirrorShippingCompany("Mirrored Company Ltd", "99999999");
    expect(tileCompanyName()).toBe(mirrors ? "Mirrored Company Ltd" : "");
  });

  test("a hidden billing form holds nothing against the buyer", () => {
    // The checkout hides a step's form subtree rather than unmounting it in at
    // least some states, and a field the buyer cannot reach is not evidence
    // they edited it. This is also what makes the collapse case below work
    // whichever of the two the theme does.
    renderAddresses(
      { "billing-company": "Another Trading Ltd" },
      { hideBilling: true },
    );

    expect(window.twoGatewayIsBillingAddressPinned()).toBe(false);
  });

  test("the stored shipping company stands in for an absent address company field", () => {
    // With company search mounted in the payment tile the shipping ADDRESS form
    // carries no company field, but the mirror still has a company to write —
    // the stored selection. Without that substitution a billing company the
    // buyer typed would be compared against nothing and read as unedited.
    renderAddresses({
      "shipping-company": null,
      "shipping-company_id": null,
      "billing-company": "Another Trading Ltd",
    });
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({
        company_name: "Example Trading Ltd",
        company_id: "12345678",
      }),
    );

    expect(window.twoGatewayIsBillingAddressPinned()).toBe(true);
  });

  /*
   * ------------------------------------------------------------------
   * (c) Resumption, which the old model had no path to at all
   * ------------------------------------------------------------------
   */
  describe("resumption by collapsing to one address and reopening", () => {
    test.each([
      {
        collapse: { dropBilling: true },
        description: "resumes when the checkout unmounts the billing form",
      },
      {
        collapse: { hideBilling: true },
        description: "resumes when the checkout hides the billing form",
      },
    ])("$description", ({ collapse }) => {
      // 1. The buyer edits their billing address AND names their own billing
      //    company on the tile — the two independent ways this address becomes
      //    theirs. Pinned; the mirror refuses.
      renderAddresses({ "billing-company": "Buyer's Own Ltd" });
      window.twoGatewayWriteBillingCompany({
        quote_id: "test-quote-1",
        company_name: "Buyer's Own Ltd",
        company_id: "",
      });
      expect(window.twoGatewayIsBillingAddressPinned()).toBe(true);
      mirrorShippingCompany("First Mirror Ltd", "11111111");
      expect(tileCompanyName()).toBe("");

      // 2. The buyer ticks "billing same as shipping". Nothing else happens:
      //    no resume control is pressed and no pin flag is cleared, because
      //    there is no such control and no such flag. The record that justified
      //    the pin simply stops existing, and the same handler mirrors the
      //    shipping company across in the same breath.
      renderAddresses({}, collapse);
      magewireHandlers.billing_as_shipping_address_updated({
        billingAsShipping: true,
      });

      expect(Object.keys(window.twoGatewayReadBillingCompany()).length).toBe(0);
      expect(window.twoGatewayIsBillingAddressPinned()).toBe(false);
      expect(tileCompanyName()).toBe("First Mirror Ltd");

      // 3. And the sync stays live: a later shipping pick propagates, which
      //    under the record-existence model it never could — that model had no
      //    path back at all once any billing write had happened.
      mirrorShippingCompany("Second Mirror Ltd", "22222222");
      expect(tileCompanyName()).toBe("Second Mirror Ltd");

      // 4. Reopening the billing address re-matches, because the checkout
      //    reopens it as a copy of the shipping address. Still synced.
      renderAddresses({});
      expect(window.twoGatewayIsBillingAddressPinned()).toBe(false);
      mirrorShippingCompany("Third Mirror Ltd", "33333333");
      expect(tileCompanyName()).toBe("Third Mirror Ltd");
    });
  });
});

/*
 * ----------------------------------------------------------------------
 * (b) Field routing on an external address payload
 * ----------------------------------------------------------------------
 *
 * Own describe with its own environment: this exercises the ENGINE directly and
 * must not inherit the bridge's `window` listeners.
 */
describe("setAddressData field routing", () => {
  let env;
  let engine;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadSharedHelpers();
    engine = window.twoGatewayCompanySearchEngine({});
  });

  afterEach(() => {
    env.restore();
  });

  /**
   * An address form with both street lines, a city, a postcode and whichever
   * region control the case asks for.
   *
   * @param {string} regionControl '', 'select' or 'input'
   * @returns {HTMLElement} the container `setAddressData()` writes into
   */
  function renderForm(regionControl) {
    const region =
      regionControl === "select"
        ? '<select name="region_id"><option value="">--</option>' +
          '<option value="43">Kent</option><option value="51">Surrey</option></select>'
        : regionControl === "input"
          ? '<input type="text" name="region" value="" />'
          : "";
    document.body.innerHTML = [
      '<div id="address-form">',
      '  <input type="text" name="street[0]" value="PRE-LINE-1" />',
      '  <input type="text" name="street[1]" value="PRE-LINE-2" />',
      '  <input type="text" name="city" value="" />',
      '  <input type="text" name="postcode" value="" />',
      region,
      "</div>",
    ].join("\n");
    return document.getElementById("address-form");
  }

  /**
   * @param {HTMLElement} container
   * @param {string} name
   * @returns {string}
   */
  function valueOf(container, name) {
    const el = container.querySelector('[name="' + name + '"]');
    return el ? el.value : null;
  }

  /*
   * Every row is one payload, the region control the form renders for it, and
   * the fields it must land in.
   *
   * `expected` names only what the case is about; every key present is
   * asserted, and `street[1]` appearing with its PRE- value is the assertion
   * that the field was left alone rather than blanked.
   */
  const ROUTING_CASES = [
    {
      payload: {
        building: "Riverside House",
        street_address: "12 Mill Lane",
        city: "Ashford",
      },
      regionControl: "",
      expected: {
        "street[0]": "Riverside House",
        "street[1]": "12 Mill Lane",
        city: "Ashford",
      },
      description: "a building takes line 1 and pushes the street to line 2",
    },
    {
      payload: { apartment: "Flat 4", street_address: "12 Mill Lane" },
      regionControl: "",
      expected: { "street[0]": "Flat 4", "street[1]": "12 Mill Lane" },
      description: "an apartment routes exactly as a building does",
    },
    {
      payload: {
        building: "Riverside House",
        apartment: "Flat 4",
        street_address: "12 Mill Lane",
      },
      regionControl: "",
      expected: {
        "street[0]": "Riverside House Flat 4",
        "street[1]": "12 Mill Lane",
      },
      description:
        "a building and an apartment are two halves of one premises, joined",
    },
    {
      payload: { street_address: "12 Mill Lane", city: "Ashford" },
      regionControl: "",
      expected: {
        "street[0]": "12 Mill Lane",
        "street[1]": "PRE-LINE-2",
        city: "Ashford",
      },
      description:
        "with no premises the street takes line 1 and line 2 is left untouched",
    },
    {
      payload: { building: "12 Mill Lane", street_address: "12 Mill Lane" },
      regionControl: "",
      expected: { "street[0]": "12 Mill Lane", "street[1]": "12 Mill Lane" },
      description:
        "identical lines are both written — no dedup, some real addresses repeat",
    },
    {
      payload: {
        street_address: "12 Mill Lane",
        city: "Ashford",
        region: "Kent",
      },
      regionControl: "select",
      expected: { city: "Ashford", region_id: "43" },
      description:
        "a region matching an option goes to the select, leaving the city alone",
    },
    {
      payload: {
        street_address: "12 Mill Lane",
        city: "Ashford",
        region: "Kent",
      },
      regionControl: "input",
      expected: { city: "Ashford", region: "Kent" },
      description: "a free-text region field takes the region as written",
    },
    {
      payload: {
        street_address: "12 Mill Lane",
        city: "Ashford",
        region: "Kent",
      },
      regionControl: "",
      expected: { city: "Ashford, Kent" },
      description:
        "with no region control the region is appended to the city after a comma",
    },
    {
      payload: {
        street_address: "12 Mill Lane",
        city: "Ashford",
        region: "Nowhereshire",
      },
      regionControl: "select",
      expected: { city: "Ashford, Nowhereshire", region_id: "" },
      description:
        "a region no option matches falls back to the city rather than storing an unknown id",
    },
    {
      payload: { street_address: "12 Mill Lane", region: "Kent" },
      regionControl: "",
      expected: { city: "Kent" },
      description:
        "the comma is a separator, so an address with no city gets none",
    },
  ];

  test.each(ROUTING_CASES)(
    "$description",
    ({ payload, regionControl, expected }) => {
      const container = renderForm(regionControl);

      engine.setAddressData(payload, container);

      Object.keys(expected).forEach((name) => {
        expect(valueOf(container, name)).toBe(expected[name]);
      });
    },
  );

  test("a missing container is a warned no-op, not a throw", () => {
    // The tile offers no address lookup at all, so `null` is a reachable
    // argument rather than a defensive branch.
    expect(() =>
      engine.setAddressData({ city: "Ashford" }, null),
    ).not.toThrow();
  });
});
