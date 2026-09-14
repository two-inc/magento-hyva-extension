/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. jsdom resolves no pseudo-element content, so what is pinned here is
 * the declaration in the shipped stylesheet; that the tick stays out of the
 * selected chip's accessible name is proven from the AX tree in Chrome.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const STYLESHEET = path.resolve(
  __dirname,
  "../../view/frontend/web/css/custom.css",
);

// Every rule in the stylesheet that draws a glyph through `content`.
const GLYPH_RULES = [
  [
    ".two-term-chip--selected .two-term-chip__days::before",
    '"\\2713"',
    "the tick on the selected payment-term chip",
  ],
];

/** @returns {CSSStyleSheet} the shipped stylesheet, parsed */
function sheet() {
  const style = document.createElement("style");
  style.textContent = fs.readFileSync(STYLESHEET, "utf8");
  document.head.appendChild(style);

  // A construct jsdom's parser rejects leaves `sheet` null, which would abort
  // the completeness case rather than fail it.
  expect(style.sheet).not.toBeNull();

  return style.sheet;
}

/**
 * Every style rule in the sheet, descending into `@media` and `@supports` — a
 * glyph the table does not name is the case this file exists to catch.
 *
 * @param {CSSRuleList} rules
 * @returns {Array<CSSStyleRule>}
 */
function styleRules(rules) {
  return Array.prototype.slice.call(rules).reduce(
    (found, rule) =>
      rule.selectorText
        ? found.concat(rule)
        : rule.cssRules
          ? found.concat(styleRules(rule.cssRules))
          : found,
    [],
  );
}

/**
 * [selector, content] for each rule drawing a glyph, quotes normalised — the
 * CSSOM echoes whichever the stylesheet used.
 *
 * @returns {Array<[string, string]>}
 */
function glyphDeclarations() {
  return styleRules(sheet().cssRules)
    .filter((rule) => rule.style.getPropertyValue("content"))
    .map((rule) => [
      rule.selectorText,
      rule.style.getPropertyValue("content").replace(/'/g, '"'),
    ])
    .filter(([, content]) => !/^""/.test(content));
}

afterEach(() => {
  document.head.innerHTML = "";
});

describe("drawn glyphs carry no alternative text (ABN-554)", () => {
  it.each(GLYPH_RULES)("%s draws %s — %s", (selector, glyph) => {
    const declared = glyphDeclarations().filter(([rule]) => rule === selector);

    // Without this the alt-text assertion passes by the rule being gone.
    expect(declared).toHaveLength(1);
    expect(declared[0][1]).toBe(glyph + ' / ""');
  });

  it("the table names every glyph the stylesheet draws", () => {
    expect(glyphDeclarations().map(([selector]) => selector).sort()).toEqual(
      GLYPH_RULES.map(([selector]) => selector).sort(),
    );
  });
});
