/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25266. The sole-available-term chip names the term inside the chip and
 * renders no heading above it.
 *
 * Luma / Amasty / Fire Checkout all share one knockout renderer, which gets
 * this right: its `showSingleTerm` block has no <label>, and the chip binds
 * `singleTermLabel` = $t('Payment Terms %1 days'). The Hyva single-term branch
 * was copied from the multi-term branch instead, so it kept the "Selected
 * payment terms" selector caption — wrong wording when there is nothing to
 * select — and showed only the bare duration in the chip.
 *
 * Both symptoms came from that one branch, so both are pinned here: the label
 * getter's single-mode behaviour, and the absence of a caption above the
 * single-term chip strip.
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

  it("names the term inside the chip when it is the only term", () => {
    const el = chipElement({
      days: "30",
      single: "1",
      "label-singular": "1 day",
      "label-plural": "%1 days",
      "label-single": "Payment Terms %1 days",
    });
    const chip = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: el,
    });
    chip.init();

    expect(chip.label).toBe("Payment Terms 30 days");
  });

  it("uses the translated single-term string, not an English literal", () => {
    const el = chipElement({
      days: "14",
      single: "1",
      "label-singular": "1 dag",
      "label-plural": "%1 dagen",
      "label-single": "Betaaltermijn %1 dagen",
    });
    const chip = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: el,
    });
    chip.init();

    expect(chip.label).toBe("Betaaltermijn 14 dagen");
  });

  it("keeps the bare duration on a selectable chip", () => {
    const el = chipElement({
      days: "60",
      "label-singular": "1 day",
      "label-plural": "%1 days",
    });
    const chip = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: el,
    });
    chip.init();

    expect(chip.label).toBe("60 days");
  });

  it("keeps the singular duration form on a selectable one-day chip", () => {
    const el = chipElement({
      days: "1",
      "label-singular": "1 day",
      "label-plural": "%1 days",
    });
    const chip = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: el,
    });
    chip.init();

    expect(chip.label).toBe("1 day");
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

  /**
   * The `.two-term-chips` wrapper of one branch of the template. Both branches
   * are present in the rendered markup — the harness strips PHP control flow —
   * so each is identified by something only it emits.
   *
   * @param {Document} doc
   * @param {string} innerSelector a selector unique to the wanted branch
   * @returns {HTMLElement}
   */
  function branch(doc, innerSelector) {
    const inner = doc.querySelector(innerSelector);
    expect(inner).not.toBeNull();

    return inner.closest(".two-term-chips");
  }

  it("renders no caption above the sole-term chip", () => {
    const single = branch(renderDoc(), '.two-term-chips [data-single="1"]');

    expect(single).not.toBeNull();
    expect(single.querySelector("label.label")).toBeNull();
    // Asserted on the branch's whole text, not on `label.label`, so a caption
    // reintroduced as a `<span class="label">` or a bare `<div>` cannot slip
    // past the selector. The single branch's rendered text is legitimately
    // empty: the chip's own content arrives through `x-text`, which is a
    // binding rather than a text node. If a text node is ever wanted here —
    // an sr-only hint, the loading state — this assertion is the right place
    // to make the decision explicit rather than something to loosen.
    expect(single.textContent.trim()).toBe("");
  });

  /**
   * The label tests above build their own dataset, so on their own they cannot
   * see the template stop emitting the attribute — delete `data-label-single`
   * from the template and every one of them still passes while the chip
   * regresses to the bare duration this ticket is about. This is the wire
   * between the two halves, asserted from the rendered markup.
   */
  it("wires the single-term label through to the sole chip", () => {
    const chip = renderDoc().querySelector('.two-term-chips [data-single="1"]');

    expect(chip).not.toBeNull();
    // Exact values, not `toBeTruthy()`: the harness gives the format string and
    // the day count values distinct from the duration labels' `day`, so this
    // catches the attribute being sourced from the WRONG variable — which is
    // the bug itself — and not merely being deleted.
    expect(chip.getAttribute("data-label-single")).toBe(
      "Payment Terms %1 days",
    );
    // What `%1` is replaced with. A chip that lost it renders '… 0 days'.
    expect(chip.getAttribute("data-days")).toBe("30");
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
      selector: '.two-term-chips [role="group"] button',
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

  it("still captions the selectable chip strip", () => {
    const multi = branch(renderDoc(), '.two-term-chips [role="group"]');

    const caption = multi.querySelector("label.label");

    expect(multi).not.toBeNull();
    expect(caption).not.toBeNull();
    // Scoped to the caption element: asserting the placeholder appears
    // somewhere in the branch would stop pinning the caption the moment a
    // second translated text node lands anywhere in that branch.
    expect(caption.textContent).toContain(H.ESCAPED_STRING);
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
      selector: '.two-term-chips [role="group"] button',
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

  it("is not dimmed by the mid-round-trip styling every other chip takes", () => {
    const css = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "..",
        "..",
        "view/frontend/web/css/custom.css",
      ),
      "utf8",
    );

    // The busy rule would otherwise fade the one permanently disabled chip.
    expect(css).toContain(
      ".two-term-chip[disabled]:not(.two-term-chip--single)",
    );
  });
});
