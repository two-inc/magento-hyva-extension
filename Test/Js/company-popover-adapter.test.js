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

    test("a rebuild that KEEPS the input tears the abandoned panel down", () => {
      /*
       * The case connectedness cannot see, and the one Magewire actually takes
       * most of the time: it morphs the DOM and leaves the input in place. A
       * re-render re-invokes the Alpine factory, so the rebuilt component gets
       * a FRESH closure whose panel is null and builds a second one — and the
       * base panel ADOPTS the existing panel DOM rather than duplicating it,
       * which hides the problem. Two instances then hold listeners on the same
       * input, `_unbind` is per-instance, and one keystroke searches twice.
       */
      const abandoned = panel();
      expect(abandoned.getField()[0]).toBe(field);
      expect(field.isConnected).toBe(true);

      const rebuilt = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: field,
        root: document.getElementById("root"),
      });
      rebuilt.init();

      expect(abandoned.calls).toContain("destroy");
    });

    test("a rebuild that REPLACED the input tears it down too", () => {
      const abandoned = panel();
      document.body.innerHTML = [
        '<div id="root3" class="two-company-search">',
        '  <input type="text" id="field3" value="" />',
        "</div>",
      ].join("\n");
      // The panel still holds the node it attached to; that node is now
      // detached, which is the other half of "abandoned".
      expect(abandoned.getField()[0].isConnected).toBe(false);

      const rebuilt = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: document.getElementById("field3"),
        root: document.getElementById("root3"),
      });
      rebuilt.init();

      expect(abandoned.calls).toContain("destroy");
    });

    test("a panel on a DIFFERENT field is left alone", () => {
      // Two mounts on one page are legitimate — the address field renderer
      // mounts on the delivery form AND the invoice form — so what makes a
      // panel abandoned is another taking ITS field, not there being two.
      const first = panel();
      const second = document.createElement("div");
      second.className = "two-company-search";
      second.innerHTML = '<input type="text" id="field4" value="" />';
      document.body.appendChild(second);

      const other = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: document.getElementById("field4"),
        root: second,
      });
      other.init();

      expect(first.calls).not.toContain("destroy");
      expect(first.getField()[0]).toBe(field);
      expect(env.companyPanels[env.companyPanels.length - 1].getField()[0])
        .toBe(document.getElementById("field4"));
    });

    test("a company already in the field survives the mount", () => {
      // A returning customer's saved company arrives in the input's
      // server-rendered value, and nothing on the Two side has read it. The
      // panel repaints the field from getDisplayText() as it attaches, so a
      // getter that answered '' would wipe the company AND carry the wipe into
      // the quote on the `change` it fires.
      document.body.innerHTML = [
        '<div id="root2" class="two-company-search">',
        '  <input type="text" id="field2" value="Existing Trading Ltd" />',
        "</div>",
      ].join("\n");
      const rebuilt = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: document.getElementById("field2"),
        root: document.getElementById("root2"),
      });
      rebuilt.init();

      expect(panel().options.getDisplayText()).toBe("Existing Trading Ltd");
    });

    test("a captured company still wins over what the field held", () => {
      // Both terms populated and DIFFERENT, or the precedence this names is
      // untested — with an empty field value either ordering returns the same
      // thing.
      component.search = "Typed Ltd";
      component.companyName = "Picked Ltd";

      expect(panel().options.getDisplayText()).toBe("Picked Ltd");
    });


    test("no popover is built at all where the lookup is switched off", () => {
      // The control still renders — the checkout needs a company field either
      // way — but a popover here binds the field's openers and moves every
      // keystroke into a query box whose searches can never run, with the
      // manual chip withheld for the same reason. The buyer could not type a
      // company name at all.
      // A FRESH component, not the mounted one: re-calling mount on a
      // component that already built its panel takes the re-point branch and
      // adds nothing either way, so it cannot tell the gate from its absence.
      document.body.innerHTML = [
        '<div id="root5" class="two-company-search">',
        '  <input type="text" id="field5" value="" />',
        "</div>",
      ].join("\n");
      const before = env.companyPanels.length;
      const disabled = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: document.getElementById("field5"),
        root: document.getElementById("root5"),
      });
      disabled.isCompanySearchEnabled = "";

      disabled.init();

      expect(env.companyPanels).toHaveLength(before);
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

    test("the name typed in manual entry survives the way back out", () => {
      // `commitManualCompany()` writes `search` and deliberately never
      // `companyName`, so a display text reading only the latter lets
      // reclaimField()'s repaint overwrite what the buyer typed.
      component.enterManually();
      field.value = "My Shop Ltd";
      component.onNameFieldInput();

      expect(panel().options.getDisplayText()).toBe("My Shop Ltd");
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
