/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288. The company-search spinner, on BOTH surfaces that search.
 *
 * The spinner is now drawn entirely in CSS from one childless element, so what
 * the templates have to get right is a very small set of things that are all
 * invisible to every other suite:
 *
 *  - it exists at all. The shipping-address field carried `isSearching` in
 *    component state, driven correctly on every exit path, and bound it to
 *    nothing — so that form searched with no feedback whatsoever. A state
 *    property bound to nothing has no user-visible effect, which is why the
 *    binding is read out of the shipped markup here rather than assumed.
 *  - it keeps BOTH classes, spelled exactly. The positioning class carries the
 *    spokes geometry and the chip-loading class carries the paint; a brand
 *    overlay recolours the paint class with a flat single-class rule and wins on
 *    stylesheet load order. Drop either class and the spinner is either unpaint-
 *    able or ungeometried, and nothing else in CI notices.
 *  - it has NO children. The old markup carried three dot spans. Leaving them in
 *    would put three masked, conic-gradient-painted boxes inside the spinner.
 *  - it stays `aria-hidden`. It is decorative; the search result is what gets
 *    announced.
 *
 * Assertions are made against the rendered shipped templates, not against a
 * fixture copy of the markup, so a template edit is what makes them fail.
 */

"use strict";

const H = require("./hyva-harness");

/** Both classes, in the order the templates spell them. */
const POSITION_CLASS = "two-company-search__spinner";
const PAINT_CLASS = "two-term-chip__loading";

const SPINNER_SELECTOR = "." + POSITION_CLASS;

/** The component state property the spinner must be bound to. */
const SEARCHING_STATE = "isSearching";

/**
 * The two surfaces that run a company search, each with its markup template,
 * the `-csp-js` template defining its component, and that component's
 * registered Alpine name.
 */
const SURFACES = [
  {
    label: "payment tile",
    markup: H.GATEWAY_METHOD_MARKUP_TEMPLATE,
    js: H.GATEWAY_METHOD_TEMPLATE,
    component: "twoGatewayHyvaPaymentMethodBase",
  },
  {
    label: "shipping-address field",
    markup: H.COMPANY_NAME_MARKUP_TEMPLATE,
    js: H.COMPANY_NAME_TEMPLATE,
    component: "twoGatewayHyvaCompanySearchField",
  },
];

/**
 * The spinner element as the surface's shipped template renders it.
 *
 * @param {string} relPath repo-relative markup template path
 * @returns {Element}
 */
function spinnerFrom(relPath) {
  const markup = H.renderTemplateMarkup(relPath);
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const spinners = doc.querySelectorAll(SPINNER_SELECTOR);
  // Exactly one per surface: a second one would mean two spinners fighting over
  // the same absolute position, and a `querySelector` assertion would not see
  // it.
  expect(spinners.length).toBe(1);
  return spinners[0];
}

describe.each(SURFACES)("company-search spinner — $label", (surface) => {
  test("renders exactly one spinner element", () => {
    expect(spinnerFrom(surface.markup)).not.toBeNull();
  });

  test("carries both the positioning and the paint class", () => {
    const spinner = spinnerFrom(surface.markup);

    expect(spinner.classList.contains(POSITION_CLASS)).toBe(true);
    expect(spinner.classList.contains(PAINT_CLASS)).toBe(true);
  });

  test("has no child nodes for the CSS to fight with", () => {
    const spinner = spinnerFrom(surface.markup);

    expect(spinner.childElementCount).toBe(0);
    // Text children are just as wrong as element ones — the old markup's dots
    // were text inside spans, and a stray `.` survives an element-count check.
    expect(spinner.textContent.trim()).toBe("");
  });

  test("is hidden from assistive technology", () => {
    const spinner = spinnerFrom(surface.markup);

    expect(spinner.getAttribute("aria-hidden")).toBe("true");
  });

  test("is bound to the searching state, which the component defines", () => {
    // Throws if the element has no `x-show` at all, which is the shipping
    // field's original defect.
    const bound = H.readAlpineBinding(
      surface.markup,
      SPINNER_SELECTOR,
      "x-show",
    );
    expect(bound).toBe(SEARCHING_STATE);

    // Under CSP Alpine the binding is a key lookup on the component, so a
    // binding whose name the component does not define resolves to undefined
    // and the spinner never shows. Mount the real component and check.
    const env = H.installHyvaEnvironment();
    const fetchStub = H.stubFetch();
    try {
      H.loadSharedHelpers();
      H.loadTemplate(surface.js);
      // The templates register their components from an `alpine:init` listener,
      // so nothing is in `alpineComponents` until that event fires.
      env.fireAlpineInit();
      const component = H.mountComponent(
        env.alpineComponents[surface.component],
        {},
      );

      expect(component[bound]).toBe(false);
    } finally {
      fetchStub.restore();
      env.restore();
    }
  });
});
