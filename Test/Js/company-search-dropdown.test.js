/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 §1/§2/§4, TWO-25503 — the Hyvä address step's company capture.
 *
 * Before TWO-25326 the address step had no dropdown architecture at all: the
 * company-name input was the search box, results were an overlay hanging off
 * it, and the ticket records that as "a plain in-field autocomplete". Almost
 * every §1 bullet failed as a consequence — no query field, no spinner, no
 * zero-result wording, a threshold hint that waited for a keystroke, Escape
 * doing nothing.
 *
 * TWO-25503 then replaced this checkout's own answer to all of that with the
 * base plugin's shared popover, so the query field, the results, the verdict
 * lines, the mode chips and every key and focus decision are now
 * `Two_Gateway/js/model/company-search-panel.js` — a file this repo neither
 * ships nor can load, covered against the real thing in magento-plugin's suite.
 *
 * What is left here, and what this suite is now about, is the seam: the
 * company-name field this checkout renders, and the options it hands the panel.
 * Every §1 verdict the ticket names is still pinned — as the shape
 * `searchCompanies()` answers with, which is what the panel paints them from.
 *
 * On the limits of jsdom, stated rather than papered over: it performs no
 * layout and runs no Alpine, so `x-show` never actually hides anything here and
 * geometry cannot be asserted at all. The PrestaShop leg of this ticket found
 * two real defects that only a laid-out browser could see, so nothing in this
 * file is offered as a substitute for the live run.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

/** The shipped markup, parsed. */
function shippedDoc() {
  const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("address-step company capture (TWO-25326 §1/§2/§4, TWO-25503)", () => {
  describe("the control's structure, read off the shipped template", () => {
    test("§1 the company-name field is a plain input the panel can drive", () => {
      // The panel binds `mousedown`, `focus`, `keydown` and `input` on this
      // field natively and moves what arrives into its own query box. A
      // `readonly` field — which is how this checkout used to hold the captured
      // name steady — would take paste and IME input off the table entirely.
      const name = shippedDoc().querySelector(".two-company-search > input");

      expect(name).not.toBeNull();
      expect(name.hasAttribute("readonly")).toBe(false);
      expect(name.getAttribute(":readonly")).toBeNull();
      // The hint is inside the panel now, so a reference to it from out here
      // would point at an id that exists only while the panel is open.
      expect(name.getAttribute("aria-describedby")).toBeNull();
      // Survives for MANUAL entry, where the panel has released the field and
      // this input is the capture control.
      expect(name.getAttribute("@input.debounce.300ms")).toBe(
        "onNameFieldInput",
      );
    });

    test("every handler the markup binds actually exists on the component", () => {
      // A binding that resolves to nothing is this repo's recurring failure
      // mode — CSP-friendly Alpine looks the whole attribute string up as a key
      // and no-ops silently when it is absent, so the page shows no error at
      // all. Sweep every Alpine binding in the subtree against a real instance.
      const env = H.installHyvaEnvironment();
      try {
        H.loadSharedHelpers();
        H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
        env.fireAlpineInit();
        const component = H.mountComponent(env.alpineComponents[COMPONENT_NAME]);

        const doc = shippedDoc();
        const root = doc.querySelector(".two-company-search");
        const elements = [root].concat(Array.from(root.querySelectorAll("*")));
        const missing = [];
        elements.forEach(function (el) {
          Array.from(el.attributes || []).forEach(function (attr) {
            const isBinding =
              attr.name.charAt(0) === "@" ||
              attr.name.charAt(0) === ":" ||
              attr.name === "x-show" ||
              attr.name === "x-text";
            if (!isBinding) return;
            const expression = attr.value;
            // Bare property names only; `x-for`/`x-html` scope vars and the
            // `item.*` paths are resolved per-row by Alpine, not off the
            // component.
            if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expression)) return;
            if (!(expression in component)) {
              missing.push(el.tagName + "[" + attr.name + "=" + expression + "]");
            }
          });
        });
        expect(missing).toEqual([]);
      } finally {
        env.restore();
      }
    });

    test("§1 zero results are worded 'No matches found', exactly", () => {
      // Exact, because Luma shipped "No results found" and the ticket counts
      // that as a failure.
      //
      // Read off the raw template rather than the rendered markup: the harness
      // resolves every `__()` to one placeholder string, so a rendered
      // assertion could not tell this copy from any other in the file. Comments
      // are stripped first — this template's own prose names the wrong wording
      // in order to warn against it.
      const source = fs
        .readFileSync(path.join(H.REPO_ROOT, H.GATEWAY_METHOD_TEMPLATE), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

      expect(source).toContain("__('No matches found')");
      expect(source).not.toContain("No results found");
    });
  });

  describe("what this checkout hands the shared panel", () => {
    let env;
    let fetchStub;
    let component;
    let nameField;
    let root;
    let panel;
    let searchApi;

    beforeEach(() => {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      document.body.innerHTML =
        '<div id="address-container"><div><div><div>' +
        markup +
        "</div></div></div></div>";

      env = H.installHyvaEnvironment();
      fetchStub = H.stubFetch();
      jest.spyOn(console, "error").mockImplementation(() => {});

      H.loadSharedHelpers();
      H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
      env.fireAlpineInit();

      root = document.querySelector(".two-company-search");
      nameField = document.querySelector(".two-company-search > input");

      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: nameField,
        root: root,
      });
      component.init();

      expect(env.companyPanels).toHaveLength(1);
      panel = env.companyPanels[0];
      searchApi = panel.options.search;
    });

    /** @returns {Object} the one page-level capture controller */
    function capture() {
      return env.captureControllers[env.captureControllers.length - 1];
    }

    afterEach(() => {
      fetchStub.restore();
      env.restore();
      document.body.innerHTML = "";
    });

    /**
     * Run a search and leave the request in flight.
     *
     * @param {string} term
     * @returns {Promise<{pending: Promise}>} wrapped, never returned bare: an
     *   async function returning a promise adopts it, so the caller would block
     *   on a request it has not settled yet.
     */
    async function search(term) {
      const pending = searchApi.searchCompanies({ term: term });
      await H.flushPromises();
      return { pending: pending };
    }

    /** One registry hit, in the API's own shape. */
    const ONE_HIT = {
      items: [
        {
          name: "Acme Ltd",
          highlight: "<em>Acme</em> Ltd",
          national_identifier: { id: "123456789" },
          lookup_id: "lookup-1",
        },
      ],
    };

    test("§1 the debounce is 300ms, and the panel is what applies it", () => {
      // The engine no longer debounces, so a missing value here means every
      // keystroke goes on the wire.
      expect(searchApi.SEARCH_DEBOUNCE_MS).toBe(300);
    });

    test("the term on the wire is the panel's, not the company-name field's", () => {
      // The bug the split exists to prevent: with one shared value, the company
      // name a buyer had already chosen was overwritten by, or searched instead
      // of, whatever was typed next.
      nameField.value = "Previously Chosen Ltd";

      return search("acm").then(function () {
        expect(fetchStub.searchCalls()).toHaveLength(1);
        expect(fetchStub.searchCalls()[0].url).toMatch(/acm/);
        expect(fetchStub.searchCalls()[0].url).not.toMatch(/Previously/);
        expect(nameField.value).toBe("Previously Chosen Ltd");
      });
    });

    test("§1 the searching state is up while the request is in flight and down after", async () => {
      const { pending } = await search("acm");
      expect(component.isSearching).toBe(true);

      fetchStub.searchCalls()[0].respond({ items: [] });
      await pending;

      expect(component.isSearching).toBe(false);
    });

    /*
     * The §1 verdicts. The panel paints them, but it paints them from THIS
     * shape, so an empty result set that claimed to be a failure — or a failure
     * that came back as an empty result set — would put the wrong line on
     * screen with nothing else in CI able to notice.
     */
    test.each([
      [
        function (call) {
          call.respond({ items: [] });
        },
        { count: 0, unavailable: false },
        "no matches is a verdict, not a failure",
      ],
      [
        function (call) {
          call.respond({}, 500);
        },
        { count: 0, unavailable: true },
        "a failure is not a verdict on whether the company exists",
      ],
      [
        function (call) {
          call.respond(ONE_HIT);
        },
        { count: 1, unavailable: false },
        "hits leave nothing to explain",
      ],
    ])("§1 a settled search answers %#: %p (%s)", async (settle, expected) => {
      const { pending } = await search("acm");

      // In flight there is no verdict yet, so anything the panel could paint
      // from would be a claim the buyer acts on before it is true.
      expect(component.isSearching).toBe(true);

      settle(fetchStub.searchCalls()[0]);
      const result = await pending;

      expect(result.aborted).toBe(false);
      expect(result.items).toHaveLength(expected.count);
      expect(result.unavailable).toBe(expected.unavailable);
    });

    test("a superseded search answers ABORTED rather than with the earlier term's results", async () => {
      // Painting from it would show the buyer results for a term they have
      // already typed past.
      const first = searchApi.searchCompanies({ term: "acm" });
      const second = searchApi.searchCompanies({ term: "acme" });
      await H.flushPromises();

      fetchStub.searchCalls()[0].respond({ items: [] });
      const firstResult = await first;

      expect(firstResult.aborted).toBe(true);
      expect(firstResult.items).toHaveLength(0);

      fetchStub.searchCalls()[1].respond(ONE_HIT);
      await second;
    });

    test("a query below the threshold puts nothing on the wire", async () => {
      const result = await searchApi.searchCompanies({ term: "ac" });

      expect(fetchStub.searchCalls()).toHaveLength(0);
      expect(result.items).toHaveLength(0);
      // Not a failure either — the panel's own hint is what explains this
      // state, and an "unavailable" line over it would contradict it.
      expect(result.unavailable).toBe(false);
    });

    test("§1 taking a result fills the NAME field and captures the identifier", async () => {
      const { pending } = await search("acm");
      fetchStub.searchCalls()[0].respond(ONE_HIT);
      const result = await pending;

      panel.options.onSelect(result.items[0]);

      // The panel repaints the field from this getter, so what it is told is
      // what the buyer ends up looking at.
      expect(panel.options.getDisplayText()).toBe("Acme Ltd");
      expect(component.companyName).toBe("Acme Ltd");
      expect(component.companyId).toBe("123456789");
      expect(component.companyIdSource).toBe("registry");
      // §5: the number is displayed, read-only, only for a registry-supplied
      // identifier.
      expect(component.companyIdDisplayVisible).toBe(true);
      // The chips are repainted, so the mode the pick put the control in reads
      // as selected.
      expect(panel.calls.some((call) => call.startsWith("syncChips:registered"))).toBe(true);
    });

    test.each([
      ["123456789", "<em>Acme</em> Ltd (123456789)", "a registry number is shown"],
      ["TWO:ST-0001", "<em>Acme</em> Ltd", "an internal placeholder is not"],
    ])("§1 a results row renders %s as %p (%s)", async (identifier, expected) => {
      const { pending } = await search("acm");
      fetchStub.searchCalls()[0].respond({
        items: [
          {
            name: "Acme Ltd",
            highlight: "<em>Acme</em> Ltd",
            national_identifier: { id: identifier },
            lookup_id: "lookup-1",
          },
        ],
      });
      const result = await pending;

      // The panel renders `html`; `text` is what it puts in the field on a
      // pick, so it never carries a number in either case.
      expect(result.items[0].html).toBe(expected);
      expect(result.items[0].text).toBe("Acme Ltd");
      expect(result.items[0].companyId).toBe(identifier);
      // Never synthesised: an absent lookupId is what disables address autofill.
      expect(result.items[0].lookupId).toBe("lookup-1");
    });

    test("§2 entering manual entry hands the field back to the buyer", () => {
      capture().manualEntryMode();

      expect(component.manualMode).toBe(true);
      expect(panel.calls).toContain("releaseField");
    });

    test("§3 returning to search takes the field back and reopens the panel", () => {
      capture().manualEntryMode();

      panel.options.onExitManualEntry();

      expect(component.manualMode).toBe(false);
      expect(panel.calls).toContain("reclaimField");
      // Reopened, not merely rebound: leaving it shut would make manual entry a
      // one-way door for a buyer who chose it by accident.
      expect(panel.calls.lastIndexOf("bind")).toBeGreaterThan(
        panel.calls.indexOf("reclaimField"),
      );
    });

    test("an aborted search reports whether anything was actually in flight", async () => {
      expect(searchApi.abortActiveRequest()).toBe(false);

      const { pending } = await search("acm");
      expect(searchApi.abortActiveRequest()).toBe(true);
      await pending;
    });
  });

  describe("behaviour, driven against the shipped markup", () => {
    let env;
    let fetchStub;
    let component;
    let nameField;
    let root;

    beforeEach(() => {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      document.body.innerHTML =
        '<div id="address-container"><div><div><div>' +
        markup +
        "</div></div></div></div>";

      env = H.installHyvaEnvironment();
      fetchStub = H.stubFetch();
      jest.spyOn(console, "error").mockImplementation(() => {});

      H.loadSharedHelpers();
      H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
      env.fireAlpineInit();

      root = document.querySelector(".two-company-search");
      nameField = document.querySelector(".two-company-search > input");

      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: nameField,
        root: root,
      });
      component.init();
    });

    afterEach(() => {
      fetchStub.restore();
      env.restore();
      document.body.innerHTML = "";
    });

    /** @returns {Object} the one page-level capture controller */
    function capture() {
      return env.captureControllers[env.captureControllers.length - 1];
    }

    test("§5 manual entry announces the pair, so an already-mounted tile updates", () => {
      // Review round 1. Deleting the address step's editable number input took
      // `onCompanyIdInput()` — the only dispatcher on the manual path — out of
      // the DOM with it, so manual entry wrote localStorage and announced
      // nothing. A payment tile that is already mounted syncs from this event,
      // not from storage, and so kept the previous company.
      const heard = [];
      const listener = function (e) {
        heard.push(e.detail);
      };
      window.addEventListener("shipping-company-selected", listener);
      try {
        capture().manualEntryMode();
        nameField.value = "Widgets Inc";
        component.$el = nameField;
        component.onNameFieldInput();

        expect(heard).toHaveLength(1);
        expect(heard[0].company_name).toBe("Widgets Inc");
      } finally {
        window.removeEventListener("shipping-company-selected", listener);
      }
    });

    test("clearing the manual company name CLEARS it from storage too", () => {
      // Review round 2. `commitCompanyName()` used to early-return on
      // `search === companyName`, and with no prior pick `companyName` is ''
      // for the whole page load — so deleting a typed name hit `'' === ''`,
      // returned, and left the deleted name in storage. announceCompanyPair()
      // then broadcast it, and the payment step repopulated the tile from it:
      // an empty address field, the deleted company on the order.
      const heard = [];
      const listener = function (e) {
        heard.push(e.detail);
      };
      window.addEventListener("shipping-company-selected", listener);
      try {
        capture().manualEntryMode();
        nameField.value = "Acme Ltd";
        component.$el = nameField;
        component.onNameFieldInput();

        nameField.value = "";
        component.onNameFieldInput();

        expect(component.search).toBe("");
        expect(heard[heard.length - 1].company_name).toBe("");
      } finally {
        window.removeEventListener("shipping-company-selected", listener);
      }
    });

    test("a name edit drops an identifier that belonged to another name, and still announces", () => {
      // Rounds 2 and 3. `forgetStaleCompanyId()` used to spare a
      // `manual`-sourced identifier, and with the address step's own number
      // input gone (§5) nothing here can write or correct one — so an id left
      // in storage by an earlier session rode along with every debounced
      // keystroke, arming an order intent for a half-typed name beside somebody
      // else's number.
      //
      // Round 2 suppressed the ANNOUNCEMENT in that state, which was worse: the
      // buyer then silently stopped announcing anything for the rest of the
      // page load, reinstating the stale-submission bug the announcement exists
      // to prevent. The fix is to drop the mismatched id instead, so the pair
      // announced is always coherent.
      const heard = [];
      const listener = function (e) {
        heard.push(e.detail);
      };
      window.addEventListener("shipping-company-selected", listener);
      try {
        env.identity.write(
          {
            companyName: "Some Other Company Ltd",
            companyId: "99999999",
            companyIdSource: "registry",
          },
          { authoritative: true },
        );
        heard.length = 0;

        nameField.value = "Ac";
        component.$el = nameField;
        capture().commitManualCompany(nameField.value);

        // The announcement still happens — silence is what round 2 got wrong.
        expect(heard.length).toBeGreaterThan(0);
        // Every one of them carries a coherent pair, and the last is the new
        // name with NO identifier. The dropped number and the new name arrive
        // as two notifications, so "the last one is right" is not enough on its
        // own: the stale number must never be paired with the new name.
        expect(
          heard.some(
            (detail) => detail.company_name === "Ac" && detail.company_id,
          ),
        ).toBe(false);
        expect(heard[heard.length - 1].company_name).toBe("Ac");
        expect(heard[heard.length - 1].company_id).toBe("");
        expect(heard[heard.length - 1].company_id_source).toBe("");
        expect(component.companyId).toBe("");
      } finally {
        window.removeEventListener("shipping-company-selected", listener);
      }
    });

    test("init() restores a stored pick WITHOUT reconciling it against the field", () => {
      // Reverted in review round 3, and the revert is deliberate.
      //
      // Round 2 added a guard that dropped a restored pair when the
      // company-name field held a different name — the case where the payment
      // tile has overwritten the address step's pick in the ONE shared blob.
      // Round 3 showed it destroys a GOOD pick instead: `wire:model.defer`
      // means the server's `address.company` lags the client value, so a
      // Magewire re-render landing before the roundtrip rebuilds the field from
      // the stale name and the guard discards a perfectly correct pick.
      //
      // Both directions are heuristics over one storage key being asked to hold
      // two different companies. That needs a billing-scoped key, which is a
      // design change written up on TWO-25326, not guessed at here. This test
      // pins the unguarded behaviour so the guard cannot be reinstated silently
      // as "an obvious fix".
      nameField.value = "Address Company Ltd";
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          company_name: "Tile Company Ltd",
          company_id: "77777777",
          company_id_source: "registry",
        }),
      );

      const restored = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: nameField,
        root: root,
      });
      restored.init();

      expect(restored.companyId).toBe("77777777");
      expect(restored.isCompanySelected).toBe(true);
    });

    test("§5 the company-number label does not survive into manual entry", () => {
      // enterManually() deliberately does not clear a previous pick, and the
      // stale-pair clear only fires once the typed name has diverged — so a
      // buyer who picked a company and then chose "not on the list" kept a
      // registry-vouched number, and the label went on showing it. §5 requires
      // manual entry to show no number at all.
      env.identity.write(
        {
          companyName: "Acme Ltd",
          companyId: "123456789",
          companyIdSource: "registry",
        },
        { authoritative: true },
      );
      expect(component.companyIdDisplayVisible).toBe(true);

      capture().manualEntryMode();

      expect(component.manualMode).toBe(true);
      expect(component.companyIdDisplayVisible).toBe(false);
    });
  });
});
