/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25461. Field routing when the engine writes an address it was
 * handed — a registered-company search result or an autofill payload — through
 * `setAddressData()`.
 */

"use strict";

const H = require("./hyva-harness");

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
   * @param {string} [country] the form's selected country; no country field
   *   when omitted
   * @returns {HTMLElement} the container `setAddressData()` writes into
   */
  function renderForm(regionControl, country) {
    const region =
      regionControl === "select"
        ? '<select name="region_id"><option value="">--</option>' +
          '<option value="43">Kent</option><option value="51">Surrey</option></select>'
        : regionControl === "input"
          ? '<input type="text" name="region" value="" />'
          : "";
    document.body.innerHTML = [
      '<div id="address-form">',
      country
        ? '  <select name="country_id"><option value="' +
          country +
          '" selected>' +
          country +
          "</option></select>"
        : "",
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

  /*
   * TWO-26258. A registry can answer the region as an ISO 3166-2 code ("ES-M"),
   * which no option is labelled with. A code for the form's own country is no
   * use to anyone reading the city, so the region select is left for the buyer
   * and the checkout's required-field validation prompts them.
   */
  const SUBDIVISION_CODE_CASES = [
    {
      country: "ES",
      region: "ES-M",
      regionControl: "select",
      expected: { city: "MADRID", region_id: "" },
      description: "an own-country code is not appended to the city",
    },
    {
      country: "ES",
      region: "es-m",
      regionControl: "",
      expected: { city: "MADRID" },
      description: "the code is matched case-insensitively",
    },
    {
      country: "ES",
      region: "Nowhereshire",
      regionControl: "select",
      expected: { city: "MADRID, Nowhereshire", region_id: "" },
      description: "a same-country free-text name is still appended",
    },
    {
      country: "ES",
      region: "FR-75",
      regionControl: "select",
      expected: { city: "MADRID, FR-75", region_id: "" },
      description: "another country's code stays free text",
    },
    {
      country: "",
      region: "ES-M",
      regionControl: "",
      expected: { city: "MADRID, ES-M" },
      description:
        "with no country in the form there is nothing to judge it by",
    },
    {
      country: "ES",
      region: "",
      regionControl: "select",
      expected: { city: "MADRID", region_id: "" },
      description: "an empty region writes nothing anywhere",
    },
  ];

  test.each(SUBDIVISION_CODE_CASES)(
    "$description",
    ({ country, region, regionControl, expected, description }) => {
      const container = renderForm(regionControl, country);

      engine.setAddressData(
        { street_address: "Calle Mayor 1", city: "MADRID", region },
        container,
      );

      Object.keys(expected).forEach((name) => {
        expect(description + ": " + name + "=" + valueOf(container, name)).toBe(
          description + ": " + name + "=" + expected[name],
        );
      });
    },
  );

  test("an own-country code is not written into an empty city either", () => {
    const container = renderForm("select", "ES");

    engine.setAddressData(
      { street_address: "Calle Mayor 1", region: "ES-M" },
      container,
    );

    expect(valueOf(container, "city")).toBe("");
  });

  test("a missing container is a warned no-op, not a throw", () => {
    // The tile offers no address lookup at all, so `null` is a reachable
    // argument rather than a defensive branch.
    expect(() =>
      engine.setAddressData({ city: "Ashford" }, null),
    ).not.toThrow();
  });
});
