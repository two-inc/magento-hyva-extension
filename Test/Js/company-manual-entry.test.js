/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The manual-entry ROUTE on the address step (TWO-25288 element 5, TWO-25503).
 *
 * Manual entry is how a buyer whose company the registry does not have still
 * gets a name onto the order. What this suite pins is that the route exists,
 * that it is offered on the surface that can still supply an organisation
 * number later and withheld on the one that cannot, and that entering it hands
 * the buyer a field they can actually type in.
 *
 * It does NOT pin the affordance's markup. The affordance is a chip inside the
 * shared popover now (`Two_Gateway/js/model/company-search-panel.js`), which
 * this repo neither ships nor can load — so what is testable here is the
 * adapter's half: which chips it offers, what each one runs, and what it tells
 * the panel to do. The chip's rendering, its keyboard behaviour and the return
 * link are covered where that file lives, not here.
 *
 * Two traps this suite has to stay out of, both proven in this repo:
 *
 *  - the harness resolves EVERY `__()` to one placeholder string, so an
 *    assertion on rendered text cannot tell one string from another and would
 *    pass over any wording at all;
 *  - the markup is server-rendered, so a DOM-only assertion passes with the
 *    Alpine component entirely absent. Every assertion below goes through a
 *    mounted component, and `expectBootstrapped()` fails loudly if the mount
 *    produced nothing.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

/**
 * A threshold that is NOT the production 3, injected in place of it, so a
 * leftover literal is wrong in both directions.
 */
const INJECTED_MIN = 5;

const INJECT_RULE = [
  [/^\(int\) \$companySearchMinChars$/, String(INJECTED_MIN)],
];

/**
 * @param {Object|undefined} component
 * @returns {Object} the same component
 */
function expectBootstrapped(component) {
  expect(component).toBeDefined();
  expect(typeof component.enterManually).toBe("function");
  return component;
}

describe("address-step manual entry", () => {
  let env;
  let fetchStub;
  let component;
  let field;
  let root;

  beforeEach(() => {
    // `two-company-search` on the wrapper is load-bearing, not decoration:
    // `controlRoot()` resolves the component's own root by that class, and a
    // fixture without it makes every lookup below answer null.
    document.body.innerHTML = [
      '<div id="root" class="two-company-search">',
      '  <input type="text" id="field" value="" />',
      "</div>",
    ].join("\n");
    field = document.getElementById("field");
    root = document.getElementById("root");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE, INJECT_RULE);
    env.fireAlpineInit();

    component = expectBootstrapped(
      H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: field,
        root: root,
      }),
    );
    component.init();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  /**
   * @param {string} mode
   * @returns {Object|undefined} the chip definition for `mode`
   */
  function chip(mode) {
    return component
      .companyPopoverChips()
      .find((candidate) => candidate.mode === mode);
  }

  /** @returns {Object} the panel this component built */
  function panel() {
    expect(env.companyPanels).toHaveLength(1);
    return env.companyPanels[0];
  }

  describe("the route is offered here and withheld where it dead-ends", () => {
    test.each([
      ["registered", true, "the registry lookup is always available"],
      ["manual", true, "the address step still has a lookup to supply a number later"],
    ])("the %s chip is offered: %p (%s)", (mode, offered) => {
      expect(component.companyPopoverModeOffered(mode)).toBe(offered);
    });

    test("withheld once company search is off, where a typed name is a dead end", () => {
      // Manual entry captures no organisation number, and Two's payment method
      // requires one. With no lookup left on the checkout there is nothing to
      // supply it, so offering the mode strands the buyer.
      component.isCompanySearchEnabled = "";

      expect(component.companyPopoverModeOffered("manual")).toBe(false);
    });

    test("the chips are the panel's, not this checkout's markup", () => {
      // The row this replaced sat outside the popover, where the dropdown drew
      // over it. Passing them in is what puts them inside.
      expect(typeof panel().options.getChips).toBe("function");
      expect(panel().options.getChips().map((entry) => entry.mode)).toEqual([
        "registered",
        "soletrader",
        "manual",
      ]);
    });
  });

  describe("entering manual entry", () => {
    test("it hands the field back as something the buyer can type in", () => {
      chip("manual").onActivate();

      // Without this the popover reopens over the field on focus and the buyer
      // cannot type the name manual entry exists to capture.
      expect(panel().calls).toContain("releaseField");
    });

    test("it is the selected mode afterwards", () => {
      chip("manual").onActivate();

      expect(component.companyPopoverSelectedMode()).toBe("manual");
    });

    test("a name typed there is published with no identifier vouched for it", () => {
      chip("manual").onActivate();
      field.value = "Unlisted Trading Ltd";

      component.onNameFieldInput();

      // `search` and the stored selection, NOT `companyName`:
      // commitManualCompany() deliberately never writes that — a hand-typed
      // name is not a captured company, and `isCompanySelected` going false is
      // the same statement.
      expect(component.search).toBe("Unlisted Trading Ltd");
      expect(component.isCompanySelected).toBe(false);
      expect(
        JSON.parse(env.storage[H.COMPANY_SELECTION_KEY]).company_name,
      ).toBe("Unlisted Trading Ltd");
    });

    test("typing in SEARCH mode publishes nothing", () => {
      // The company-name field shows the captured company; the popover moves
      // keystrokes into its own query box. Committing here would publish a
      // half-typed query as the order's company name.
      field.value = "Acm";

      component.onNameFieldInput();

      expect(env.storage[H.COMPANY_SELECTION_KEY]).toBeUndefined();
    });
  });

  describe("the way back out", () => {
    test("the panel is given a handler for it, so manual entry is not a dead end", () => {
      expect(typeof panel().options.onExitManualEntry).toBe("function");
    });

    test("taking it returns to registered-company search", () => {
      chip("manual").onActivate();

      panel().options.onExitManualEntry();

      expect(component.manualMode).toBe(false);
      expect(component.companyPopoverSelectedMode()).toBe("registered");
    });

    test("the registered chip is the same route", () => {
      chip("manual").onActivate();

      chip("registered").onActivate();

      expect(component.manualMode).toBe(false);
    });
  });
});
