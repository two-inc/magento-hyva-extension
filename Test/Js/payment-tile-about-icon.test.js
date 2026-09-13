/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. The explainer is ONE control — a linked icon with a tooltip — and
 * every value it carries comes from the base module, so this suite asserts
 * delegation and markup, never wording.
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

  it("the icon sits inside the anchor — the icon IS the link", () => {
    expect(render().querySelector("a.two-about-icon > img")).not.toBeNull();
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

  it("renders nothing at all when the base withholds the link", () => {
    // The harness strips `<?php ?>` tags without resolving them, so the gate is
    // pinned as source rather than by rendering it both ways.
    expect(
      templateSource("view/frontend/templates/component/tooltip.phtml"),
    ).toMatch(/<\?php if \(\$configModel->getShowAboutLink\(\)\): \?>/);
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

describe("the tooltip is reachable by keyboard and by pointer (ABN-554)", () => {
  it.each([
    [
      /\.tooltip-pay:focus-within \.two-tooltip-box/,
      "focusing the anchor opens it, not only hovering",
    ],
    [
      /\.two-tooltip-box \{[^}]*top: 100%;/,
      "the box is flush to its trigger, so the pointer can travel to it",
    ],
    [
      /\.two-about-icon \{[^}]*padding: 2px;/,
      "the 20px icon is padded to a 24px target",
    ],
    [
      /\.two-tooltip-box \{[^}]*opacity: 0;/,
      "the closed box is faded, so the description does not hinge on how an AT treats a hidden referenced node",
    ],
    [
      /\.two-tooltip-box \{[^}]*pointer-events: none;/,
      "a faded box still takes clicks unless it is told not to",
    ],
    [
      /\.two-tooltip-box p \{[^}]*margin: 0 0 8px;/,
      "the base module's three bare <p>s are separated, not run together",
    ],
    [
      /\.two-tooltip-box p:last-child \{[^}]*margin-bottom: 0;/,
      "and the last one adds no trailing gap inside the box",
    ],
  ])("%s — %s", (pattern) => {
    expect(templateSource("view/frontend/web/css/custom.css")).toMatch(pattern);
  });

  it("nothing hides the closed box outright", () => {
    expect(
      /\.two-tooltip-box[^{]*\{[^}]*visibility:/.test(
        templateSource("view/frontend/web/css/custom.css"),
      ),
    ).toBe(false);
  });
});
