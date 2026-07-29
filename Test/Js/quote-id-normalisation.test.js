/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25259. The quote id the two storage clearers compare is a STRING on both
 * sides.
 *
 * They read the same value through different pipes: the shipping step out of
 * `json_encode()`, where an int stays a JSON number, and the payment step out of
 * an `escapeJs()`'d PHP string. `Quote::getId()` is int-ish, so a strict `!==`
 * between them is true forever — and the two clearers then wipe the buyer's
 * company on every page load, each undoing the other's work. Cast at source in
 * GetQuoteDetails, with `String()` on both sides for blobs that predate the cast.
 *
 * Its own file, deliberately. `initShippingCompanyStorage()` registers an
 * `alpine:init` listener that the harness cannot remove, so listeners accumulate
 * across tests in a file — and a test using a DIFFERENT quote id than its
 * neighbours gets cleared by theirs. Every test here uses the same one.
 */

"use strict";

const H = require("./hyva-harness");

// A quote id that is a JSON NUMBER, which is what json_encode() emits for an
// uncast Quote::getId().
const NUMERIC_QUOTE = [
  [
    /^\$quoteDetails(Json)?$/,
    '{"quote_id":42,"store_id":"1","shipping_country_id":"GB"}',
  ],
];

describe("quote id normalisation", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
  });

  afterEach(() => {
    env.restore();
    document.body.innerHTML = "";
  });

  /**
   * @param {Object} data
   * @returns {void}
   */
  function seed(data) {
    env.browserStorage.setItem(
      "shipping_company_selection",
      JSON.stringify(data),
    );
  }

  /** @returns {Object} */
  function stored() {
    return JSON.parse(
      env.browserStorage.getItem("shipping_company_selection") || "{}",
    );
  }

  /**
   * @param {string} storedQuoteId
   * @returns {void}
   */
  function seedSelection(storedQuoteId) {
    seed({
      quote_id: storedQuoteId,
      store_id: "1",
      company_name: "Example Trading Ltd",
      company_id: "12345678",
      manual_mode: false,
    });
  }

  test("a numeric current id matches the same id stored as a string", () => {
    seedSelection("42");

    H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE, NUMERIC_QUOTE);
    env.fireAlpineInit();

    // Without the normalisation, 42 !== "42" and this clears — on every load.
    expect(stored().company_name).toBe("Example Trading Ltd");
    expect(stored().quote_id).toBe("42");
  });

  test("and still clears when the quote genuinely changed", () => {
    seedSelection("41");

    H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE, NUMERIC_QUOTE);
    env.fireAlpineInit();

    expect(stored().company_name).toBe("");
    expect(stored().quote_id).toBe("42");
  });
});
