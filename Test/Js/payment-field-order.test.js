/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25280. The optional Two fields render in the canonical order.
 *
 * Canonical order — invoice email, PO number, project, department, order note
 * last — landed on every other surface (Luma / Amasty / Fire, WooCommerce,
 * PrestaShop) under TWO-25263. Hyva was out of scope on that item, so its
 * template still emitted PO number LAST, after the order note.
 *
 * The assertion is deliberately made against the order the DOM actually
 * renders, resolved from the shipped template through the harness, rather than
 * against the order the blocks appear in the source or the order some
 * configuration array happens to list. Field ORDER on this programme has been
 * reported wrong three times behind tests that asserted a different axis —
 * membership, or a config list that the renderer does not read — and passed
 * while the page was wrong. `querySelectorAll` returns matches in document
 * order for exactly one selector, so a single query over all five ids is the
 * whole check.
 *
 * Assertions read the `id` attributes, not the labels: the harness resolves
 * every `__()` to one shared placeholder string, so five labels are
 * indistinguishable from each other and a label-based assertion could not tell
 * the fields apart at all.
 */

"use strict";

const H = require("./hyva-harness");

/**
 * The optional fields in the order the checkout must render them.
 *
 * Order note is last by design — it is a free-text note about the order rather
 * than one of the invoice reference fields, so it sits below them.
 */
const EXPECTED_ORDER = [
  "invoice_emails",
  "two_po_number",
  "two_project",
  "two_department",
  "two_order_note",
];

/** One selector, so `querySelectorAll` resolves document order for us. */
const FIELD_SELECTOR = EXPECTED_ORDER.map(function (id) {
  return "#" + id;
}).join(", ");

/**
 * The ids of the optional fields, in the order the rendered markup puts them.
 *
 * @returns {Array<string>}
 */
function renderedFieldOrder() {
  const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const fields = doc.querySelectorAll(FIELD_SELECTOR);

  return Array.prototype.map.call(fields, function (el) {
    return el.getAttribute("id");
  });
}

describe("optional payment field order", () => {
  it("renders the optional fields in the canonical order", () => {
    expect(renderedFieldOrder()).toEqual(EXPECTED_ORDER);
  });

  it("renders every optional field exactly once", () => {
    // Guards the check above against the failure mode where a field is missing
    // from the template entirely: a shorter list would still be "in order".
    expect(renderedFieldOrder()).toHaveLength(EXPECTED_ORDER.length);
  });

  it("puts the PO number field immediately after the invoice email field", () => {
    // TWO-25280 itself, pinned on its own so a regression names the defect
    // rather than just reporting an array mismatch.
    const order = renderedFieldOrder();

    expect(order.indexOf("two_po_number")).toBe(
      order.indexOf("invoice_emails") + 1,
    );
  });

  it("puts the order note field last", () => {
    const order = renderedFieldOrder();

    expect(order[order.length - 1]).toBe("two_order_note");
  });
});
