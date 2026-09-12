/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. A payment-term chip's visible text is the term and nothing else —
 * `30 days`, or `EOM+30` — whether one term is offered or several, on all four
 * platforms. What names the group is the caption, which renders above both
 * branches so a lone chip never has to name itself.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaTermChip";

/**
 * A chip element carrying the data-* attributes the template emits.
 *
 * @param {Object} dataset attribute name (without the data- prefix) to value
 * @returns {HTMLElement}
 */
function chipElement(dataset) {
  const el = document.createElement("span");
  Object.keys(dataset).forEach(function (key) {
    el.setAttribute("data-" + key, dataset[key]);
  });

  return el;
}

describe("term chip label", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    // Alpine.data() registration happens in the template's `alpine:init`
    // listener, so nothing is registered until that event fires.
    env.fireAlpineInit();
  });

  afterEach(() => {
    env.restore();
  });

  /**
   * @param {Object} dataset data-* attributes, without the prefix
   * @returns {string} the chip's visible text
   */
  function labelOf(dataset) {
    const chip = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: chipElement(dataset),
    });
    chip.init();

    return chip.label;
  }

  const LABELS = { "label-singular": "1 day", "label-plural": "%1 days" };
  const EOM_LABELS = { "label-singular": "EOM+1", "label-plural": "EOM+%1" };

  it.each([
    { days: "30", labels: LABELS, text: "30 days", case: "a standard term" },
    { days: "1", labels: LABELS, text: "1 day", case: "the one-day form" },
    { days: "30", labels: EOM_LABELS, text: "EOM+30", case: "an end-of-month term" },
    { days: "1", labels: EOM_LABELS, text: "EOM+1", case: "its one-day form" },
    {
      days: "120",
      labels: EOM_LABELS,
      text: "EOM+120",
      case: "a three-digit end-of-month term",
    },
  ])("a lone chip reads as one of several does: $case", ({ days, labels, text }) => {
    const selectable = Object.assign({ days: days }, labels);
    const lone = Object.assign({ single: "1" }, selectable);

    expect(labelOf(lone)).toBe(text);
    expect(labelOf(selectable)).toBe(text);
  });
});

describe("term chip caption", () => {
  /**
   * @returns {Document} the rendered markup, parsed
   */
  function renderDoc() {
    return new DOMParser().parseFromString(
      H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
      "text/html",
    );
  }

  /** @returns {string} the Alpine component template as shipped */
  function cspSource() {
    return require("fs").readFileSync(
      require("path").join(__dirname, "..", "..", H.GATEWAY_METHOD_TEMPLATE),
      "utf8",
    );
  }

  /** @returns {string} the markup template as shipped, PHP and all */
  function templateSource() {
    return require("fs").readFileSync(
      require("path").join(
        __dirname,
        "..",
        "..",
        H.GATEWAY_METHOD_MARKUP_TEMPLATE,
      ),
      "utf8",
    );
  }

  /**
   * @param {Document} doc
   * @param {string} innerSelector a selector unique to the wanted container
   * @returns {HTMLElement} the container's `.two-term-chips` wrapper
   */
  function branch(doc, innerSelector) {
    const inner = doc.querySelector(innerSelector);
    expect(inner).not.toBeNull();

    return inner.closest(".two-term-chips");
  }

  it.each([
    { selector: '[data-single="1"]', case: "the sole-term chip" },
    {
      selector: '[role="radiogroup"] [data-days="14"]',
      case: "a selectable chip",
    },
  ])("one caption sits above $case", ({ selector }) => {
    // Both branches are present in the rendered markup — the harness strips PHP
    // control flow — so this is the shared wrapper, which is the point: the
    // caption cannot be emitted for one branch and not the other.
    const caption = branch(renderDoc(), selector).querySelector("span.label");

    expect(caption).not.toBeNull();
    expect(caption.textContent).toContain(H.ESCAPED_STRING);
  });

  it.each([
    {
      selector: '[data-single="1"]',
      role: "group",
      case: "the sole chip, which is not a choice",
    },
    {
      selector: '[data-days="14"]',
      role: "radiogroup",
      case: "a selectable chip",
    },
  ])(
    "the group holding $case is a $role named by the caption",
    ({ selector, role }) => {
      const doc = renderDoc();
      const container = doc
        .querySelector(".two-term-chips " + selector)
        .closest(".two-term-chips__container");

      expect(container.getAttribute("role")).toBe(role);
      expect(container.hasAttribute("aria-label")).toBe(false);
      expect(container.getAttribute("aria-labelledby")).toBe(
        doc.querySelector(".two-term-chips span.label").id,
      );
    },
  );

  /**
   * The harness strips PHP control flow, so the rendered markup cannot tell a
   * caption emitted for both branches from one emitted for the multi-term
   * branch alone. That distinction is the fix, so it is asserted on the source.
   */
  it.each([
    {
      pattern: /<\?php if \(\$showChip \|\| \$magewire->showSingleTerm\): \?>/,
      case: "one wrapper over both branches",
    },
    {
      pattern:
        /<span class="label[^"]*"\s+id="[^"]*">\s*<span><\?= \$escaper->escapeHtml\(__\('Selected payment terms'\)\) \?><\/span>\s*<\/span>\s*<\?php if \(\$showChip\): \?>/,
      case: "the caption ahead of the multi-term branch, not inside it",
    },
  ])("the caption is emitted for both branches: $case", ({ pattern }) => {
    expect(templateSource()).toMatch(pattern);
  });

  it("gives the sole chip no visible-text override of its own", () => {
    // The prefixed string it used to carry ("Payment Terms 30 days") was the
    // chip naming its own group; the caption above does that now.
    const chip = renderDoc().querySelector('.two-term-chips [data-single="1"]');

    expect(chip.hasAttribute("data-label-single")).toBe(false);
    expect(chip.getAttribute("data-label-plural")).toBe("day");
    // What `%1` is replaced with. A chip that lost it renders '… 0 days'.
    expect(chip.getAttribute("data-days")).toBe("30");
    // Neither half of the pair the override needed to work.
    expect(templateSource()).not.toContain("data-label-single");
    expect(cspSource()).not.toContain("labelSingle");
  });

  /**
   * The chip's name and tooltip are rendered PHP-side, so the harness strips the
   * condition that withholds them under standard terms — that half is pinned in
   * GatewayMethodChipLabelTest. What is pinned here is the wire: both branches
   * emit both attributes, from the accessible-name variable rather than from one
   * of the visible-text templates.
   */
  it.each([
    {
      selector: '.two-term-chips [data-single="1"]',
      case: "the sole-term chip",
    },
    {
      selector: '.two-term-chips [role="radiogroup"] button',
      case: "a selectable chip",
    },
  ])("names the end-of-month term on $case", ({ selector }) => {
    const chip = renderDoc().querySelector(selector);

    expect(chip).not.toBeNull();
    expect(chip.getAttribute("aria-label")).toBe(
      "EOM+%1: pay %1 days after the end of the month",
    );
    expect(chip.getAttribute("title")).toBe(
      "EOM+%1: pay %1 days after the end of the month",
    );
  });

});

/**
 * ABN-554. An `aria-label` replaces the whole accessible name, so the `+€n.nn`
 * rendered inside an end-of-month chip is announced nowhere unless the name
 * states it too. The name is bound rather than fixed at render time because the
 * fee quote lands after the chip does.
 */
describe("term chip accessible name", () => {
  let env;

  const NAME = "EOM+30: pay 30 days after the end of the month";
  const NAME_FEE =
    "EOM+30: pay 30 days after the end of the month, plus a %2 surcharge";
  const NAMED = { days: "30", name: NAME, "name-fee": NAME_FEE };

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    env.restore();
  });

  /**
   * @param {Object} dataset data-* attributes, without the prefix
   * @param {Object} surcharges the Magewire termSurcharges map
   * @param {boolean} updating whether a term round-trip is in flight
   * @returns {Object} the mounted chip
   */
  function chip(dataset, surcharges, updating) {
    const el = document.createElement("button");
    Object.keys(dataset).forEach(function (key) {
      el.setAttribute("data-" + key, dataset[key]);
    });
    const mounted = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: el,
      wire: {
        termSurcharges: surcharges,
        currencyCode: "EUR",
        currencyLocale: "en-GB",
      },
    });
    mounted.init();
    mounted.isUpdating = !!updating;

    return mounted;
  }

  it.each([
    {
      dataset: NAMED,
      surcharges: { 30: "7.25", 60: "9.00" },
      updating: false,
      expected:
        "EOM+30: pay 30 days after the end of the month, plus a €7.25 surcharge",
      description:
        "a priced term states the fee the label would otherwise silence",
    },
    {
      dataset: NAMED,
      surcharges: { 30: "0", 60: "0" },
      updating: false,
      expected: NAME,
      description: "a set quoting nothing states no amount",
    },
    {
      dataset: NAMED,
      surcharges: {},
      updating: false,
      expected: NAME,
      description: "a quote still in flight states no amount either",
    },
    {
      dataset: NAMED,
      surcharges: { 30: "7.25" },
      updating: true,
      expected: NAME,
      description: "a term mid-round-trip states none while the loader shows",
    },
    {
      dataset: { days: "30" },
      surcharges: { 30: "7.25" },
      updating: false,
      expected: "",
      description: "a standard term is left unnamed whatever it costs",
    },
  ])("$description", ({ dataset, surcharges, updating, expected }) => {
    expect(chip(dataset, surcharges, updating).accessibleName).toBe(expected);
  });

  it("names the amount the chip itself displays", () => {
    const mounted = chip(NAMED, { 30: "7.25", 60: "9.00" }, false);

    expect(mounted.surchargeText).toBe("+€7.25");
    expect(mounted.accessibleName).toContain("€7.25");
    // WCAG 2.5.3 Label in Name: the visible token opens the name.
    expect(mounted.accessibleName.indexOf("EOM+30")).toBe(0);
  });

  it.each([
    {
      selector: '.two-term-chips [data-single="1"]',
      case: "the sole-term chip",
    },
    {
      selector: '.two-term-chips [role="radiogroup"] button',
      case: "a selectable chip",
    },
  ])("binds the name so the fee reaches it on $case", ({ selector }) => {
    const el = new DOMParser()
      .parseFromString(
        H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
        "text/html",
      )
      .querySelector(selector);

    expect(el).not.toBeNull();
    expect(el.getAttribute("data-name")).toBe(NAME.replace(/30/g, "%1"));
    expect(el.getAttribute("data-name-fee")).toBe(NAME_FEE.replace(/30/g, "%1"));
    // Without the bound pair the name is fixed at render time, before the quote.
    expect(el.getAttribute(":aria-label")).toBe("accessibleName");
    expect(el.getAttribute(":title")).toBe("accessibleName");
  });
});

/**
 * ABN-554. A sole offered term is not a choice, but it still carries the name
 * that spells the term out — and ARIA prohibits naming a role-less element,
 * which a bare span is. Whether Tab actually skips it is a browser check: jsdom
 * has no sequential focus navigation.
 */
describe("the sole offered term chip", () => {
  /** @returns {HTMLElement} the sole-term chip as rendered */
  function soleChip() {
    return new DOMParser()
      .parseFromString(
        H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
        "text/html",
      )
      .querySelector('.two-term-chips [data-single="1"]');
  }

  it.each([
    { read: (el) => el.tagName, expected: "BUTTON", case: "is a button" },
    { read: (el) => el.disabled, expected: true, case: "is natively disabled" },
    {
      read: (el) => el.getAttribute("type"),
      expected: "button",
      case: "never submits the checkout form it sits in",
    },
    {
      read: (el) => el.getAttribute(":class"),
      expected: "chipClasses",
      case: "still takes its whole appearance from the chip component",
    },
  ])("the sole chip $case", ({ read, expected }) => {
    expect(read(soleChip())).toBe(expected);
  });

  it.each([
    {
      // The busy rule would otherwise fade the one permanently disabled chip.
      pattern: ".two-term-chip[disabled]:not(.two-term-chip--single)",
      case: "the sole chip is not dimmed by the mid-round-trip styling",
    },
    {
      pattern:
        ".two-term-chip:focus-visible {\n  outline: 2px solid #3043d1;\n  outline-offset: 2px;\n}",
      case: "a keyboard-focused chip keeps a visible ring (WCAG 2.4.7)",
    },
  ])("$case", ({ pattern }) => {
    const css = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "..",
        "..",
        "view/frontend/web/css/custom.css",
      ),
      "utf8",
    );

    expect(css).toContain(pattern);
    // An `outline: none` anywhere on the chip removes the ring again.
    expect(css).not.toMatch(/\.two-term-chip:focus\s*\{[^}]*outline:\s*none/);
  });
});
