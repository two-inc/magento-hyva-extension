/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-26295. A stored company carries the country it was captured in, and is
 * never restored, resolved or sent in an order intent under another country.
 */

"use strict";

const H = require("./hyva-harness");

const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const METHOD_CODE = "two_payment";

// The invoice-role country every case below runs under (the fixture's field).
const PAGE_COUNTRY = "GB";
const COMPANY = { companyName: "Example Holdings", companyId: "12345678" };
const NONE = { companyName: "", companyId: "", companyIdSource: "", role: "" };

describe("the captured company's country (TWO-26295)", () => {
  let env;
  let fetchStub;

  /** @param {boolean} withTileControl render the tile's own company control */
  function render(withTileControl) {
    const pair = withTileControl
      ? [
          '  <div class="two-company-search" data-two-capture-host="tile">',
          '    <input type="text" id="company_name" name="payment[company_name]"' +
            " data-two-capture-field value=\"\" />",
          "  </div>",
          '  <input type="text" id="company_id" name="payment[company_id]"' +
            ' data-name="company_id" value="" />',
        ]
      : [
          '  <input type="hidden" id="company_name" name="payment[company_name]"' +
            ' data-name="company_name" />',
          '  <input type="hidden" id="company_id" name="payment[company_id]"' +
            ' data-name="company_id" />',
        ];
    document.body.innerHTML = []
      .concat([
        '<input type="radio" name="payment-method-option" value="' +
          METHOD_CODE +
          '" checked />',
        '<input id="shipping-country_id" value="' + PAGE_COUNTRY + '" />',
        '<form id="two_payment_form">',
        '<div id="payment-root">',
      ])
      .concat(pair)
      .concat(["</div>", "</form>"])
      .join("\n");
  }

  /** @returns {Object} the mounted tile, initialized */
  function mountTile() {
    const root = document.getElementById("payment-root");
    const tile = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
      el: root,
      root: root,
    });
    tile.$watch = function () {};
    tile.initialize(JSON.parse(H.QUOTE_JSON));
    return tile;
  }

  /**
   * @param {string} key storage key
   * @param {?string} country the stamp, or null for a record without one
   */
  function storeRecord(key, country) {
    const record = {
      company_name: COMPANY.companyName,
      company_id: COMPANY.companyId,
      company_id_source: "registry",
    };
    if (country !== null) record.company_country = country;
    env.browserStorage.setItem(key, JSON.stringify(record));
  }

  /** @returns {Object} what the order intent would carry for the company */
  function intentCompany(tile) {
    return tile.buildOrderIntentRequestBody(JSON.parse(H.QUOTE_JSON)).buyer
      .company;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    render(false);
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    delete window.twoGatewayInvoiceCompanyWritten;
    delete window.twoGatewayInvoiceCompanyWatchers;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  test.each([
    [{}, "ES", true, "no record at all"],
    [{ company_id: "1" }, "ES", true, "a record with no stamp (written before it existed)"],
    [{ company_id: "1", company_country: "ES" }, "", true, "no country to compare against"],
    [{ company_id: "", company_country: "ES" }, "GB", true, "a stamp left beside no number"],
    [{ company_id: "1", company_country: "ES" }, "ES", true, "the same country"],
    [{ company_id: "1", company_country: "es" }, "ES", true, "the same country in another case"],
    [{ company_id: "1", company_country: "ES" }, "US", false, "another country"],
  ])("record %j fits %s: %s (%s)", (record, country, expected, description) => {
    expect([description, window.twoGatewayCompanyRecordFits(record, country)]).toEqual([
      description,
      expected,
    ]);
  });

  test.each([
    [{}, "", "ES", "", "no number to stamp"],
    [{}, "1", "es", "ES", "a new number takes the live country"],
    [{ company_id: "1", company_country: "ES" }, "2", "GB", "GB", "a different number is restamped"],
    [{ company_id: "1", company_country: "ES" }, "1", "GB", "ES", "the same number keeps its stamp"],
    [{ company_id: "1" }, "1", "GB", "", "an unstamped number is not stamped by a rewrite"],
  ])(
    "previous %j writing %s under %s stamps %s (%s)",
    (previous, companyId, country, expected, description) => {
      expect([
        description,
        window.twoGatewayCompanyCountryStamp(previous, companyId, country),
      ]).toEqual([description, expected]);
    },
  );

  test.each([
    ["ES", NONE, "a billing record captured in another country is not restored"],
    [PAGE_COUNTRY, COMPANY, "a billing record captured here is restored"],
    [null, COMPANY, "an unstamped billing record is restored"],
  ])("billing record stamped %s resolves to %j (%s)", (stamp, expected, description) => {
    render(true);
    storeRecord(H.BILLING_COMPANY_KEY, stamp);

    const tile = mountTile();

    expect([description, window.twoGatewayInvoiceCompany(tile).companyId]).toEqual([
      description,
      expected.companyId,
    ]);
    expect([description, intentCompany(tile).organization_number]).toEqual([
      description,
      expected.companyId,
    ]);
    expect([description, env.identityFor("billing").companyId()]).toEqual([
      description,
      expected.companyId,
    ]);
  });

  test.each([
    ["ES", "", "a record captured in another country is not restored"],
    [PAGE_COUNTRY, COMPANY.companyId, "a record captured in this form's country is"],
  ])("the delivery form restores a record stamped %s as %s (%s)", (stamp, expected, description) => {
    storeRecord(H.COMPANY_SELECTION_KEY, stamp);
    const form = document.createElement("form");
    form.innerHTML = [
      '<select id="shipping-country_id-form" name="shipping[country_id]">',
      '  <option value="' + PAGE_COUNTRY + '" selected>x</option>',
      "</select>",
      '<div id="delivery-root" class="two-company-search"',
      '     data-two-capture-host="address" data-two-capture-role="">',
      '  <input type="text" id="delivery-field" data-two-capture-field value="" />',
      "</div>",
    ].join("\n");
    document.body.appendChild(form);

    H.mountComponent(env.alpineComponents["twoGatewayHyvaCompanySearchField"], {
      el: document.getElementById("delivery-field"),
      root: document.getElementById("delivery-root"),
    }).init();

    expect([description, env.identityFor("shipping").companyId()]).toEqual([
      description,
      expected,
    ]);
  });

  test.each([
    ["ES", "", "a delivery record captured in another country is not seeded"],
    [PAGE_COUNTRY, COMPANY.companyId, "a delivery record captured here is seeded"],
  ])("shipping record stamped %s seeds %s (%s)", (stamp, expected, description) => {
    storeRecord(H.COMPANY_SELECTION_KEY, stamp);

    mountTile();

    expect([description, env.identityFor("shipping").companyId()]).toEqual([
      description,
      expected,
    ]);
  });

  test.each([
    ["ES", "", "a delivery company from another country is not the invoice company"],
    [PAGE_COUNTRY, COMPANY.companyId, "a delivery company from this country is"],
    [null, COMPANY.companyId, "an unstamped delivery company still is"],
  ])(
    "a live delivery capture stamped %s resolves to %s (%s)",
    (stamp, expected, description) => {
      const tile = mountTile();
      storeRecord(H.COMPANY_SELECTION_KEY, stamp);
      env.identityFor("shipping").write(
        {
          companyName: COMPANY.companyName,
          companyId: COMPANY.companyId,
          companyIdSource: "registry",
        },
        { authoritative: true },
      );

      expect([description, window.twoGatewayResolveInvoiceCompany().companyId]).toEqual([
        description,
        expected,
      ]);
      expect([description, tile.shouldSkipOrderIntent({})]).toEqual([
        description,
        expected === "",
      ]);
    },
  );

  test.each([
    [PAGE_COUNTRY, COMPANY.companyId, "the invoice country it was captured in"],
    ["ES", "", "an invoice country that has since moved"],
  ])(
    "a tile capture under %s is placed as %s (%s)",
    (country, expected, description) => {
      render(true);
      const tile = mountTile();
      env.identityFor("billing").write(
        {
          companyName: COMPANY.companyName,
          companyId: COMPANY.companyId,
          companyIdSource: "registry",
        },
        { authoritative: true },
      );
      document.getElementById("shipping-country_id").value = country;

      expect([description, tile.invoiceCompany().companyId]).toEqual([
        description,
        expected,
      ]);
      expect([description, tile.shouldSkipOrderIntent({})]).toEqual([
        description,
        expected === "",
      ]);
    },
  );

  test("a capture stamps its country, and a later rewrite of it keeps that stamp", () => {
    render(true);
    mountTile();
    const identity = env.identityFor("billing");
    const write = () =>
      identity.write(
        {
          companyName: COMPANY.companyName,
          companyId: COMPANY.companyId,
          companyIdSource: "registry",
        },
        { authoritative: true },
      );
    const stamp = () =>
      JSON.parse(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).company_country;

    write();
    expect(stamp()).toBe(PAGE_COUNTRY);

    identity.write({ companyName: "", companyId: "", companyIdSource: "" }, { authoritative: true });
    expect(stamp()).toBe("");

    write();
    document.getElementById("shipping-country_id").value = "ES";
    identity.write(
      { companyName: COMPANY.companyName + " ", companyId: COMPANY.companyId, companyIdSource: "registry" },
      { authoritative: true },
    );
    expect(stamp()).toBe(PAGE_COUNTRY);
  });
});
