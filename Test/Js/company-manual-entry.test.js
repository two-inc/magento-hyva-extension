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

/** The in-dropdown row, the link below the field, and the way back. */
const ROW_SELECTOR = ".two-company-manual-entry-row";
const PERSISTENT_SELECTOR = ".two-company-manual-entry";
const SEARCH_AGAIN_SELECTOR = ".two-company-search-again";

/** Every affordance that must answer the keyboard, with the action it runs. */
const KEYBOARD_AFFORDANCES = [
  { label: "in-dropdown row", selector: ROW_SELECTOR, action: "enterManually" },
  {
    label: "link below the field",
    selector: PERSISTENT_SELECTOR,
    action: "enterManually",
  },
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

      // Exactly twice — the in-dropdown row and the link below the field. One
      // would mean a route left on the old copy.
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

    test("the link below the field is outside the dropdown", () => {
      const doc = renderDoc();
      const link = doc.querySelector(PERSISTENT_SELECTOR);

      expect(link).not.toBeNull();
      expect(link.closest("[x-show='showDropdown']")).toBeNull();
      // And it is a different element from the row, not the same node matched
      // twice by a class that happens to be a prefix of the other.
      expect(link).not.toBe(doc.querySelector(ROW_SELECTOR));
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

    test("the undebounced handler does not consume the selection flag", async () => {
      // selectItem() sets `isSelecting` and then dispatches `input` on the
      // field, so the undebounced handler runs FIRST. Clearing the flag there
      // would let the debounced getItems() behind it fall through its own guard
      // and search for the name the buyer just chose — reopening a dropdown they
      // have just dismissed.
      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });
      expect(component.isSelecting).toBe(true);

      component.noteCompanyQuery();
      expect(component.isSelecting).toBe(true);
      expect(component.showDropdown()).toBe(false);

      await component.getItems();
      expect(component.isSelecting).toBe(false);
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.showDropdown()).toBe(false);
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

  describe("exactly one manual-entry affordance is visible", () => {
    /**
     * Is the link below the field showing, as the shipped binding decides it?
     *
     * Read out of the markup rather than named here, so renaming the getter
     * without repointing the binding fails instead of silently passing.
     *
     * @returns {boolean}
     */
    function persistentVisible() {
      // The `x-show` sits on the wrapper, not on the link itself, so this walks
      // up the way the shipped markup nests it rather than assuming a selector
      // that would silently match the wrong node.
      const link = renderDoc().querySelector(PERSISTENT_SELECTOR);
      expect(link).not.toBeNull();
      const gate = link.closest("[x-show]");
      if (gate === null) {
        throw new Error(
          "the manual-entry link below the field has no `x-show` ancestor. " +
            "Unconditional, it would sit beside the dropdown's own copy of the " +
            "same wording — which is the whole thing these tests pin.",
        );
      }
      const bound = gate.getAttribute("x-show");
      expect(bound in component).toBe(true);
      return component[bound];
    }

    test("the empty field offers the link below it and no panel", () => {
      // The state the in-dropdown row cannot cover: nothing typed, so the panel
      // is shut. Something must still offer manual entry here — this is the
      // sole-trader route, and a buyer who knows they are in no registry should
      // not have to type three characters of a company name first.
      expect(component.showDropdown()).toBe(false);
      expect(persistentVisible()).toBe(true);
    });

    test("a sub-threshold query offers the link below it and no panel", () => {
      type("xx");

      expect(component.showDropdown()).toBe(false);
      expect(persistentVisible()).toBe(true);
    });

    test("an open panel takes the link below it away", () => {
      type("x".repeat(INJECTED_MIN));

      expect(component.showDropdown()).toBe(true);
      // Identical wording on both, so both on screen at once reads as a bug.
      expect(persistentVisible()).toBe(false);
    });

    test("never both, and never neither, across the whole length range", () => {
      // The invariant stated as one assertion rather than as a set of examples:
      // whatever the typed length, exactly one route into manual entry is
      // offered. A gate stuck true fails the upper half, a gate stuck false
      // fails the lower half.
      for (let n = 0; n <= INJECTED_MIN + 3; n += 1) {
        type("x".repeat(n));

        const routes = [component.showDropdown(), persistentVisible()].filter(
          Boolean,
        );
        expect(routes).toHaveLength(1);
      }
    });

    /*
     * The length sweep above cannot reach any of the following, and that is a
     * property of the sweep rather than of the states: it drives a component
     * that has never selected a company and never closed a dropdown, so every
     * point it visits is one where exactly one route is right. A sweep unable
     * to reach the failing state is not evidence about it. These walk in.
     */
    describe("states the length sweep cannot reach", () => {
      const CHOSEN = { companyName: "Acme Widgets Ltd", companyId: "111" };

      /**
       * Pick a company the way the dropdown does, then let the `input` event
       * selectItem() dispatches consume the selection flag — so what is
       * asserted afterwards is the settled post-selection state and not the
       * one-shot guard inside getItems().
       *
       * @returns {Promise<void>}
       */
      async function pickFromDropdown() {
        component.items = [CHOSEN];
        component.selectItem(CHOSEN);
        await component.getItems();
        expect(component.isSelecting).toBe(false);
        // The precondition that makes these tests about the right thing: the
        // panel is shut and the query is at FULL length, which is the only
        // combination in which the length sweep would have expected the link.
        expect(component.isCompanySelected).toBe(true);
        expect(component.search.length).toBeGreaterThanOrEqual(INJECTED_MIN);
        expect(component.showDropdown()).toBe(false);
      }

      test("a completed selection offers neither route", async () => {
        // The bug this term exists for. The panel is shut and the query is long,
        // so the link showed — telling a buyer their company is not on the list
        // immediately after they picked it off that list. The copy is a claim
        // about the current state, so being visible here is being wrong, not
        // merely redundant.
        await pickFromDropdown();

        expect(persistentVisible()).toBe(false);
      });

      test("editing the chosen name brings the link back on the keystroke", async () => {
        // So the state above is a resting place, not a dead end. Without this,
        // hard-coding the gate to false would satisfy the test above — and the
        // buyer who picked the wrong company would have no way back to manual
        // entry at all.
        //
        // Driven by the UNDEBOUNCED handler alone, with no getItems() await, and
        // that is the point of the test rather than a shortcut. Both handlers
        // clear the flag, so a version that awaited the debounced one passed with
        // either clear present and pinned neither — mutating away the undebounced
        // one left the whole suite green. The affordance has to return on the
        // keystroke: half a second of a buyer being told nothing offers manual
        // entry is the same defect as never being told, only briefer.
        await pickFromDropdown();

        // Edited SHORT, so the panel stays down and the link is the only route
        // that could answer.
        field.value = "Jo";
        component.noteCompanyQuery();

        expect(component.isCompanySelected).toBe(false);
        expect(component.showDropdown()).toBe(false);
        expect(persistentVisible()).toBe(true);

        // And the debounced handler behind it does not take it away again.
        await component.getItems();
        expect(persistentVisible()).toBe(true);
      });

      test("retyping past the threshold offers the row, still not the link", async () => {
        // The other half of the recovery: exactly one route again, and it is the
        // in-dropdown one. A gate stuck true would put both on screen here.
        await pickFromDropdown();

        field.value = "y".repeat(INJECTED_MIN + 1);
        component.noteCompanyQuery();

        expect(component.showDropdown()).toBe(true);
        expect(persistentVisible()).toBe(false);
      });

      test("a click outside hands a full-length query back to the link", async () => {
        // Documented because it is easy to describe wrongly, and the comments
        // beside both affordances did: the row does NOT own "everything from the
        // threshold upwards". closeDropdown() is bound as `@click.outside` and
        // lowers `isOpen` without touching `search`, so at full query length the
        // row goes and the link takes over. Exactly one route either way, which
        // is why the behaviour is left alone — but what the link actually owns is
        // "the panel is shut", not "the query is too short to search".
        type("x".repeat(INJECTED_MIN));
        expect(component.showDropdown()).toBe(true);
        expect(persistentVisible()).toBe(false);

        component.closeDropdown();

        expect(component.search.length).toBeGreaterThanOrEqual(INJECTED_MIN);
        expect(component.showDropdown()).toBe(false);
        expect(persistentVisible()).toBe(true);
      });
    });

    test("manual mode offers neither, and the way back instead", () => {
      // Once manual entry is in effect there is nothing left to enter manually
      // INTO, so both routes go and the reverse link takes over.
      component.enterManually();

      expect(component.showDropdown()).toBe(false);
      expect(persistentVisible()).toBe(false);
      expect(component.manualModeActive).toBe(true);
    });

    test("with the lookup switched off, neither route renders", () => {
      component.isCompanySearchEnabled = "";
      type("x".repeat(INJECTED_MIN));

      expect(component.showDropdown()).toBe(false);
      expect(persistentVisible()).toBe(false);
    });
  });
});
