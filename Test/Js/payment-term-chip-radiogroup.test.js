/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. The offered terms are one choice, so they carry the W3C radio-group
 * pattern the other three checkouts already carry: a `radiogroup` holding
 * `radio` chips, `aria-checked` marking the selection, one tab stop into the
 * group and the arrow keys moving within it. A `--selected` class and a tick
 * glyph reach no screen reader.
 *
 * jsdom has no accessibility layer and no sequential focus navigation, so what
 * is pinned here is the markup and the state the bindings compute; the AX tree
 * and the Tab stop are proven in Chrome.
 */

"use strict";

const H = require("./hyva-harness");

const CHIP = "twoGatewayHyvaTermChip";
const GROUP = "twoGatewayHyvaTermChipGroup";

/** @returns {Document} the rendered markup, parsed */
function renderDoc() {
  return new DOMParser().parseFromString(
    H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
    "text/html",
  );
}

/** @returns {HTMLElement} the multi-term container as shipped */
function selectableGroup() {
  return renderDoc().querySelector('.two-term-chips [role="radiogroup"]');
}

describe("the term chips are a radio group (ABN-554)", () => {
  it.each([
    ["role", "radiogroup", "the container announces a single choice"],
    [":aria-labelledby", null, "named by the caption, statically"],
    ["@keydown", "onKeydown", "the arrow keys are handled on the group"],
  ])("the container's %s is %s — %s", (attribute, expected) => {
    const container = selectableGroup();

    expect(container).not.toBeNull();
    expect(container.getAttribute(attribute)).toBe(expected);
  });

  it.each([
    ["role", "radio", "each chip is one option of that choice"],
    [
      ":aria-checked",
      "ariaChecked",
      "which one is chosen is exposed, not implied",
    ],
    [":tabindex", "tabIndex", "the group is one tab stop"],
    [":aria-pressed", null, "no toggle-button state on a radio"],
  ])("a selectable chip's %s is %s — %s", (attribute, expected) => {
    const chip = selectableGroup().querySelector("button");

    expect(chip.getAttribute(attribute)).toBe(expected);
  });

  it("publishes the offered set on the group, which is what a chip reads", () => {
    // The harness strips PHP, so the value is the placeholder; the wire is the
    // assertion — without it a chip cannot tell whether it holds the tab stop.
    expect(selectableGroup().hasAttribute("data-terms")).toBe(true);
  });

  it("leaves the sole-term branch a plain group", () => {
    const sole = renderDoc().querySelector('.two-term-chips [data-single="1"]');

    expect(sole.hasAttribute("role")).toBe(false);
    expect(
      sole.closest(".two-term-chips__container").getAttribute("role"),
    ).toBe("group");
  });
});

describe("chip state under the radio contract (ABN-554)", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    env.restore();
  });

  /**
   * One chip of a three-term group, mounted against a real container so the
   * offered set resolves the way it does on the page.
   *
   * @param {number} days the chip's own term
   * @param {string} terms the group's offered set, comma separated
   * @param {*} selected the Magewire selectedTerm
   * @returns {Object} the mounted chip
   */
  function chip(days, terms, selected) {
    const container = document.createElement("div");
    container.className = "two-term-chips__container";
    container.setAttribute("data-terms", terms);
    const el = document.createElement("button");
    el.className = "two-term-chip";
    el.setAttribute("data-days", String(days));
    container.appendChild(el);

    const mounted = H.mountComponent(env.alpineComponents[CHIP], {
      el: el,
      wire: { selectedTerm: selected },
    });
    mounted.init();

    return mounted;
  }

  const TERMS = "14,30,60";

  it.each([
    [30, 30, "true", 0, "the chosen term"],
    [14, 30, "false", -1, "a term not chosen"],
    [14, null, "false", 0, "the first term, when nothing is chosen yet"],
    [60, null, "false", -1, "a later term, when nothing is chosen yet"],
    [14, 90, "false", 0, "the first term, when the choice matches no chip"],
  ])(
    "days=%s selected=%s reads aria-checked=%s tabindex=%s — %s",
    (days, selected, checked, tabIndex) => {
      const mounted = chip(days, TERMS, selected);

      expect(mounted.ariaChecked).toBe(checked);
      expect(mounted.tabIndex).toBe(tabIndex);
    },
  );
});

describe("arrow keys move within the group (ABN-554)", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    env.restore();
    document.body.innerHTML = "";
  });

  /**
   * A mounted group over `count` focusable chips, the tab stop on `stop`.
   *
   * @param {number} count how many chips
   * @param {number} stop index of the chip holding tabindex="0"
   * @returns {Object} the group, its chips and each chip's click recorder
   */
  function group(count, stop) {
    const container = document.createElement("div");
    container.className = "two-term-chips__container";
    document.body.appendChild(container);

    const clicks = [];
    const chips = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("button");
      el.className = "two-term-chip";
      el.setAttribute("tabindex", i === stop ? "0" : "-1");
      el.addEventListener("click", () => clicks.push(i));
      container.appendChild(el);
      chips.push(el);
    }

    return {
      component: H.mountComponent(env.alpineComponents[GROUP], {
        el: container,
      }),
      chips: chips,
      clicks: clicks,
    };
  }

  /**
   * @param {Object} init KeyboardEvent options
   * @returns {KeyboardEvent} with preventDefault recorded
   */
  function keyEvent(init) {
    const event = new KeyboardEvent("keydown", init);
    event.preventDefault = jest.fn();

    return event;
  }

  it.each([
    ["ArrowRight", 0, 1, "forward"],
    ["ArrowDown", 0, 1, "forward on the vertical key too"],
    ["ArrowLeft", 0, 2, "backward, wrapping to the end"],
    ["ArrowUp", 2, 1, "backward on the vertical key too"],
    ["ArrowRight", 2, 0, "forward, wrapping to the start"],
    ["Home", 2, 0, "straight to the first"],
    ["End", 0, 2, "straight to the last"],
  ])("%s from chip %s lands on chip %s — %s", (key, from, to) => {
    const g = group(3, 0);
    g.chips[from].focus();

    g.component.onKeydown(keyEvent({ key: key }));

    expect(document.activeElement).toBe(g.chips[to]);
    // Selection follows focus: the pattern's chosen option is the focused one.
    expect(g.clicks).toEqual([to]);
  });

  it("starts from the tab stop when focus is outside the group", () => {
    const g = group(3, 1);

    g.component.onKeydown(keyEvent({ key: "ArrowRight" }));

    expect(document.activeElement).toBe(g.chips[2]);
  });

  it.each([
    [{ key: "Tab" }, "Tab, which leaves the group"],
    [{ key: "ArrowRight", altKey: true }, "a browser shortcut"],
    [{ key: "ArrowRight", ctrlKey: true }, "another one"],
    [{ key: "ArrowRight", metaKey: true }, "and another"],
    [{ key: "a" }, "a printable key"],
  ])("passes %s through untouched — %s", (init) => {
    const g = group(3, 0);
    g.chips[0].focus();
    const event = keyEvent(init);

    g.component.onKeydown(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(g.chips[0]);
    expect(g.clicks).toEqual([]);
  });

  it("leaves a lone chip alone", () => {
    const g = group(1, 0);
    g.chips[0].focus();

    g.component.onKeydown(keyEvent({ key: "ArrowRight" }));

    expect(g.clicks).toEqual([]);
  });
});
