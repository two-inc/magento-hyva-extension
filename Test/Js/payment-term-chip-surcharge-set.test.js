/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-528. The chip's fee amount is decided over the whole offered set, never
 * per chip: any term quoting non-zero puts an amount on every chip — a chip
 * whose own fee is zero, or that the quote map does not answer for, then shows
 * a zero amount — and every term ~zero shows none anywhere.
 *
 * The other checkouts apply the same rule, threshold and prefix, so all of them
 * display identically for one merchant configuration.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaTermChip";

describe("term chip fee amount", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    env.restore();
  });

  /**
   * The fee text of each chip in one offered set, in order.
   *
   * @param {number[]} terms days per chip, as the template renders them
   * @param {Object} surcharges the Magewire termSurcharges map
   * @returns {string[]}
   */
  function chipFees(terms, surcharges) {
    const wire = {
      termSurcharges: surcharges,
      currencyCode: "EUR",
      currencyLocale: "en-GB",
    };

    return terms.map(function (days) {
      const el = document.createElement("span");
      el.setAttribute("data-days", String(days));
      const chip = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: el,
        wire: wire,
      });
      chip.init();

      return chip.surchargeText;
    });
  }

  it.each([
    {
      terms: [30, 60],
      surcharges: { 30: "0", 60: "0" },
      expected: ["", ""],
      description: "every term zero shows nothing anywhere",
    },
    {
      terms: [30, 60],
      surcharges: { 30: "12.50", 60: "0" },
      expected: ["+€12.50", "+€0.00"],
      description: "one priced term puts a zero amount on the zero-fee chip",
    },
    {
      terms: [30, 60],
      surcharges: { 30: "12.50", 60: "18.00" },
      expected: ["+€12.50", "+€18.00"],
      description: "every priced term shows its own amount",
    },
    {
      terms: [30],
      surcharges: { 30: "0" },
      expected: [""],
      description: "a lone zero-fee chip shows nothing",
    },
    {
      terms: [30],
      surcharges: { 30: "9.00" },
      expected: ["+€9.00"],
      description: "a lone priced chip shows its amount",
    },
    {
      terms: [30, 60],
      surcharges: { 30: "12.50" },
      expected: ["+€12.50", "+€0.00"],
      description:
        "a term the map does not answer for shows a zero amount beside a priced sibling",
    },
    {
      terms: [30, 60],
      surcharges: {},
      expected: ["", ""],
      description: "an unloaded map shows nothing, leaving the loader in place",
    },
  ])("$description", ({ terms, surcharges, expected }) => {
    expect(chipFees(terms, surcharges)).toEqual(expected);
  });
});
