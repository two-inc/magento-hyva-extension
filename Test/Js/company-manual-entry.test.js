/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288 element 5 — the manual-entry affordance on the address step.
 *
 * The wording is the cheap part. What this suite is actually about is the three
 * things that made the affordance not work:
 *
 *  - TIMING. The row lives inside the results dropdown, and the dropdown used
 *    to be gated on `items.length > 0`. So the one route into manual entry
 *    appeared only once a search had fired AND matched — it was absent in
 *    exactly the case it exists for, a buyer whose company the registry does
 *    not have. The row must be there as soon as the query is long enough to
 *    search, before the debounce and with no results at all.
 *  - KEYBOARD. It was a bare `<span>` with a click handler: no role, no
 *    tabindex, no keydown. Not reachable by keyboard in any way.
 *  - DUPLICATION. There are two routes into manual entry on this surface and
 *    they now carry identical copy, so exactly one may be on screen at a time.
 *
 * Two traps this suite has to stay out of, both proven in this repo:
 *
 *  - the harness resolves EVERY `__()` to one placeholder string, so an
 *    assertion on rendered link text cannot tell one string from another and
 *    would pass over any wording at all. The msgid is therefore pinned at
 *    source level, and the rendered assertions are about structure and
 *    attributes.
 *  - the markup is server-rendered, so a DOM-only assertion passes with the
 *    Alpine component entirely absent. Every behavioural assertion goes through
 *    a mounted component and `expectBootstrapped()` fails loudly if the mount
 *    produced nothing.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

/**
 * The exact English source string, character for character.
 *
 * It resolves against dictionaries the base Two Magento module ships — this
 * repo carries no catalogue of its own — so a reworded key falls silently back
 * to English in every other locale. The same string is used by both routes into
 * manual entry deliberately: one dictionary row serves both.
 */
const MANUAL_ENTRY_MSGID = "My company is not on the list";

/** The reverse link's msgid, which already existed and must not change. */
const SEARCH_AGAIN_MSGID = "Search for company";

/** The wording this replaces. It must be gone from this surface entirely. */
const REPLACED_MSGID = "Enter details manually";

/**
 * A threshold that is NOT the production 3, injected in place of it.
 *
 * The whole timing question is "at which typed length does the row appear", so
 * a fixture that used 3 would agree with a leftover literal 3 and prove
 * nothing. Larger than 3 so a literal is wrong in both directions.
 */
const INJECTED_MIN = 5;

const INJECT_RULE = [
  [/^\(int\) \$companySearchMinChars$/, String(INJECTED_MIN)],
];

/**
 * The in-dropdown row and the way back.
 *
 * `.two-company-manual-entry` (the second, below-the-field copy of this
 * affordance) was REMOVED 2026-07-28 (bug 4.2) — it stayed visible whenever
 * the panel was shut, including an untouched field and a completed
 * selection, both states its own wording is false in. The row is now the
 * sole route into manual entry, and it is asserted absent below.
 */
const ROW_SELECTOR = ".two-company-manual-entry-row";
const REMOVED_PERSISTENT_SELECTOR = ".two-company-manual-entry";
const SEARCH_AGAIN_SELECTOR = ".two-company-search-again";

/** The min-characters hint (TWO-25288 element 4), reused for the round-2 gap. */
const MIN_CHARS_SELECTOR = ".two-company-search__min-chars";

/** Every affordance that must answer the keyboard, with the action it runs. */
const KEYBOARD_AFFORDANCES = [
  { label: "in-dropdown row", selector: ROW_SELECTOR, action: "enterManually" },
  {
    label: "search-again link",
    selector: SEARCH_AGAIN_SELECTOR,
    action: "enableSearch",
  },
];

/**
 * A template's source, verbatim and un-substituted.
 *
 * @param {string} relPath repo-relative template path
 * @returns {string}
 */
function templateSource(relPath) {
  return fs.readFileSync(path.join(H.REPO_ROOT, relPath), "utf8");
}

/** @returns {Document} the shipped markup, parsed */
function renderDoc() {
  const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
  return new DOMParser().parseFromString(markup, "text/html");
}

/**
 * Fail loudly if the mount produced no component.
 *
 * Both links are in the server-rendered markup, so a suite that skipped the
 * mount would still find them and pass with nothing bound to anything.
 *
 * @param {Object|undefined} component
 * @returns {Object}
 */
function expectBootstrapped(component) {
  if (component === undefined || component === null) {
    throw new Error(
      "bootstrap check: no Alpine component registered as `" +
        COMPONENT_NAME +
        "`. Every behavioural assertion here depends on the mounted component; " +
        "the server-rendered markup alone would satisfy the DOM ones with the " +
        "component absent.",
    );
  }
  // A threshold the component does not carry means every guard compared
  // against `undefined`, which is false for `>=` — the row would never open.
  expect(typeof component.minSearchChars).toBe("number");
  expect(component.minSearchChars).toBe(INJECTED_MIN);
  return component;
}

describe("address-step manual-entry affordance", () => {
  let env;
  let fetchStub;
  let component;
  let field;
  let root;

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="root"><input type="text" id="field" value="" /></div>';
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
   * Type into the field the way the undebounced binding does.
   *
   * @param {string} value
   * @returns {void}
   */
  function type(value) {
    field.value = value;
    component.noteCompanyQuery();
  }

  describe("wording", () => {
    test("both routes use the exact English source string", () => {
      // Asserted at SOURCE level, not on rendered text: the harness resolves
      // every `__()` to one placeholder, so a rendered-text assertion would
      // pass over any wording whatsoever, the old one included.
      const source = templateSource(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const occurrences = source.split('__("' + MANUAL_ENTRY_MSGID + '")');

      // Exactly twice — the in-dropdown row AND the restored below-the-field
      // link (bug 4.2 round 2). One occurrence would mean the below-field
      // copy is missing again; three would mean a genuine duplicate.
      expect(occurrences).toHaveLength(3);
    });

    test("the replaced wording is gone from this surface", () => {
      // Both routes previously read "Enter details manually". Leaving either on
      // the old string is the failure this catches, and it is invisible to any
      // assertion on rendered text.
      expect(templateSource(H.COMPANY_NAME_MARKUP_TEMPLATE)).not.toContain(
        REPLACED_MSGID,
      );
    });

    test("the reverse link keeps its existing wording", () => {
      // Already translated in the base module's catalogues on every locale, so
      // rewording it would strand it in English for no reason.
      expect(templateSource(H.COMPANY_NAME_MARKUP_TEMPLATE)).toContain(
        '__("' + SEARCH_AGAIN_MSGID + '")',
      );
    });

    test("this repo still ships no translation dictionary of its own", () => {
      // The msgid resolves against the base module's catalogues, which Magento
      // merges per locale. An i18n directory here would shadow that.
      expect(fs.existsSync(path.join(H.REPO_ROOT, "i18n"))).toBe(false);
    });
  });

  describe("position", () => {
    test("the row is inside the dropdown, after the results", () => {
      const doc = renderDoc();
      const panel = doc.querySelector("[x-show='showDropdown']");
      const row = doc.querySelector(ROW_SELECTOR);
      const results = doc.querySelector("template[x-for]");

      expect(panel).not.toBeNull();
      expect(row).not.toBeNull();
      expect(panel.contains(row)).toBe(true);

      // Last row, below the scroller — it reads as the final option after the
      // buyer has looked down the list. `compareDocumentPosition` rather than
      // child indexes, which the wrapper divs would make brittle.
      const rowAfterResults =
        results.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(Boolean(rowAfterResults)).toBe(true);
      expect(results.contains(row)).toBe(false);
    });

    test("the below-the-field copy is restored, gated on the complement of showDropdown (bug 4.2 round 2)", () => {
      // The mutation this guards against: gating the restored link on the
      // SAME condition as the row (`showDropdown`) would put two identical
      // links on screen whenever the dropdown is open — the exact defect the
      // 2026-07-28 first-pass deletion was (rightly) avoiding. Asserting the
      // literal `x-show` attribute string, not just "it exists" or "it's
      // sometimes hidden", is what catches that mutation.
      const doc = renderDoc();
      const link = doc.querySelector(REMOVED_PERSISTENT_SELECTOR);

      expect(link).not.toBeNull();
      // The gate lives on the wrapping `<div>`, not the `<span>` itself —
      // same structure as the "Search for company" reverse link above it.
      const wrapper = link.closest("[x-show]");
      expect(wrapper.getAttribute("x-show")).toBe("belowFieldManualEntryVisible");
      expect(wrapper.getAttribute("x-show")).not.toBe("showDropdown");
    });
  });

  describe("timing — the row appears before the debounce, with no results", () => {
    test("at the threshold the dropdown opens with an empty result list", () => {
      type("x".repeat(INJECTED_MIN));

      // A PRECONDITION, not a claim: nothing has populated `items` in this
      // scenario, so this cannot fail and is not offered as evidence. It is
      // recorded because it is what makes the next line meaningful — the panel
      // is open while the result list is empty.
      expect(component.items).toEqual([]);
      expect(component.showDropdown()).toBe(true);
      // Nothing has been requested — this is the undebounced handler, and the
      // whole point is that the row does not wait for a response.
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("below the threshold it stays shut", () => {
      for (let n = 0; n < INJECTED_MIN; n += 1) {
        type("x".repeat(n));
        expect(component.showDropdown()).toBe(false);
      }

      // Under a leftover literal 3 the row at n = 3 and n = 4 would already be
      // open, and this is the assertion that names why that is wrong.
      type("xxx");
      expect(component.showDropdown()).toBe(false);
    });

    test("backspacing below the threshold closes it again", () => {
      type("x".repeat(INJECTED_MIN));
      expect(component.showDropdown()).toBe(true);

      // Not a one-way latch: the min-characters hint owns this range, and an
      // empty panel under a two-character query reads as a search that returned
      // nothing.
      type("x");
      expect(component.showDropdown()).toBe(false);
    });

    test("a search that matches nothing still shows the row", async () => {
      // The case the affordance exists for. Previously `items.length > 0` made
      // the panel — and therefore the only route into manual entry — vanish at
      // precisely this moment.
      field.value = "x".repeat(INJECTED_MIN);
      component.noteCompanyQuery();
      // Seeded NON-empty for the same reason as below: `items` is empty here
      // anyway, so a bare "is empty afterwards" assertion could not tell an
      // empty response being applied from the response being ignored entirely.
      component.items = [{ companyName: "Stale Result", companyId: "999" }];
      const pending = component.getItems();
      await H.flushPromises();
      fetchStub.last().respond({ items: [] });
      await pending;

      expect(component.items).toEqual([]);
      expect(component.showDropdown()).toBe(true);
    });

    test("a failed search still shows the row", async () => {
      field.value = "x".repeat(INJECTED_MIN);
      component.noteCompanyQuery();
      const pending = component.getItems();
      await H.flushPromises();
      fetchStub.last().networkError();
      await pending;

      expect(component.isSearchUnavailable).toBe(true);
      expect(component.showDropdown()).toBe(true);
      expect(component.isSearching).toBe(false);
    });

    test("the echo call does not consume isSelecting (TWO-25288 element 5 round 2)", async () => {
      // selectItem() arms `awaitingSelectionEcho` and `isSelecting` together and
      // then dispatches `input` on the field, so the undebounced handler runs
      // FIRST — this call IS that dispatch, simulated directly. It is swallowed
      // by the `awaitingSelectionEcho` guard and returns before touching
      // `isSelecting` at all, which is what this test pins: the echo call must
      // leave `isSelecting` exactly as selectItem() set it, so the debounced
      // getItems() tick behind it still hits ITS OWN one-shot guard and does not
      // fall through to search for the name the buyer just chose.
      //
      // This is NOT a general property of `noteCompanyQuery()` any more. A
      // SECOND call — a real keystroke, once the echo has been swallowed — DOES
      // clear `isSelecting` on purpose, precisely so a correction typed inside
      // the debounce window reaches the search instead of being silently
      // skipped. See "a real keystroke landing before the debounced tick" below
      // for that call.
      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });
      expect(component.isSelecting).toBe(true);
      expect(component.awaitingSelectionEcho).toBe(true);

      component.noteCompanyQuery();
      expect(component.awaitingSelectionEcho).toBe(false);
      expect(component.isSelecting).toBe(true);
      expect(component.showDropdown()).toBe(false);

      await component.getItems();
      expect(component.isSelecting).toBe(false);
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.showDropdown()).toBe(false);
    });

    test("selectItem() resets both flags immediately if there is no field to echo through", () => {
      // Both flags are armed unconditionally at the top of selectItem(), but
      // the echo they wait for is only ever dispatched inside the `if (input)`
      // branch below. If that querySelector ever misses — a root with no text
      // input, a Magewire re-render mid-flight — nothing would EVER run to
      // consume them the normal way, and the next real keystroke this
      // component saw would be swallowed as if it were the echo: the same
      // defect this round fixed, reached through a different door.
      const emptyRoot = document.createElement("div");
      const orphan = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: field,
        root: emptyRoot,
      });
      orphan.init();

      orphan.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });

      expect(orphan.isSelecting).toBe(false);
      expect(orphan.awaitingSelectionEcho).toBe(false);
    });

    test("no dropdown in manual mode or with the lookup switched off", () => {
      component.enterManually();
      type("x".repeat(INJECTED_MIN + 3));
      expect(component.showDropdown()).toBe(false);

      component.enableSearch();
      component.isCompanySearchEnabled = "";
      type("x".repeat(INJECTED_MIN + 3));
      expect(component.showDropdown()).toBe(false);
    });

    test("the markup binds the undebounced handler as its own listener", () => {
      // Two `@input` attributes with DIFFERENT names, so Alpine registers both.
      // Folding this into the debounced handler is the regression that would
      // put the row back behind a 500ms wait, and it would leave no trace in
      // component state at all — only the binding can see it.
      const bound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        "input[type=text]",
        "@input",
      );

      expect(bound).toBe("noteCompanyQuery");
      expect(typeof component[bound]).toBe("function");

      // The debounced request handler is still there and still debounced.
      const debounced = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        "input[type=text]",
        "@input.debounce.500ms",
      );
      expect(debounced).toBe("getItems");
    });
  });

  describe("keyboard reachability", () => {
    test.each(KEYBOARD_AFFORDANCES)(
      "$label is focusable and named as a button",
      (affordance) => {
        const element = renderDoc().querySelector(affordance.selector);

        expect(element).not.toBeNull();
        // `role="button"` and NOT `role="option"`: this panel is not a listbox
        // — no `role="listbox"` on the container, no `role="option"` on the
        // rows, no `aria-activedescendant` on the input — so a lone `option`
        // would be an option with no owning list, which is invalid ARIA.
        expect(element.getAttribute("role")).toBe("button");
        expect(element.getAttribute("role")).not.toBe("option");
        expect(element.getAttribute("tabindex")).toBe("0");

        // The accessible name is the visible text, so there is no `aria-label`
        // to drift out of step with it.
        expect(element.hasAttribute("aria-label")).toBe(false);
        expect(element.textContent.trim()).toBe(H.ESCAPED_STRING);
      },
    );

    test.each(KEYBOARD_AFFORDANCES)(
      "$label runs the same action on click, Enter and Space",
      (affordance) => {
        const element = renderDoc().querySelector(affordance.selector);
        const click = element.getAttribute("@click.stop");
        const enter = element.getAttribute("@keydown.enter.stop.prevent");
        const space = element.getAttribute("@keydown.space.stop.prevent");

        // All three present, and all three naming the SAME action — a keyboard
        // route that did something subtly different from the mouse route is the
        // failure mode worth pinning, not just an absent handler.
        expect(click).toBe(affordance.action);
        expect(enter).toBe(affordance.action);
        expect(space).toBe(affordance.action);
        expect(typeof component[affordance.action]).toBe("function");
      },
    );

    test("Space and Enter both carry .prevent", () => {
      // Load-bearing, not cosmetic: without it Space scrolls the page out from
      // under the buyer and Enter submits the address form. The modifier is only
      // visible in the attribute NAME, so nothing about component state can
      // catch its absence.
      const doc = renderDoc();

      KEYBOARD_AFFORDANCES.forEach((affordance) => {
        const element = doc.querySelector(affordance.selector);
        const names = Array.from(element.attributes).map((a) => a.name);
        const keydowns = names.filter((name) => name.startsWith("@keydown."));

        expect(keydowns).toHaveLength(2);
        keydowns.forEach((name) => {
          expect(name).toContain(".prevent");
          // `.stop` as well, so focusing and activating the row cannot read as
          // a click outside the address-book modal and close it.
          expect(name).toContain(".stop");
        });
      });
    });

    test("the keyboard route actually enters manual entry", () => {
      // The binding assertions above prove the wiring; this proves the wiring
      // leads somewhere. Invoked exactly as the handler would be, with the
      // event object Alpine passes.
      const event = {
        stopPropagation: jest.fn(),
        stopImmediatePropagation: jest.fn(),
      };
      type("x".repeat(INJECTED_MIN));
      expect(component.showDropdown()).toBe(true);
      // Seeded NON-empty on purpose. `items` is empty at this point in the
      // scenario, so asserting it is empty after the call would hold whether or
      // not the code cleared anything — an assertion structurally unable to
      // fail. Putting a row in first is what makes the clear observable.
      component.items = [{ companyName: "Acme Widgets", companyId: "111" }];

      component.enterManually(event);

      expect(component.manualMode).toBe(true);
      expect(component.showDropdown()).toBe(false);
      expect(component.items).toEqual([]);
      // Still stops propagation, so the address-book modal stays open.
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
    });

    test("the keyboard route back out of manual entry works too", () => {
      // Making the way IN keyboard-operable while leaving the way OUT
      // mouse-only would build a trap that did not exist before.
      component.enterManually();
      expect(component.manualModeActive).toBe(true);

      component.enableSearch();

      expect(component.manualMode).toBe(false);
      expect(component.searchModeActive).toBe(true);
    });
  });

  describe("manual entry is reachable in every non-selected search state, exactly once (bug 4.2 round 2)", () => {
    /**
     * Is the min-characters hint showing, as the shipped `x-show` binding
     * decides it? Read out of the markup rather than named here, so
     * renaming the getter without repointing the binding fails instead of
     * silently passing.
     *
     * @returns {boolean}
     */
    function hintVisible() {
      const hint = renderDoc().querySelector(MIN_CHARS_SELECTOR);
      expect(hint).not.toBeNull();
      const bound = hint.getAttribute("x-show");
      expect(typeof component[bound]).toBe("function");
      return component[bound]();
    }

    /**
     * Would the in-dropdown manual-entry row be on screen right now? Reads
     * the row's own gate out of the shipped markup — `showDropdown` —
     * rather than assuming it.
     *
     * @returns {boolean}
     */
    function rowVisible() {
      const row = renderDoc().querySelector(ROW_SELECTOR);
      expect(row).not.toBeNull();
      const gate = row.closest("[x-show]");
      expect(gate).not.toBeNull();
      const bound = gate.getAttribute("x-show");
      expect(typeof component[bound]).toBe("function");
      return component[bound]();
    }

    /**
     * Would the restored below-the-field manual-entry link be on screen
     * right now? Same pattern as `rowVisible()`, reading
     * `REMOVED_PERSISTENT_SELECTOR`'s own gate out of the shipped markup.
     *
     * @returns {boolean}
     */
    function belowFieldVisible() {
      const link = renderDoc().querySelector(REMOVED_PERSISTENT_SELECTOR);
      expect(link).not.toBeNull();
      const gate = link.closest("[x-show]");
      expect(gate).not.toBeNull();
      const bound = gate.getAttribute("x-show");
      expect(typeof component[bound]).toBe("boolean");
      return component[bound];
    }

    /**
     * Is EITHER manual-entry affordance visible right now? Asserts the two
     * are mutually exclusive on every call — this is what a mutated re-gate
     * (e.g. binding the restored link onto the SAME condition as the row)
     * would break, rather than merely "at least one is offered".
     *
     * @returns {boolean}
     */
    function manualEntryVisible() {
      const row = rowVisible();
      const belowField = belowFieldVisible();

      expect(row && belowField).toBe(false);

      return row || belowField;
    }

    /*
     * Bug 4.2 named two states the affordance must NOT read as "not on the
     * list": manual mode (the wording would be nonsensical) and a completed
     * selection (the claim is simply false). Round 2 added a third
     * constraint of its own: the affordance must be reachable in EVERY
     * OTHER state, including an untouched field and a sub-threshold query —
     * the exact states the first-pass fix (2026-07-28) left with nothing at
     * all.
     */
    test("an untouched field: the below-field link is the reachable affordance", () => {
      expect(rowVisible()).toBe(false);
      expect(belowFieldVisible()).toBe(true);
      expect(manualEntryVisible()).toBe(true);
    });

    test("a sub-threshold query: the below-field link stays the reachable affordance", () => {
      type("xx");

      expect(rowVisible()).toBe(false);
      expect(belowFieldVisible()).toBe(true);
      expect(manualEntryVisible()).toBe(true);
    });

    test("an open panel: the row takes over from the below-field link", () => {
      type("x".repeat(INJECTED_MIN));

      expect(rowVisible()).toBe(true);
      expect(belowFieldVisible()).toBe(false);
      expect(manualEntryVisible()).toBe(true);
    });

    test("the row and the below-field link are exact complements, across the whole length range", () => {
      // The invariant restated without a helper to hide behind: whatever the
      // typed length, exactly one of the two conditions holds, never both
      // and never neither (while a company remains unselected). A gate stuck
      // on either value, or a mutation that drops the `!showDropdown()` term
      // from one side, fails half this sweep.
      for (let n = 0; n <= INJECTED_MIN + 3; n += 1) {
        type("x".repeat(n));

        expect(rowVisible()).toBe(component.showDropdown());
        expect(belowFieldVisible()).toBe(!component.showDropdown());
        expect(manualEntryVisible()).toBe(true);
      }
    });

    describe("states the length sweep cannot reach", () => {
      const CHOSEN = { companyName: "Acme Widgets Ltd", companyId: "111" };

      /**
       * Pick a company the way the dropdown does, then run the debounced handler
       * once to consume `isSelecting` — so what is asserted afterwards is the
       * settled post-selection state rather than the one-shot guard.
       *
       * @returns {Promise<void>}
       */
      async function pickFromDropdown() {
        component.items = [CHOSEN];
        component.selectItem(CHOSEN);
        await component.getItems();
        expect(component.isSelecting).toBe(false);
        expect(component.isCompanySelected).toBe(true);
        expect(component.search.length).toBeGreaterThanOrEqual(INJECTED_MIN);
        expect(component.showDropdown()).toBe(false);
      }

      test("a completed selection: BOTH affordances are shut", async () => {
        // The exact bug 4.2 case: "after a company is already selected" —
        // the one state where the below-field link's `!isCompanySelected`
        // term earns its keep, since `!showDropdown()` alone would show it.
        await pickFromDropdown();

        expect(rowVisible()).toBe(false);
        expect(belowFieldVisible()).toBe(false);
      });

      test("editing the chosen name re-opens the below-field link on the keystroke, not the row", async () => {
        await pickFromDropdown();

        // Edited SHORT — below the search threshold, so the row stays shut,
        // but the correction already cleared `isCompanySelected`, so the
        // below-field link is the one reachable now.
        field.value = "Jo";
        component.noteCompanyQuery();

        expect(component.isCompanySelected).toBe(false);
        expect(component.showDropdown()).toBe(false);
        expect(rowVisible()).toBe(false);
        expect(belowFieldVisible()).toBe(true);
        expect(hintVisible()).toBe(true);
      });

      describe("a real keystroke landing before the debounced tick", () => {
        function selectThenEcho() {
          component.items = [CHOSEN];
          component.selectItem(CHOSEN);
          component.noteCompanyQuery();
          expect(component.isSelecting).toBe(true);
          expect(component.isCompanySelected).toBe(true);
        }

        test("a short correction shows the min-chars hint AND the below-field link", () => {
          selectThenEcho();

          field.value = "Jo";
          component.noteCompanyQuery();

          expect(component.isCompanySelected).toBe(false);
          expect(component.isSelecting).toBe(false);
          expect(component.showDropdown()).toBe(false);
          expect(hintVisible()).toBe(true);
          expect(rowVisible()).toBe(false);
          expect(belowFieldVisible()).toBe(true);
        });

        test("a full-length correction opens the row and searches on the tick behind it", async () => {
          selectThenEcho();

          field.value = "y".repeat(INJECTED_MIN + 1);
          component.noteCompanyQuery();

          expect(component.isCompanySelected).toBe(false);
          expect(component.isSelecting).toBe(false);
          expect(component.showDropdown()).toBe(true);
          expect(rowVisible()).toBe(true);
          expect(belowFieldVisible()).toBe(false);

          const pending = component.getItems();
          await H.flushPromises();
          expect(fetchStub.calls.length).toBeGreaterThan(0);
          fetchStub.last().respond({ items: [] });
          await pending;
        });
      });

      test("retyping past the threshold re-opens the row", async () => {
        await pickFromDropdown();

        field.value = "y".repeat(INJECTED_MIN + 1);
        component.noteCompanyQuery();

        expect(component.showDropdown()).toBe(true);
        expect(rowVisible()).toBe(true);
        expect(belowFieldVisible()).toBe(false);
      });

      test("a click outside shuts the panel and hands manual entry to the below-field link", async () => {
        // This is the exact state bug 4.2's first-pass fix (2026-07-28) left
        // with NOTHING: closeDropdown() is bound as `@click.outside` and
        // lowers `isOpen` without touching `search`, so a full-length query
        // whose panel got dismissed by a click elsewhere used to be a dead
        // end. Round 2's below-field link takes over here instead, exactly
        // as the pre-4.2 persistent link once did.
        type("x".repeat(INJECTED_MIN));
        expect(component.showDropdown()).toBe(true);
        expect(rowVisible()).toBe(true);
        expect(belowFieldVisible()).toBe(false);

        component.closeDropdown();

        expect(component.search.length).toBeGreaterThanOrEqual(INJECTED_MIN);
        expect(component.showDropdown()).toBe(false);
        expect(rowVisible()).toBe(false);
        expect(belowFieldVisible()).toBe(true);
      });
    });

    test("manual mode: BOTH affordances are shut, the reverse link takes over", () => {
      component.enterManually();

      expect(component.showDropdown()).toBe(false);
      expect(rowVisible()).toBe(false);
      expect(belowFieldVisible()).toBe(false);
      expect(component.manualModeActive).toBe(true);
    });

    test("with the lookup switched off, neither affordance renders", () => {
      component.isCompanySearchEnabled = "";
      type("x".repeat(INJECTED_MIN));

      expect(component.showDropdown()).toBe(false);
      expect(rowVisible()).toBe(false);
      expect(belowFieldVisible()).toBe(false);
    });
  });
});
