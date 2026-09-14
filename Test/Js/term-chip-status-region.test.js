/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. The chips carry the base checkout's status region: the term being
 * applied, then the reason the last attempt was refused, then nothing.
 *
 * jsdom has no accessibility layer, so what is pinned here is the markup and
 * the text the component computes; that a screen reader is given the change is
 * proven from the AX tree in Chrome.
 */

"use strict";

const H = require("./hyva-harness");

const STATUS = "twoGatewayHyvaTermChipStatus";
const CHIP = "twoGatewayHyvaTermChip";

/**
 * The region as the page serves it, live in the document so a component can be
 * mounted on the element the template actually emits.
 *
 * @returns {HTMLElement|null}
 */
function region() {
  document.body.innerHTML = H.renderTemplateMarkup(
    H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  );

  return document.body.querySelector(".two-term-chips .two-term-chips__status");
}

describe("the chips have a status region (ABN-554)", () => {
  it.each([
    ["role", "status", "a region whose changes are given to a screen reader"],
    ["aria-live", "polite", "spoken at the next pause, not over the buyer"],
    ["x-text", "message", "its text is the state, never markup of its own"],
    ["x-data", STATUS, "the component behind that state is mounted on it"],
    [
      "data-applying-message",
      "Applying the selected term",
      "the applying wording comes from the template, not the component",
    ],
  ])("its %s is %s — %s", (attribute, expected) => {
    const node = region();

    expect(node).not.toBeNull();
    expect(node.getAttribute(attribute)).toBe(expected);
  });

  it("ships empty: a region created together with its text announces nothing", () => {
    expect(region().textContent).toBe("");
  });

  it("sits outside the group, so it is not read as one of the options", () => {
    expect(region().closest('[role="radiogroup"]')).toBeNull();
  });

  it("opts out of the morph, which would rewrite text Alpine will not recompute", () => {
    expect(region().hasAttribute("wire:ignore")).toBe(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });
});

describe("what the region states (ABN-554)", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    jest.useRealTimers();
    env.restore();
    document.body.innerHTML = "";
  });

  /**
   * The component mounted on the region the template emits — not on a stand-in,
   * so a template that stopped declaring it would fail here.
   *
   * @param {boolean} busy whether a term is being applied
   * @param {string} failureMessage the last refusal, or ''
   * @returns {Object} the mounted region
   */
  function mounted(busy, failureMessage) {
    const el = region();
    env.Alpine.store("twoChip", {
      busy: busy,
      failureMessage: failureMessage,
      seq: 0,
    });

    const component = H.mountComponent(
      env.alpineComponents[el.getAttribute("x-data")],
      { el: el },
    );
    component.init();

    return component;
  }

  it.each([
    [true, "", "Applying the selected term", "a term is being applied"],
    [false, "", "", "settled, with nothing to say"],
    [false, "Could not update.", "Could not update.", "the last attempt was refused"],
    [true, "Could not update.", "Applying the selected term", "a retry supersedes its refusal"],
  ])("busy=%s failure=%s reads %s — %s", (busy, failure, expected) => {
    expect(mounted(busy, failure).message).toBe(expected);
  });

  /**
   * One chip mounted against a `$wire` whose selectTerm the test settles.
   *
   * @param {Function} selectTerm the Magewire call
   * @param {number} [days] the chip's own term, 60 by default
   * @returns {Object} the mounted chip
   */
  function chip(selectTerm, days) {
    const container = document.createElement("div");
    container.className = "two-term-chips__container";
    container.setAttribute("data-terms", "30,60");
    const el = document.createElement("button");
    el.className = "two-term-chip";
    el.setAttribute("data-days", String(days || 60));
    el.dataset.errorMessage = "Could not update payment term. Please try again.";
    container.appendChild(el);
    document.body.appendChild(container);

    const component = H.mountComponent(env.alpineComponents[CHIP], {
      el: el,
      wire: { selectedTerm: 0, selectTerm: selectTerm },
    });
    component.init();

    return component;
  }

  it("a refused selection is published to the region, not to a toast", async () => {
    env.Alpine.store("twoChip", { busy: false, failureMessage: "", seq: 0 });

    await chip(() => Promise.reject(new Error("boom"))).select();

    expect(env.Alpine.store("twoChip").failureMessage).toBe(
      "Could not update payment term. Please try again.",
    );
    expect(env.messages).toHaveLength(0);
  });

  it("a selection that lands clears the previous refusal", async () => {
    env.Alpine.store("twoChip", {
      busy: false,
      failureMessage: "Could not update.",
      seq: 0,
    });

    await chip(() => Promise.resolve()).select();

    expect(env.Alpine.store("twoChip").failureMessage).toBe("");
  });

  it("a call landing after the timeout clears the refusal it caused", async () => {
    jest.useFakeTimers();
    env.Alpine.store("twoChip", { busy: false, failureMessage: "", seq: 0 });
    let land;
    const selecting = chip(
      () => new Promise((resolve) => {
        land = resolve;
      }),
    ).select();

    jest.advanceTimersByTime(15000);
    await selecting;
    // The term is still being applied, so the buyer is told it was refused.
    expect(env.Alpine.store("twoChip").failureMessage).toBe(
      "Could not update payment term. Please try again.",
    );

    land();
    await Promise.resolve();

    expect(env.Alpine.store("twoChip").failureMessage).toBe("");
  });

  it("a call landing late leaves a later selection's own refusal standing", async () => {
    jest.useFakeTimers();
    env.Alpine.store("twoChip", { busy: false, failureMessage: "", seq: 0 });
    let landFirst;
    const first = chip(
      () => new Promise((resolve) => {
        landFirst = resolve;
      }),
      60,
    ).select();
    jest.advanceTimersByTime(15000);
    await first;

    await chip(() => Promise.reject(new Error("boom")), 30).select();
    landFirst();
    await Promise.resolve();

    expect(env.Alpine.store("twoChip").failureMessage).toBe(
      "Could not update payment term. Please try again.",
    );
  });
});
