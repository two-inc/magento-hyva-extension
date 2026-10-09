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

  /*
   * The region controls as Hyvä Checkout serves them (TWO-26265): ONE control
   * named `region` whatever its kind, a select of region ids for a country with
   * a list and a text input otherwise, both `wire:model.defer` bound to
   * `address.region`. Attributes copied from the served checkout, options cut
   * to two. The suite used to render a `region_id` select here, which Hyvä
   * Checkout never serves, so the region routing passed against markup the
   * checkout does not have and never selected a province on the real page.
   * `region_id` is still what other forms name the select, hence its own kind.
   */
  const WIRE =
    'data-form="shipping" data-attribute="region" id="shipping-region" ' +
    'autocomplete="address-level1" wire:target="region" ' +
    'wire:auto-save="shipping" wire:model.defer="address.region"';
  const REGION_CONTROLS = {
    select:
      '<select class="block w-full form-select select region address-attribute" ' +
      WIRE +
      ' name="region" required="">' +
      '<option value="">Please select a region, state or province.</option>' +
      '<option value="43">\n    Kent    </option>' +
      '<option value="51">\n    Surrey    </option></select>',
    input:
      '<input class="form-input w-full grow text region address-attribute" ' +
      WIRE +
      ' type="text" name="region">',
    "region_id select":
      '<select name="region_id"><option value="">--</option>' +
      '<option value="43">Kent</option><option value="51">Surrey</option></select>',
  };

  /**
   * An address form with both street lines, a city, a postcode and whichever
   * region control the case asks for.
   *
   * @param {string} regionControl '' or a key of REGION_CONTROLS
   * @param {string} [country] the form's selected country; no country field
   *   when omitted
   * @returns {HTMLElement} the container `setAddressData()` writes into
   */
  function renderForm(regionControl, country) {
    const region = REGION_CONTROLS[regionControl] || "";
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
      expected: { city: "Ashford", region: "43" },
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
      expected: { city: "Ashford, Nowhereshire", region: "" },
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
      expected: { city: "MADRID", region: "" },
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
      expected: { city: "MADRID, Nowhereshire", region: "" },
      description: "a same-country free-text name is still appended",
    },
    {
      country: "ES",
      region: "FR-75",
      regionControl: "select",
      expected: { city: "MADRID, FR-75", region: "" },
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
      expected: { city: "MADRID", region: "" },
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

  /*
   * TWO-26263. The module's company relay adds the store's own region id beside
   * an ISO 3166-2 region it could resolve. The select takes it wherever it
   * offers that id; otherwise the text routing above applies.
   */
  const REGION_ID_CASES = [
    {
      payload: { region: "GB-KEN", region_id: "43" },
      expected: { region: "43", city: "Ashford" },
      description: "an id the select offers is selected",
    },
    {
      payload: { region: "GB-KEN", region_id: 43 },
      expected: { region: "43", city: "Ashford" },
      description: "a numeric id is matched as text",
    },
    {
      payload: { region: "KEN", region_id: "43" },
      expected: { region: "43", city: "Ashford" },
      description:
        "a bare code the relay resolved is selected and kept out of the city",
    },
    {
      payload: { region: "Surrey", region_id: "43" },
      expected: { region: "43", city: "Ashford" },
      description: "the id wins over a text match",
    },
    {
      payload: { region: "GB-KEN", region_id: "99" },
      expected: { region: "", city: "Ashford" },
      description: "an id the select lacks falls back to the text routing",
    },
    {
      payload: { region: "Surrey" },
      expected: { region: "51", city: "Ashford" },
      description: "with no id the text match is unchanged",
    },
  ];

  /*
   * Each row against both select names: Hyvä Checkout's `region` and the
   * `region_id` other forms use. `region` in `expected` is the select's value.
   */
  const SELECT_NAMES = { select: "region", "region_id select": "region_id" };
  const REGION_ID_ROWS = [];
  Object.keys(SELECT_NAMES).forEach((control) => {
    REGION_ID_CASES.forEach((row) => {
      REGION_ID_ROWS.push(
        Object.assign({}, row, {
          control,
          description: row.description + " (" + control + ")",
        }),
      );
    });
  });

  test.each(REGION_ID_ROWS)(
    "$description",
    ({ payload, expected, control, description }) => {
      const container = renderForm(control, "GB");

      engine.setAddressData(
        Object.assign(
          { street_address: "1 High St", city: "Ashford" },
          payload,
        ),
        container,
      );

      Object.keys(expected).forEach((key) => {
        const name = key === "region" ? SELECT_NAMES[control] : key;
        expect(description + ": " + key + "=" + valueOf(container, name)).toBe(
          description + ": " + key + "=" + expected[key],
        );
      });
    },
  );

  /*
   * TWO-26265. `wire:model` on a select takes its value from `change`, so a
   * selection Magewire never hears about is lost on the next round trip. The
   * select is announced with the same `input` every other field written here
   * gets, plus `change`, and only once its value is set.
   */
  test("a selected region is announced to Magewire with input and change", () => {
    const container = renderForm("select", "GB");
    const select = container.querySelector('select[name="region"]');
    const heard = [];
    ["input", "change"].forEach((type) =>
      select.addEventListener(type, () =>
        heard.push(type + "=" + select.value),
      ),
    );

    engine.setAddressData(
      {
        street_address: "1 High St",
        city: "Ashford",
        region: "GB-KEN",
        region_id: 43,
      },
      container,
    );

    expect(heard).toEqual(["input=43", "change=43"]);
  });

  test("an unmatched region announces nothing on the select", () => {
    const container = renderForm("select", "GB");
    const select = container.querySelector('select[name="region"]');
    const heard = [];
    ["input", "change"].forEach((type) =>
      select.addEventListener(type, () => heard.push(type)),
    );

    engine.setAddressData(
      { street_address: "1 High St", city: "Ashford", region: "Nowhereshire" },
      container,
    );

    expect(heard).toEqual([]);
  });

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
