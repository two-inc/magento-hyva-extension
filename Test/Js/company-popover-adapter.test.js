/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25503 — this checkout's half of the shared-popover contract.
 *
 * The popover is the base plugin's `company-search-panel.js`. It is not in this
 * repo and cannot be loaded here, so what is testable is the ADAPTER: the
 * options handed to the panel, and the six-member search API built over the
 * engine. Those are also the only places drift can enter — the panel owns the
 * copy, the class names and the DOM order, so neither checkout can move those
 * without editing the shared file.
 *
 * The harness stub records rather than swallows (`.options`, `.calls`), because
 * a stub that dropped its options would make every assertion here vacuous.
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

/** A search response shaped the way the API returns one. */
function hit(name, identifier, lookupId) {
  return {
    name: name,
    highlight: "<em>" + name + "</em>",
    national_identifier: identifier === null ? null : { id: identifier },
    lookup_id: lookupId,
  };
}

describe("the Hyvä adapter over the shared popover", () => {
  let env;
  let fetchStub;
  let component;
  let field;

  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="root" class="two-company-search">',
      '  <input type="text" id="field" value="" />',
      "</div>",
    ].join("\n");
    field = document.getElementById("field");

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

  /** @returns {Object} the panel this component built */
  function panel() {
    return env.companyPanels[env.companyPanels.length - 1];
  }

  describe("mounting", () => {
    test("init() builds exactly one panel", () => {
      expect(env.companyPanels).toHaveLength(1);
    });

    test("a Magewire rebuild re-points that panel rather than building a second", () => {
      // initialize()/init() runs again on every re-render. A second panel would
      // leave two popovers writing to one identity.
      component.mountCompanyPopover();
      component.mountCompanyPopover();

      expect(env.companyPanels).toHaveLength(1);
      expect(panel().calls.filter((call) => call === "bind").length).toBeGreaterThan(1);
    });

    test.each([
      ["fieldSelector", "string"],
      ["search", "object"],
      ["translate", "function"],
      ["getCountryCode", "function"],
      ["getChips", "function"],
      ["isChipVisible", "function"],
      ["getSelectedMode", "function"],
      ["getDisplayText", "function"],
      ["onSelect", "function"],
      ["onExitManualEntry", "function"],
    ])("the panel is given %s (a %s)", (option, type) => {
      expect(typeof panel().options[option]).toBe(type);
    });

    test("the field is addressed by an attribute of ours, not its id", () => {
      // The address-step renderer mounts on the delivery form AND the invoice
      // form, and the panel resolves its host with a document-wide
      // querySelector — so a selector that is not per-mount gives both mounts
      // the same field. The id comes from Hyvä's entity-field config and can
      // hold anything a selector would have to escape.
      expect(panel().options.fieldSelector).toBe(
        '[data-two-company-panel="' + field.dataset.twoCompanyPanel + '"]',
      );
      expect(document.querySelectorAll(panel().options.fieldSelector)).toHaveLength(1);
    });

    test("a missing panel module degrades to a plain field rather than throwing", () => {
      // A CSP or deploy failure on the base module must not take init() down.
      delete window.TwoCompanySearchPanel;

      expect(() => component.mountCompanyPopover()).not.toThrow();
    });
  });

  describe("the search API", () => {
    test.each(SEARCH_API_CONTRACT.map((member) => [member]))(
      "carries %s",
      (member) => {
        expect(component.companyPopoverSearchApi()[member]).toBeDefined();
      },
    );

    test("its threshold is this checkout's, not a literal", () => {
      component.minSearchChars = 7;

      expect(component.companyPopoverSearchApi().MIN_INPUT_LENGTH).toBe(7);
    });

    test("results are mapped into the shape the panel renders", async () => {
      component.countryCode = "gb";
      const pending = component
        .companyPopoverSearchApi()
        .searchCompanies({ term: "alpha" });
      await H.flushPromises();
      fetchStub.last().respond({
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
      // Absent is what disables address autofill for that company; inventing
      // one would send the buyer's address off to a lookup that cannot answer.
      component.countryCode = "gb";
      const pending = component
        .companyPopoverSearchApi()
        .searchCompanies({ term: "alpha" });
      await H.flushPromises();
      fetchStub.last().respond({ items: [hit("Alpha Ltd", "12345678", undefined)] });

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
      const pending = component
        .companyPopoverSearchApi()
        .searchCompanies({ term: "alpha" });
      await H.flushPromises();
      fetchStub.last().respond({ items: [] }, status);

      expect((await pending).unavailable).toBe(unavailable);
    });

    test("abortActiveRequest says whether anything was actually in flight", async () => {
      const api = component.companyPopoverSearchApi();
      expect(api.abortActiveRequest()).toBe(false);

      component.countryCode = "gb";
      const pending = api.searchCompanies({ term: "alpha" });
      await H.flushPromises();

      expect(api.abortActiveRequest()).toBe(true);
      await pending;
    });
  });

  describe("selection", () => {
    test("a pick is handed back to the engine in the engine's own shape", () => {
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
      component.companyName = "Alpha Ltd";

      expect(panel().options.getDisplayText()).toBe("Alpha Ltd");
    });
  });

  describe("the manual-entry handoff", () => {
    test("entering manual entry hands the field over to the buyer", () => {
      // The panel binds the field's own openers; without releasing it the
      // popover reopens over the input manual entry exists to be typed into.
      component.enterManually();

      expect(panel().calls).toContain("releaseField");
    });

    test("leaving it takes the field back and opens the search", () => {
      component.enterManually();
      panel().calls.length = 0;

      component.enableSearch();

      // Reclaim BEFORE bind: coming back has to make the field a trigger again
      // before the panel is opened on it.
      expect(panel().calls.indexOf("reclaimField")).toBeGreaterThan(-1);
      expect(panel().calls.indexOf("bind")).toBeGreaterThan(
        panel().calls.indexOf("reclaimField"),
      );
    });

    test("a search is not attempted while the lookup is switched off", async () => {
      // The gate the deleted control held: this surface still mounts so the
      // buyer has a company field, but an unverified merchant must not have
      // checkout-api requests put on the wire for them.
      component.isCompanySearchEnabled = "";

      const result = await component
        .companyPopoverSearchApi()
        .searchCompanies({ term: "alpha" });

      expect(result.aborted).toBe(true);
      expect(result.items).toEqual([]);
      expect(fetchStub.calls).toHaveLength(0);
    });
  });

  describe("the chips", () => {
    test("all three are offered, in display order", () => {
      expect(component.companyPopoverChips().map((chip) => chip.mode)).toEqual([
        "registered",
        "soletrader",
        "manual",
      ]);
    });

    test.each([
      ["registered", "registered", "nothing else is selected by default"],
      ["manual", "manual", "manual entry selects its own chip"],
    ])("mode %s reads as selected: %s (%s)", (mode, expected) => {
      if (mode === "manual") component.enterManually();

      expect(component.companyPopoverSelectedMode()).toBe(expected);
    });

    test("sole trader is offered only where the registry has them", () => {
      component.showModeTab = false;
      expect(component.companyPopoverModeOffered("soletrader")).toBe(false);

      component.showModeTab = true;
      expect(component.companyPopoverModeOffered("soletrader")).toBe(true);
    });

    test("each chip carries something to run", () => {
      component.companyPopoverChips().forEach((chip) => {
        expect(typeof chip.onActivate).toBe("function");
        expect(typeof chip.text).toBe("string");
      });
    });
  });
});
