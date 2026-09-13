/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. The payment tile carries the explainer link the base checkout's tile
 * carries, from the same service — `CheckoutTileCopy` through `CheckoutConfig`
 * — so a buyer meeting the method for the first time can find out what it is.
 */

"use strict";

const H = require("./hyva-harness");

/** @returns {HTMLAnchorElement|null} the tile's explainer link, as rendered */
function aboutLink() {
  const doc = new DOMParser().parseFromString(
    H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
    "text/html",
  );

  return doc.querySelector("a.two-about-link");
}

describe("the tile carries the explainer link (ABN-554)", () => {
  it.each([
    ["href", "https://example.test/explainer", "the brand's URL, from the base service"],
    ["textContent", "What is Example?", "the brand's wording, from the base service"],
    ["target", "_blank", "the buyer does not lose the checkout to read it"],
    ["rel", "noopener", "the opened page gets no handle on the checkout"],
  ])("its %s is %s — %s", (property, expected) => {
    const link = aboutLink();

    expect(link).not.toBeNull();
    expect(
      property === "textContent" ? link.textContent : link.getAttribute(property),
    ).toBe(expected);
  });

  it("renders exactly one, so the tile states it once", () => {
    const doc = new DOMParser().parseFromString(
      H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
      "text/html",
    );

    expect(doc.querySelectorAll("a.two-about-link")).toHaveLength(1);
  });
});
