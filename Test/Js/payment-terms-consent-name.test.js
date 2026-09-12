/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. The payment-terms consent checkbox is associated with the consent
 * sentence, and the terms link inside that sentence stays reachable.
 *
 * These assertions are the MARKUP CONTRACT only. jsdom has no accessibility
 * layer, so nothing here observes what a screen reader utters — the announced
 * name has to be checked in a real browser. What is verified is that the
 * association exists, that it resolves to the element carrying the sentence,
 * that the ids stay unique when a second brand's tile renders, and that the
 * link is neither wrapped in a label nor taken out of the tab order.
 */

"use strict";

const H = require("./hyva-harness");

/**
 * A fixture consent sentence, not the shipped copy: the contract is that the
 * NAMED element holds whatever sentence the brand supplies, link included.
 */
const CONSENT_SENTENCE =
  'I accept the <a class="text-blue-600" href="/terms" target="_blank">payment terms</a>' +
  " and authorize the brand to process my data automatically.";

/**
 * @param {string} methodCode
 * @returns {Document} the rendered tile
 */
function renderTile(methodCode) {
  const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE, [
    [/^\$methodCode$/, methodCode],
    [/^\$paymentTermsMessage$/, CONSENT_SENTENCE],
  ]);

  return new DOMParser().parseFromString(markup, "text/html");
}

/**
 * `querySelectorAll`, not `getElementById`: the latter answers with the
 * first-registered node, so a duplicate id would read as a clean resolution.
 *
 * @param {Document} doc
 * @param {string} id
 * @returns {Array<Element>}
 */
function elementsWithId(doc, id) {
  return Array.prototype.slice.call(doc.querySelectorAll("#" + id));
}

/**
 * @param {Document} doc
 * @returns {Element}
 */
function consentCheckbox(doc) {
  const found = doc.querySelectorAll(
    'input[type="checkbox"][name="payment[terms_accepted]"]',
  );

  expect(found).toHaveLength(1);

  return found[0];
}

describe.each([
  ["two_payment", "the default brand's tile"],
  ["second_brand_payment", "a second brand's tile"],
])("payment-terms consent checkbox — %s (%s)", (methodCode) => {
  it("names an element that exists exactly once", () => {
    const doc = renderTile(methodCode);
    const target = consentCheckbox(doc).getAttribute("aria-labelledby");

    expect(target).toBeTruthy();
    expect(elementsWithId(doc, target)).toHaveLength(1);
  });

  it("names the element holding the consent sentence", () => {
    const doc = renderTile(methodCode);
    const target = consentCheckbox(doc).getAttribute("aria-labelledby");
    const named = elementsWithId(doc, target)[0];

    expect(named.textContent).toContain("I accept the");
    expect(named.textContent).toContain("payment terms");
  });

  it("names the element the buyer can see", () => {
    // A second, hidden copy of the sentence would let the announced name and
    // the visible one drift apart.
    const doc = renderTile(methodCode);
    const target = consentCheckbox(doc).getAttribute("aria-labelledby");
    const named = elementsWithId(doc, target)[0];

    expect(named.classList.contains("terms-text")).toBe(true);
    expect(named.hasAttribute("hidden")).toBe(false);
    expect(named.hasAttribute("aria-hidden")).toBe(false);
    expect(doc.querySelectorAll(".terms-text")).toHaveLength(1);
  });

  it("carries an id of its own, unique in the document", () => {
    const doc = renderTile(methodCode);
    const id = consentCheckbox(doc).getAttribute("id");

    expect(id).toBeTruthy();
    expect(elementsWithId(doc, id)).toHaveLength(1);
  });

  it("keeps the terms link inside the sentence and interactive", () => {
    const doc = renderTile(methodCode);
    const target = consentCheckbox(doc).getAttribute("aria-labelledby");
    const links = elementsWithId(doc, target)[0].querySelectorAll("a");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBeTruthy();
    expect(links[0].getAttribute("tabindex")).not.toEqual("-1");
    expect(links[0].hasAttribute("aria-hidden")).toBe(false);
  });

  it("associates by reference rather than by a wrapping label", () => {
    // A label wrapping the sentence would put its own activation on the link.
    const doc = renderTile(methodCode);
    const checkbox = consentCheckbox(doc);
    const target = checkbox.getAttribute("aria-labelledby");

    expect(checkbox.closest("label")).toBeNull();
    expect(elementsWithId(doc, target)[0].closest("label")).toBeNull();
    expect(
      doc.querySelectorAll('label[for="' + checkbox.id + '"]'),
    ).toHaveLength(0);
  });

  it("adds no aria-label beside the visible sentence", () => {
    // A duplicated name is its own defect: the visible text and the announced
    // name would then be two separately maintained strings (WCAG 2.5.3).
    expect(
      consentCheckbox(renderTile(methodCode)).hasAttribute("aria-label"),
    ).toBe(false);
  });

  it("stays visible and required", () => {
    const checkbox = consentCheckbox(renderTile(methodCode));

    expect(checkbox.hasAttribute("hidden")).toBe(false);
    expect(checkbox.hasAttribute("aria-hidden")).toBe(false);
    expect(checkbox.hasAttribute("required")).toBe(true);
  });
});

describe("payment-terms consent ids across two payment codes", () => {
  it("shares no id between two brands' tiles", () => {
    const first = renderTile("two_payment");
    const second = renderTile("second_brand_payment");
    const idsOf = function (doc) {
      const checkbox = consentCheckbox(doc);

      return [
        checkbox.getAttribute("id"),
        checkbox.getAttribute("aria-labelledby"),
      ];
    };
    const firstIds = idsOf(first);
    const secondIds = idsOf(second);
    const shared = firstIds.filter(function (id) {
      return secondIds.indexOf(id) !== -1;
    });

    expect(firstIds[0]).not.toEqual(firstIds[1]);
    expect(shared).toEqual([]);
  });
});
