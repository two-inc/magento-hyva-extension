/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 — the popover has to survive a Magewire re-render.
 *
 * A re-render MORPHS the server markup over the live DOM. The popover's
 * `span.two-company-field-wrap` is built at runtime and is in no server markup,
 * so the morph deletes it — panel, chips and the field's own mount attribute
 * with it — and leaves a bare input that answers to nothing. Nothing rebuilds
 * it on its own: the morph KEEPS the element carrying this component's
 * `x-data`, so Alpine keeps the component and `init()` never runs again.
 *
 * Reproduced in the browser on the address step from three different actions —
 * changing country, picking the payment method, and using the return link out
 * of manual entry — which are three different states of this control reaching
 * one morph, so that is what the cases below are.
 *
 * Mutation-resistance notes:
 *  - the morph is applied to the DOM the panel actually built and is asserted
 *    to have DESTROYED the control before the hook is fired, so a helper that
 *    quietly stopped removing anything fails instead of passing;
 *  - the panel double answers `isBound()` from that DOM rather than returning
 *    a constant true, which is the answer that would agree with the adapter in
 *    exactly the direction that hides this;
 *  - `element.updated` is fired several times, as a real re-render does, and
 *    the panel count is asserted after — a rebuild per hook call would show up
 *    as a second panel rather than as a pass.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

const WRAP = ".two-company-field-wrap";
const PANEL = ".two-company-dropdown";

describe("a Magewire re-render that morphs the popover away", () => {
  let env;
  let fetchStub;
  let component;
  let field;
  let root;

  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="root" class="two-company-search" data-two-capture-host="address">',
      '  <input type="text" id="field" data-two-capture-field value="" />',
      "</div>",
    ].join("\n");
    field = document.getElementById("field");
    root = document.getElementById("root");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: field,
      root: root,
    });
    component.init();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  /** @returns {Object} the panel this component is using */
  function panel() {
    return env.companyPanels[env.companyPanels.length - 1];
  }

  /**
   * @param {string} mode
   * @returns {Object} the chip definition for `mode`
   */
  function chip(mode) {
    return panel()
      .options.getChips()
      .find((candidate) => candidate.mode === mode);
  }

  /**
   * What a morph does to this control: the wrapper is not in the server markup
   * so it goes, and the field is put back where the server rendered it.
   */
  function morphServerMarkupOverControl() {
    const wrap = field.parentElement;
    root.insertBefore(field, wrap);
    wrap.remove();
  }

  test.each([
    ["in search mode", "the buyer picked the payment method", () => {}],
    [
      "in manual entry",
      "the buyer was typing a company the registry does not have",
      () => chip("manual").onActivate(),
    ],
    [
      "just back from manual entry",
      "the buyer used the return link, which is the cleanest reproduction",
      () => {
        chip("manual").onActivate();
        panel().options.onExitManualEntry();
      },
    ],
  ])("%s — %s", (_state, _because, reach) => {
    reach();
    expect(document.querySelectorAll(WRAP)).toHaveLength(1);

    morphServerMarkupOverControl();
    // The premise. Without it a helper that removed nothing would leave every
    // assertion below passing on a control that was never broken.
    expect(document.querySelectorAll(WRAP)).toHaveLength(0);
    expect(document.querySelectorAll(PANEL)).toHaveLength(0);
    expect(panel().isBound()).toBe(false);

    env.fireMagewireHook("element.updated", 3);

    expect(document.querySelectorAll(WRAP)).toHaveLength(1);
    expect(document.querySelectorAll(PANEL)).toHaveLength(1);
    expect(panel().isBound()).toBe(true);
  });

  test("the rebuild re-points the one panel rather than building a second", () => {
    morphServerMarkupOverControl();

    env.fireMagewireHook("element.updated", 3);

    expect(env.companyPanels).toHaveLength(1);
  });

  test("the field is still addressable, because the morph restores what addresses it", () => {
    // The panel's selector is the two server-rendered attributes, so a morph
    // reinstates it rather than deleting it — a runtime stamp on the field would
    // go with the wrapper and leave the rebuilt panel addressing nothing.
    morphServerMarkupOverControl();

    env.fireMagewireHook("element.updated");

    expect(panel().fieldSelector).toBe(
      '[data-two-capture-host="address"] input[data-two-capture-field]',
    );
    expect(document.querySelectorAll(panel().fieldSelector)).toHaveLength(1);
    expect(panel().getField()[0]).toBe(field);
  });

  test("manual entry keeps its way back after the rebuild", () => {
    // The return link lives in the wrapper the morph deleted, and the panel
    // renders it only when the field is released.
    chip("manual").onActivate();
    morphServerMarkupOverControl();
    const before = panel().calls.filter((call) => call === "releaseField").length;

    env.fireMagewireHook("element.updated");

    expect(
      panel().calls.filter((call) => call === "releaseField").length,
    ).toBeGreaterThan(before);
  });

  test("a re-render leaves an untouched popover alone", () => {
    const before = panel().calls.filter((call) => call === "bind").length;

    env.fireMagewireHook("element.updated", 5);

    expect(panel().calls.filter((call) => call === "bind").length).toBe(before);
  });

  test("a mount that ran before Magewire published itself still gets watched", () => {
    // Nothing guarantees this component initialises after Magewire boots, and a
    // hook that was never registered fails silently — as a dead control.
    const magewire = window.Magewire;
    delete window.Magewire;
    delete window.twoGatewayCompanyMorphHooked;
    const late = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: field,
      root: root,
    });
    late.init();

    window.Magewire = magewire;
    window.dispatchEvent(new Event("load"));
    morphServerMarkupOverControl();
    env.fireMagewireHook("element.updated");

    expect(document.querySelectorAll(WRAP)).toHaveLength(1);
  });

  test("a control the re-render removed outright is dropped, not rebuilt", () => {
    root.remove();

    env.fireMagewireHook("element.updated");

    expect(window.twoGatewayCompanyMounts).toHaveLength(0);
    expect(document.querySelectorAll(PANEL)).toHaveLength(0);
  });
});
