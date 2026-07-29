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
    env.browserStorage.setItem(H.COMPANY_SELECTION_KEY, JSON.stringify(data));
  }

  /** @returns {Object} */
  function stored() {
    return JSON.parse(
      env.browserStorage.getItem(H.COMPANY_SELECTION_KEY) || "{}",
    );
  }

  /**
   * @param {string} storedQuoteId
   * @returns {void}
   */
  function seedSelection(storedQuoteId) {
    // No `store_id` inside the blob: the store view lives in the KEY now, so a
    // field of that name would be dead weight a reader could mistake for scope.
    seed({
      quote_id: storedQuoteId,
      company_name: "Example Trading Ltd",
      company_id: "12345678",
      manual_mode: false,
    });
  }

  /**
   * Load the publisher, then the shipping step, then fire Alpine's ready event.
   *
   * The publisher is not optional here. The shipping template resolves the two
   * accessors into locals behind a `function(){ return {}; }` fallback so a page
   * without gateway_method-csp-js.phtml degrades instead of throwing — which
   * means a test that skips the publisher reads `{}` and writes nowhere. Both
   * cases below would then "pass" without a single quote-id comparison having
   * happened, which is exactly the comparison this file exists to pin.
   *
   * @returns {void}
   */
  function run() {
    H.loadSharedHelpers();
    H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE, NUMERIC_QUOTE);
    env.fireAlpineInit();
  }

  test("a numeric current id matches the same id stored as a string", () => {
    seedSelection("42");

    run();

    // Without the normalisation, 42 !== "42" and this clears — on every load.
    expect(stored().company_name).toBe("Example Trading Ltd");
    expect(stored().quote_id).toBe("42");
  });

  test("a numeric STORED id matches the same id read as a string", () => {
    // The mirror of the case above, and the one that actually pins the
    // stored-side String(). Numeric ids are already in live storage: on
    // `staging` the shipping clearer writes `quote_id: quoteData.quote_id`
    // straight out of json_encode(), so every blob written before the PHP cast
    // landed holds a NUMBER. Normalising only the current side leaves
    // `42 !== "42"` true against exactly those blobs, and the clearers then wipe
    // the buyer's company on every page load for the rest of the quote.
    seedSelection(42);

    run();

    expect(stored().company_name).toBe("Example Trading Ltd");
  });

  test("and still clears when the quote genuinely changed", () => {
    seedSelection("41");

    run();

    expect(stored().company_name).toBe("");
    expect(stored().quote_id).toBe("42");
  });
});
