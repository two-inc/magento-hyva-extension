/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. "What is Two" is ONE control on every checkout: an icon that is
 * itself the link to the brand's about page, describing itself through a
 * tooltip. Every value it carries — URL, accessible name, tooltip copy — comes
 * from the base module's tile-copy service through `CheckoutConfig`, so this
 * suite asserts delegation and markup, never wording.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./hyva-harness");

const TOOLTIP_HTML = "<p>Example explains itself</p><p>Example closing line</p>";

function render(extraRules) {
  return new DOMParser().parseFromString(
    H.renderTemplateMarkup(H.ABOUT_TOOLTIP_MARKUP_TEMPLATE, extraRules),
    "text/html",
  );
}

function templateSource(relPath) {
  return fs.readFileSync(path.join(H.REPO_ROOT, relPath), "utf8");
}

describe("the explainer is an anchor-wrapped icon (ABN-554)", () => {
  it.each([
    ["href", "https://example.test/explainer", "the brand's URL, from the base service"],
    ["target", "_blank", "the buyer does not lose the checkout to read it"],
    ["rel", "noopener", "the opened page gets no handle on the checkout"],
    ["aria-label", "What is Example?", "the icon-only link is named, from the base service"],
    ["aria-describedby", "two-about-tooltip-two_payment", "the tooltip is announced with the link"],
  ])("the anchor's %s is %s — %s", (attribute, expected) => {
    const anchor = render().querySelector("a.two-about-icon");

    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute(attribute)).toBe(expected);
  });

  it("the image is decorative — the anchor carries the name", () => {
    expect(
      render().querySelector("a.two-about-icon img").getAttribute("alt"),
    ).toBe("");
  });

  it.each([
    ["role", "tooltip", "the body declares what it is"],
    ["id", "two-about-tooltip-two_payment", "it carries the id the anchor points at"],
    ["aria-hidden", "true", "the closed body is not read as stray text in flow"],
  ])("the tooltip body's %s is %s — %s", (attribute, expected) => {
    expect(
      render().querySelector(".two-tooltip-box").getAttribute(attribute),
    ).toBe(expected);
  });

  it("the tooltip body renders the base module's copy whole", () => {
    expect(render().querySelector(".two-tooltip-box").innerHTML).toBe(
      TOOLTIP_HTML,
    );
  });

  it("holds no second link — the icon is the link", () => {
    expect(render().querySelectorAll("a")).toHaveLength(1);
  });
});

describe("the explainer keeps no copy or rule of its own (ABN-554)", () => {
  it.each([
    [
      "view/frontend/templates/component/tooltip.phtml",
      /__\(/,
      "the icon template translates no copy — the base service supplies it",
    ],
    [
      "view/frontend/templates/component/payment/method/gateway_method.phtml",
      /two-about|AboutLink/,
      "the tile renders no second explainer",
    ],
  ])("%s matches no %s — %s", (relPath, pattern) => {
    expect(templateSource(relPath)).not.toMatch(pattern);
  });

  it.each([
    ["getAboutLinkUrl", "the URL"],
    ["getAboutLinkText", "the accessible name"],
    ["getAboutTooltipHtml", "the tooltip copy"],
    ["getShowAboutLink", "whether it renders at all"],
  ])("%s comes from CheckoutConfig — %s", (method) => {
    expect(
      templateSource("view/frontend/templates/component/tooltip.phtml"),
    ).toMatch(new RegExp("\\$configModel->" + method + "\\(\\)"));
  });
});

describe("the tooltip opens on hover and on keyboard focus (ABN-554)", () => {
  it.each([
    [/\.tooltip-pay:hover \.two-tooltip-box/, "hover opens it"],
    [/\.tooltip-pay:focus-within \.two-tooltip-box/, "focusing the anchor opens it"],
  ])("%s — %s", (pattern) => {
    expect(templateSource("view/frontend/web/css/custom.css")).toMatch(pattern);
  });
});
