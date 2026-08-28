/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 — this checkout's half of the shared-capture contract.
 *
 * The popover, the capture controller, the identity and the sole-trader flow are
 * all the base plugin's, loaded from `Two_Gateway::`. None of them is in this
 * repo and none can be loaded here, so what is testable is the ADAPTER: the
 * nineteen-member host contract this checkout supplies, the six-member search API
 * built over the engine, and the two mount selectors that tell the surfaces
 * apart. Those are also the only places drift can enter — the popover owns the
 * copy, the class names and the DOM order, and the controller owns the modes.
 *
 * The harness stubs record rather than swallow (`.options`, `.calls`), because a
 * stub that dropped its options would make every assertion here vacuous.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

/** Every member `CompanySearchPanel` reads off its injected `search`. */
const SEARCH_API_CONTRACT = [
  "MIN_INPUT_LENGTH",
  "SEARCH_DEBOUNCE_MS",
  "minInputLengthMessage",
  "noResultsMessage",
  "searchCompanies",
  "abortActiveRequest",
];

/** The two mount points, as the controller is told to address them. */
const ADDRESS_SELECTOR =
  '[data-two-capture-host="address"] input[data-two-capture-field]';
const TILE_SELECTOR =
  '[data-two-capture-host="tile"] input[data-two-capture-field]';

/** A search response shaped the way the API returns one. */
function hit(name, identifier, lookupId) {
  return {
    name: name,
    highlight: "<em>" + name + "</em>",
    national_identifier: identifier === null ? null : { id: identifier },
    lookup_id: lookupId,
  };
}

/**
 * One address-step mount point.
 *
 * `two-company-search` and both `data-two-capture-*` attributes are
 * load-bearing: `controlRoot()` resolves the component's root by the class, and
 * the controller resolves its mount by the attribute pair.
 *
 * @param {string} id
 * @param {string} [value]
 * @returns {string}
 */
function controlMarkup(id, value) {
  return [
    '<div id="' + id + '" class="two-company-search"',
    ' data-two-capture-host="address">',
    '<input type="text" id="' + id + '-field" data-two-capture-field',
    ' value="' + (value || "") + '" />',
    "</div>",
  ].join("");
}

describe("the Hyvä adapter over the shared capture controller", () => {
  let env;
  let fetchStub;
  let component;
  let field;

  beforeEach(() => {
    document.body.innerHTML = controlMarkup("root");
    field = document.getElementById("root-field");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: field,
      root: document.getElementById("root"),
    });
    component.init();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  /** @returns {Object} the panel the controller built */
  function panel() {
    return env.companyPanels[env.companyPanels.length - 1];
  }

  /** @returns {Object} the one page-level capture controller */
  function capture() {
    return env.captureControllers[env.captureControllers.length - 1];
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
   * Mount a second component the way a Magewire rebuild does.
   *
   * @param {string} id the control root's id
   * @returns {Object} the rebuilt component
   */
  function remount(id) {
    const rebuilt = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: document.getElementById(id + "-field"),
      root: document.getElementById(id),
    });
    rebuilt.init();
    return rebuilt;
  }

  describe("mounting", () => {
    test("init() builds exactly one controller and one panel", () => {
      expect(env.captureControllers).toHaveLength(1);
      expect(env.companyPanels).toHaveLength(1);
    });

    test.each([
      ["root", "a rebuild that keeps the input"],
      ["root2", "a rebuild that replaced it"],
    ])("%s stays one controller and one panel (%s)", (id) => {
      // The controller is page-level and cached on `window`, so a re-render
      // re-points it. A second would leave two popovers writing to one identity,
      // two listeners on one input, and one keystroke searching twice.
      if (id !== "root") document.body.innerHTML = controlMarkup(id);

      remount(id);

      expect(env.captureControllers).toHaveLength(1);
      expect(env.companyPanels).toHaveLength(1);
      expect(panel().getField()[0]).toBe(document.getElementById(id + "-field"));
    });

    test("a second mount point on the page does not get a panel of its own", () => {
      // Two mounts are legitimate markup — the address renderer runs on the
      // delivery form and the invoice form — but there is one control, so the
      // controller binds one of them and leaves the other alone.
      document.body.innerHTML = controlMarkup("root") + controlMarkup("other");
      field = document.getElementById("root-field");

      remount("other");

      expect(env.companyPanels).toHaveLength(1);
    });

    test.each([
      [ADDRESS_SELECTOR, "addressFieldSelector", "the address step"],
      [TILE_SELECTOR, "tileFieldSelector", "the payment tile"],
    ])("%s is how %s addresses %s", (selector, option) => {
      // Attributes of ours, never the field's id: the id comes from Hyvä's
      // entity-field config and can hold anything a selector would have to
      // escape, and the panel resolves its host with a document-wide
      // querySelector — so the selector has to name the mount point.
      expect(capture().host()[option]).toBe(selector);
    });

    test("each mount selector matches exactly its own host", () => {
      document.body.innerHTML =
        controlMarkup("root") +
        '<div class="two-company-search" data-two-capture-host="tile">' +
        '<input type="text" id="tile-field" data-two-capture-field /></div>';

      expect(document.querySelectorAll(ADDRESS_SELECTOR)).toHaveLength(1);
      expect(document.querySelectorAll(TILE_SELECTOR)).toHaveLength(1);
    });

    test.each(H.CAPTURE_HOST_CONTRACT.map((member) => [member]))(
      "the controller is given %s",
      (member) => {
        // The controller throws on a partial adapter, deep inside a buyer's
        // flow — a missing `revertAutofilledAddress` on a country change, a
        // missing `signupPrefill` on a signup with no buyer in it.
        expect(typeof capture().host()[member]).toBe("function");
      },
    );

    test("a company already captured survives the mount", () => {
      // A returning buyer's company arrives in the store-view-keyed selection
      // blob, which is the only thing that survives a Magewire rebuild. The
      // panel repaints the field from getDisplayText() as it attaches, so a
      // getter answering '' would wipe the company AND carry the wipe into the
      // quote on the `change` it fires.
      env.storage[H.COMPANY_SELECTION_KEY] = JSON.stringify({
        company_name: "Existing Trading Ltd",
        company_id: "12345678",
        company_id_source: "registry",
      });

      remount("root");

      expect(panel().options.getDisplayText()).toBe("Existing Trading Ltd");
    });

    test("a captured company still wins over what was typed", () => {
      // Both populated and DIFFERENT, or the precedence this names is untested.
      component.search = "Typed Ltd";
      env.identity.write(
        { companyName: "Picked Ltd", companyId: "12345678" },
        { authoritative: true },
      );

      expect(panel().options.getDisplayText()).toBe("Picked Ltd");
    });

    test("no popover is built at all where the lookup is switched off", () => {
      // The control still renders — the checkout needs a company field either
      // way — but a popover here binds the field's openers and moves every
      // keystroke into a query box whose searches can never run, with the manual
      // chip withheld for the same reason. The buyer could not type at all.
      document.body.innerHTML = controlMarkup("root5");
      const before = env.companyPanels.length;
      const disabled = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: document.getElementById("root5-field"),
        root: document.getElementById("root5"),
      });
      disabled.isCompanySearchEnabled = "";

      disabled.init();

      expect(env.companyPanels).toHaveLength(before);
    });

    test.each([
      ["TwoCompanySearchPanel", "the popover"],
      ["TwoCompanyIdentity", "the captured company"],
      ["TwoSoleTrader", "the signup flow"],
      ["TwoCompanyCaptureComponent", "the controller"],
    ])("a missing %s degrades to a plain field (%s)", (global) => {
      // A CSP or deploy failure on a base module must not take init() down.
      delete window[global];
      delete window.twoGatewayCompanyCaptureInstance;

      expect(() => component.mountCompanyPopover()).not.toThrow();
    });
  });

  describe("the search API", () => {
    test.each(SEARCH_API_CONTRACT.map((member) => [member]))(
      "the controller's search carries %s",
      (member) => {
        expect(capture().host().search[member]).toBeDefined();
      },
    );

    test("its threshold is this checkout's, not a literal", () => {
      component.minSearchChars = 7;

      expect(capture().host().search.MIN_INPUT_LENGTH).toBe(7);
      expect(component.capturePanelMinChars()).toBe(7);
    });

    test("results are mapped into the shape the panel renders", async () => {
      component.countryCode = "gb";
      const pending = component.capturePanelSearch({ term: "alpha" });
      await H.flushPromises();
      fetchStub.lastSearch().respond({
        items: [hit("Alpha Ltd", "12345678", "lookup-1")],
      });

      const result = await pending;

      expect(result.items).toHaveLength(1);
      expect(result.items[0].text).toBe("Alpha Ltd");
      expect(result.items[0].html).toContain("<em>");
      expect(result.items[0].companyId).toBe("12345678");
      expect(result.items[0].lookupId).toBe("lookup-1");
    });

    test("a hit with no lookup id keeps none", async () => {
      // Absent is what disables address autofill for that company; inventing one
      // would send the buyer's address off to a lookup that cannot answer.
      component.countryCode = "gb";
      const pending = component.capturePanelSearch({ term: "alpha" });
      await H.flushPromises();
      fetchStub
        .lastSearch()
        .respond({ items: [hit("Alpha Ltd", "12345678", undefined)] });

      const result = await pending;

      expect(result.items[0].lookupId).toBeUndefined();
    });

    test.each([
      [500, true, "a server error is the search being down"],
      [200, false, "a good response is not"],
    ])("status %i reports unavailable: %p (%s)", async (status, unavailable) => {
      // "The search is down" and "your company is not here" are different
      // answers to the buyer, and the panel paints them differently.
      component.countryCode = "gb";
      const pending = component.capturePanelSearch({ term: "alpha" });
      await H.flushPromises();
      fetchStub.lastSearch().respond({ items: [] }, status);

      expect((await pending).unavailable).toBe(unavailable);
    });

    test("abortActiveRequest says whether anything was actually in flight", async () => {
      expect(component.capturePanelAbort()).toBe(false);

      component.countryCode = "gb";
      const pending = component.capturePanelSearch({ term: "alpha" });
      await H.flushPromises();

      expect(component.capturePanelAbort()).toBe(true);
      await pending;
    });

    test("the panel's search reaches the live surface, not a captured one", () => {
      // Magewire replaces the component on every re-render while the controller
      // stays; a search API closed over one would answer from a dead component.
      component.minSearchChars = 4;
      const rebuilt = remount("root");
      rebuilt.minSearchChars = 9;

      expect(capture().host().search.MIN_INPUT_LENGTH).toBe(9);
    });
  });

  describe("selection", () => {
    test("a pick is mirrored onto this surface", () => {
      panel().options.onSelect({
        text: "Alpha Ltd",
        html: "<em>Alpha</em> Ltd",
        companyId: "12345678",
        lookupId: "lookup-1",
      });

      expect(component.companyName).toBe("Alpha Ltd");
      expect(component.companyId).toBe("12345678");
    });

    test("the field shows what is captured, not what was typed", () => {
      env.identity.write({ companyName: "Alpha Ltd" });

      expect(panel().options.getDisplayText()).toBe("Alpha Ltd");
    });
  });

  describe("the manual-entry handoff", () => {
    test("entering manual entry hands the field over to the buyer", () => {
      // The panel binds the field's own openers; without releasing it the
      // popover reopens over the input manual entry exists to be typed into.
      chip("manual").onActivate();

      expect(panel().calls).toContain("releaseField");
    });

    test("leaving it takes the field back and opens the search", () => {
      chip("manual").onActivate();
      panel().calls.length = 0;

      chip("registered").onActivate();

      // Reclaim BEFORE bind: coming back has to make the field a trigger again
      // before the panel is opened on it.
      expect(panel().calls.indexOf("reclaimField")).toBeGreaterThan(-1);
      expect(panel().calls.indexOf("bind")).toBeGreaterThan(
        panel().calls.indexOf("reclaimField"),
      );
    });

    test("the name typed in manual entry survives the way back out", () => {
      chip("manual").onActivate();
      field.value = "My Shop Ltd";

      component.onNameFieldInput();

      expect(panel().options.getDisplayText()).toBe("My Shop Ltd");
    });

    test("a search is not attempted while the lookup is switched off", async () => {
      // An unverified merchant must not have checkout-api requests put on the
      // wire for them, though the surface still mounts so the buyer has a field.
      component.isCompanySearchEnabled = "";

      const result = await component.capturePanelSearch({ term: "alpha" });

      expect(result.aborted).toBe(true);
      expect(result.items).toEqual([]);
      expect(fetchStub.searchCalls()).toHaveLength(0);
    });
  });

  describe("the chips", () => {
    test("all three are offered, in display order", () => {
      expect(panel().options.getChips().map((entry) => entry.mode)).toEqual([
        "registered",
        "soletrader",
        "manual",
      ]);
    });

    test.each([
      ["registered", "registered", "nothing else is selected by default"],
      ["manual", "manual", "manual entry selects its own chip"],
    ])("mode %s reads as selected: %s (%s)", (mode, expected) => {
      if (mode === "manual") chip("manual").onActivate();

      expect(panel().options.getSelectedMode()).toBe(expected);
    });

    test.each([
      [false, false, "the registry has no sole traders here"],
      [true, true, "it does"],
    ])(
      "sole trader available %p is offered %p (%s)",
      (available, expected) => {
        env.identity.soleTraderAvailable(available);

        expect(panel().options.isChipVisible("soletrader")).toBe(expected);
      },
    );

    test("each chip carries something to run", () => {
      panel()
        .options.getChips()
        .forEach((entry) => {
          expect(typeof entry.onActivate).toBe("function");
          expect(typeof entry.text).toBe("string");
        });
    });
  });
});
