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

  /**
   * The caption text, as the harness substitutes any `__()` call. Asserted on
   * the TEXT rather than on `label.label`, so a caption reintroduced as a
   * `<span class="label">` or a bare `<div>` cannot slip past the selector.
   *
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function hasCaptionText(el) {
    return el.textContent.indexOf(H.ESCAPED_STRING) !== -1;
  }

  it("renders no caption above the sole-term chip", () => {
    const single = branch(renderDoc(), '.two-term-chips [data-single="1"]');

    expect(single).not.toBeNull();
    expect(single.querySelector("label.label")).toBeNull();
    expect(hasCaptionText(single)).toBe(false);
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
    expect(chip.getAttribute("data-label-single")).toBeTruthy();
    // The days attribute is what `%1` is replaced with; a chip that lost it
    // would render 'Payment Terms 0 days'.
    expect(chip.getAttribute("data-days")).toBeTruthy();
  });

  it("still captions the selectable chip strip", () => {
    const multi = branch(renderDoc(), '.two-term-chips [role="group"]');

    expect(multi).not.toBeNull();
    expect(multi.querySelector("label.label")).not.toBeNull();
    expect(hasCaptionText(multi)).toBe(true);
  });
});
