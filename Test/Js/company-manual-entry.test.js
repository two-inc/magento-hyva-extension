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
 *    not have. TWO-25326 §1 took this further: the panel now opens on click or
 *    keypress and stays open regardless of query length or results, so the row
 *    is there from the moment the panel is, before anything is typed at all.
 *  - KEYBOARD. It was a bare `<span>` with a click handler: no role, no
 *    tabindex, no keydown. TWO-25326 §2 finished the job the first fix started
 *    — the affordances are real `<button type="button">` elements now, so
 *    Enter and Space activate them natively and the hand-rolled keydown
 *    handlers are gone.
 *  - DUPLICATION. A below-the-field second route was tried twice (removed
 *    2026-07-28, restored 2026-08-01) and finally deleted for good on
 *    2026-08-05: once the panel opens from zero typed characters, the
 *    in-dropdown row alone is reachable throughout, so a persistent second
 *    copy has nothing left to cover. There is exactly ONE route into manual
 *    entry on this surface now.
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
 * It resolves against dictionaries the base Two Magento module ships. This
 * repo does carry its own i18n directory now (bug 5's "Checking your
 * company…" spinner text), but neither this msgid nor the reverse link's is
 * a row in it, so a reworded key here still falls silently back to English in
 * every other locale — pinned in the "wording" describe below.
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
 * affordance) was removed 2026-07-28 (bug 4.2), RESTORED 2026-08-01 with a
 * narrower gate — `belowFieldManualEntryVisible`, the exact complement of
 * `showDropdown()` — and removed again for good on 2026-08-05: with the panel
 * reachable from zero typed characters, the row alone covers every state the
 * restored link existed for. `REMOVED_PERSISTENT_SELECTOR` is kept as a
 * negative-assertion target — the class this suite must never find again.
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
  let queryInput;
  let root;

  beforeEach(() => {
    // Two inputs, in shipped document order: the company-NAME field, then the
    // panel's own query field (TWO-25326 §1). Searching and the min-characters
    // hint both key off the second one now, so a fixture with only the first
    // would measure a value the component never reads.
    // `two-company-search` is load-bearing on the wrapper, not decoration:
    // `controlRoot()` resolves the component's own root by that class (see
    // gateway_method-csp-js.phtml), and focusablesAfterComponent() — the §4
    // Tab handler's candidate list — reads document order from it. A fixture
    // without it makes controlRoot() resolve to null and every Tab-handling
    // assertion below pass for the wrong reason (an empty candidate list).
    document.body.innerHTML = [
      '<div id="root" class="two-company-search">',
      '  <input type="text" id="field" value="" />',
      '  <input type="text" class="two-company-query" id="query" value="" />',
      "</div>",
    ].join("\n");
    field = document.getElementById("field");
    queryInput = document.getElementById("query");
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
   * Open the panel the way a click on the company-name field does.
   *
   * @returns {void}
   */
  function openPanel() {
    component.onCompanyNameClick();
  }

  /**
   * Type into the PANEL'S QUERY FIELD the way the undebounced binding does.
   *
   * `noteCompanyQuery` is bound to `.two-company-query` since TWO-25326 §1 and
   * reads `$el.value`, so `$el` is swapped for the duration exactly as Alpine
   * resolves it per expression. Typing into the company-name field instead
   * would drive `onNameFieldInput`, which is a different handler with
   * different rules.
   *
   * @param {string} value
   * @returns {void}
   */
  function type(value) {
    queryInput.value = value;
    const previousEl = component.$el;
    component.$el = queryInput;
    try {
      component.noteCompanyQuery();
    } finally {
      component.$el = previousEl;
    }
  }

  describe("wording", () => {
    /**
     * The msgid lives in the shared control markup now, not in
     * companyName.phtml itself (TWO-25326, 2026-08-05 ruling — the control is
     * ONE implementation, included via `include $block->getTemplateFile(…)`
     * from every mount point). `templateSource(H.COMPANY_NAME_MARKUP_TEMPLATE)`
     * only ever sees companyName.phtml's own bytes — `include` is a runtime
     * PHP statement, not something a raw-source read follows — so the
     * source-level wording checks have to read the control file directly.
     */
    const CONTROL_TEMPLATE =
      "view/frontend/templates/form/field/company-search-control.phtml";

    test("the affordance uses the exact English source string, once", () => {
      // Asserted at SOURCE level, not on rendered text: the harness resolves
      // every `__()` to one placeholder, so a rendered-text assertion would
      // pass over any wording whatsoever, the old one included.
      const source = templateSource(CONTROL_TEMPLATE);
      const occurrences = source.split("__('" + MANUAL_ENTRY_MSGID + "')");

      // Exactly once — the in-dropdown row is the ONLY route now (2026-08-05
      // ruling, superseding the below-the-field link bug 4.2 round 2 had
      // restored). Zero would mean the affordance is missing; two would mean
      // a duplicate route back.
      expect(occurrences).toHaveLength(2);
    });

    test("the replaced wording is gone from this surface", () => {
      // The row previously read "Enter details manually". Leaving it on the
      // old string as an ACTUAL msgid is the failure this catches — the old
      // string does still appear once, in this file's own doc comment
      // narrating the history, which is not a `__()` call and must not be
      // confused for one.
      expect(templateSource(CONTROL_TEMPLATE)).not.toContain(
        "__('" + REPLACED_MSGID + "')",
      );
    });

    test("the reverse link keeps its existing wording", () => {
      // Already translated in the base module's catalogues on every locale, so
      // rewording it would strand it in English for no reason.
      expect(templateSource(CONTROL_TEMPLATE)).toContain(
        "__('" + SEARCH_AGAIN_MSGID + "')",
      );
    });

    test("this repo's own i18n directory carries no dictionary entry for these msgids", () => {
      // The msgid resolves against the base module's catalogues, which Magento
      // merges per locale. This repo DOES now ship an i18n directory of its
      // own (TWO-25326 tile bugfix batch, bug 5 — the local "Checking your
      // company…" spinner text), so the premise this test pins is narrower
      // than "no i18n directory at all": neither manual-entry msgid may be
      // shadowed by a row in this repo's own catalogues, which would silently
      // stop them resolving against the base module's translations instead.
      const i18nDir = path.join(H.REPO_ROOT, "i18n");
      if (!fs.existsSync(i18nDir)) return;
      fs.readdirSync(i18nDir)
        .filter((name) => name.endsWith(".csv"))
        .forEach((name) => {
          const csv = fs.readFileSync(path.join(i18nDir, name), "utf8");
          expect(csv).not.toContain(MANUAL_ENTRY_MSGID);
          expect(csv).not.toContain(SEARCH_AGAIN_MSGID);
        });
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

    test("the below-the-field copy stays gone (2026-08-05 ruling, superseding bug 4.2 round 2)", () => {
      // Round 2 (2026-07-28 first pass, then restored 2026-08-01) tried a
      // below-the-field `.two-company-manual-entry` link as the affordance's
      // route when the panel is shut. The 2026-08-05 ruling removes it for
      // good instead: the panel opens on click/keypress from zero typed
      // characters (pinned in the "timing" describe below), so the in-panel
      // row is reachable immediately and there is nothing left for a second,
      // persistent copy to cover.
      const doc = renderDoc();

      expect(doc.querySelector(REMOVED_PERSISTENT_SELECTOR)).toBeNull();
    });
  });

  describe("timing — the row appears with the panel, before any search", () => {
    test("opening the panel shows the row with an empty result list and nothing typed", () => {
      // REPLACES "at the threshold the dropdown opens with an empty result
      // list". TWO-25326 §1 detached the panel from the query length
      // altogether: it opens on click, so the row is reachable from the first
      // interaction rather than after N characters.
      openPanel();

      // A PRECONDITION, not a claim: nothing has populated `items` in this
      // scenario, so this cannot fail and is not offered as evidence. It is
      // recorded because it is what makes the next line meaningful — the panel
      // is open while the result list is empty.
      expect(component.items).toEqual([]);
      expect(component.query).toBe("");
      expect(component.showDropdown()).toBe(true);
      // Nothing has been requested — the row does not wait for a response, and
      // an empty query is below any threshold.
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("below the threshold the panel stays OPEN and explains itself", () => {
      // REPLACES "below the threshold it stays shut", whose premise was the
      // bug: the buyer opened the panel and got nothing until the query was
      // long enough. The panel now stays open across the whole sub-threshold
      // range, showing the min-characters hint, and the manual-entry row stays
      // reachable throughout.
      openPanel();

      for (let n = 0; n < INJECTED_MIN; n += 1) {
        type("x".repeat(n));
        expect(component.showDropdown()).toBe(true);
        expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(true);
        expect(component.items).toEqual([]);
      }

      // Under a leftover literal 3 the hint at n = 3 and n = 4 would already
      // be gone, and this is the assertion that names why that is wrong.
      type("xxx");
      expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(true);
      expect(fetchStub.calls).toHaveLength(0);
    });

    test("backspacing below the threshold clears the list and brings the hint back", () => {
      // REPLACES "backspacing below the threshold closes it again". The panel
      // is no longer a one-way function of query length, but the RESULTS still
      // are: a stale list under a query that was never run reads as matches
      // for text the buyer has already deleted.
      openPanel();
      type("x".repeat(INJECTED_MIN));
      component.items = [{ companyName: "Acme Widgets", companyId: "111" }];
      component.searchCompletedFor = "x".repeat(INJECTED_MIN);
      expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(false);

      type("x");

      expect(component.items).toEqual([]);
      expect(component.searchCompletedFor).toBeNull();
      expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(true);
      expect(component.showDropdown()).toBe(true);
    });

    test("a search that matches nothing still shows the row, and says so", async () => {
      // The case the affordance exists for. Previously `items.length > 0` made
      // the panel — and therefore the only route into manual entry — vanish at
      // precisely this moment.
      openPanel();
      type("x".repeat(INJECTED_MIN));
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
      // The zero-result wording is gated on a COMPLETED search for the text
      // now in the box (TWO-25326 §1), so it may claim this and not before.
      expect(component.noMatchesVisible).toBe(true);
    });

    test("a failed search still shows the row", async () => {
      openPanel();
      type("x".repeat(INJECTED_MIN));
      const pending = component.getItems();
      await H.flushPromises();
      fetchStub.last().networkError();
      await pending;

      expect(component.isSearchUnavailable).toBe(true);
      expect(component.showDropdown()).toBe(true);
      expect(component.isSearching).toBe(false);
      // A failure is not a verdict on whether matches exist — the two
      // messages must never both be on screen.
      expect(component.noMatchesVisible).toBe(false);
    });

    test("a pick closes the panel and discards the query, with no echo flags involved", async () => {
      // REPLACES "the echo call does not consume isSelecting". The old
      // mechanism was a pair of one-shot flags (`awaitingSelectionEcho`,
      // `isSelecting`) that existed only because the company-name field drove
      // the search, so writing the chosen name back into it fired another
      // search. TWO-25326 §1 removed that path: the query lives in the panel,
      // and the panel is closed and emptied by the pick itself.
      openPanel();
      type("x".repeat(INJECTED_MIN));
      expect(component.showDropdown()).toBe(true);

      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });
      await H.flushPromises();

      expect("isSelecting" in component).toBe(false);
      expect("awaitingSelectionEcho" in component).toBe(false);
      expect(component.showDropdown()).toBe(false);
      expect(component.query).toBe("");
      expect(component.isCompanySelected).toBe(true);

      // The synthetic `input` selectItem() dispatches lands on the NAME field,
      // whose handler is onNameFieldInput — and in search mode that handler
      // does nothing but keep `search` in step. No search follows.
      component.onNameFieldInput();
      expect(component.search).toBe("Acme Widgets");
      expect(fetchStub.calls).toHaveLength(0);
    });

    test("a pick completes even when there is no company-name field to write into", () => {
      // REPLACES "selectItem() resets both flags immediately if there is no
      // field to echo through". There are no flags left to strand, but the
      // hazard the old test named is real and unchanged: `companyNameField()`
      // can miss — a root with no text input, a Magewire re-render mid-flight
      // — and the capture must still complete in component state and storage
      // rather than half-applying.
      const emptyRoot = document.createElement("div");
      const orphan = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: emptyRoot,
        root: emptyRoot,
      });
      orphan.init();
      orphan.isOpen = true;
      orphan.query = "acme";

      orphan.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });

      expect(orphan.companyNameField()).toBeNull();
      expect(orphan.search).toBe("Acme Widgets");
      expect(orphan.companyId).toBe("111");
      expect(orphan.companyIdSource).toBe("registry");
      expect(orphan.isCompanySelected).toBe(true);
      expect(orphan.isOpen).toBe(false);
      expect(orphan.query).toBe("");
    });

    test("no dropdown in manual mode or with the lookup switched off", () => {
      component.enterManually();
      openPanel();
      type("x".repeat(INJECTED_MIN + 3));
      expect(component.showDropdown()).toBe(false);

      component.enableSearch();
      component.isCompanySearchEnabled = "";
      component.isOpen = false;
      openPanel();
      type("x".repeat(INJECTED_MIN + 3));
      expect(component.showDropdown()).toBe(false);
    });

    test("the QUERY field binds the undebounced handler as its own listener", () => {
      // REPLACES the same pair of assertions read off `input[type=text]` (the
      // company-name field) with a 500ms debounce. Both bindings moved to
      // `.two-company-query` and the debounce is 300ms (TWO-25326 §1).
      //
      // Two `@input` attributes with DIFFERENT names, so Alpine registers both.
      // Folding this into the debounced handler is the regression that would
      // put the hint and the row back behind a wait, and it would leave no
      // trace in component state at all — only the binding can see it.
      const bound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        "input.two-company-query",
        "@input",
      );

      expect(bound).toBe("noteCompanyQuery");
      expect(typeof component[bound]).toBe("function");

      // The debounced request handler is still there and still debounced.
      const debounced = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        "input.two-company-query",
        "@input.debounce.300ms",
      );
      expect(debounced).toBe("getItems");
    });
  });

  describe("keyboard reachability", () => {
    test.each(KEYBOARD_AFFORDANCES)(
      "$label is a real button, so the keyboard reaches it natively",
      (affordance) => {
        // REPLACES the `role="button"` + `tabindex="0"` assertions. TWO-25326
        // §2 made both affordances real `<button type="button">` elements: a
        // button is focusable and Enter/Space-activatable with no attributes
        // at all, which is strictly better than emulating it, and it removes
        // the hand-rolled keydown handlers that could disagree with the click
        // path. `type="button"` is the load-bearing part inside an address
        // form — the default `submit` would place the buyer's order.
        const element = renderDoc().querySelector(affordance.selector);

        expect(element).not.toBeNull();
        expect(element.tagName).toBe("BUTTON");
        expect(element.getAttribute("type")).toBe("button");
        // No emulation left behind to drift out of step with the real thing.
        expect(element.hasAttribute("role")).toBe(false);
        expect(element.hasAttribute("tabindex")).toBe(false);

        // The accessible name is the visible text, so there is no `aria-label`
        // to drift out of step with it.
        expect(element.hasAttribute("aria-label")).toBe(false);
        expect(element.textContent.trim()).toBe(H.ESCAPED_STRING);
      },
    );

    test.each(KEYBOARD_AFFORDANCES)(
      "$label runs its action from a single click binding, with no rival keydown handlers",
      (affordance) => {
        // REPLACES "runs the same action on click, Enter and Space". With a
        // real button there is exactly ONE activation path — the click event,
        // which Enter and Space synthesise — so the failure mode the old test
        // guarded (a keyboard route doing something subtly different from the
        // mouse route) is now structurally impossible, and what has to be
        // pinned instead is that no second handler was left behind.
        const element = renderDoc().querySelector(affordance.selector);
        const click = element.getAttribute("@click.stop");
        const names = Array.from(element.attributes).map((a) => a.name);

        expect(click).toBe(affordance.action);
        expect(typeof component[affordance.action]).toBe("function");
        expect(element.getAttribute("@keydown.enter.stop.prevent")).toBeNull();
        expect(element.getAttribute("@keydown.space.stop.prevent")).toBeNull();
        expect(names.filter((n) => n.startsWith("@keydown.enter"))).toEqual([]);
        expect(names.filter((n) => n.startsWith("@keydown.space"))).toEqual([]);
        // `@mousedown.stop` stays: without it, pressing the button reads as a
        // click outside the address-book modal and closes it before the click
        // lands.
        expect(names).toContain("@mousedown.stop");
      },
    );

    test("Tab off the in-dropdown row is handled, so it closes the panel instead of dropping focus on <body>", () => {
      // REPLACES "Space and Enter both carry .prevent". Those modifiers are
      // gone with the hand-rolled handlers; the one keydown that remains on
      // the row is the §4 Tab requirement, and it cannot be left to the
      // browser — closing the panel removes the focused button from the
      // document, and a native Tab computed against a document that no longer
      // contains the focused element lands on `<body>`.
      const row = renderDoc().querySelector(ROW_SELECTOR);
      const names = Array.from(row.attributes).map((a) => a.name);

      expect(names.filter((name) => name.startsWith("@keydown."))).toEqual([
        "@keydown.tab",
      ]);
      expect(row.getAttribute("@keydown.tab")).toBe("onManualEntryTab");
      expect(typeof component.onManualEntryTab).toBe("function");
    });

    test("forward Tab off the row closes the panel and lands focus on the next real control", () => {
      // The behaviour behind the binding above, driven for effect rather than
      // asserted as an attribute string. The "next control" is resolved
      // against the document, so one is added after the component root.
      const next = document.createElement("input");
      next.type = "text";
      next.id = "next-control";
      document.body.appendChild(next);
      // jsdom has no layout, so `offsetParent` is null for everything; the
      // resolver skips those. Give this one a stub so it is a real candidate.
      Object.defineProperty(next, "offsetParent", {
        get: () => document.body,
      });

      openPanel();
      expect(component.showDropdown()).toBe(true);
      const event = { shiftKey: false, preventDefault: jest.fn() };

      component.onManualEntryTab(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.isOpen).toBe(false);
      expect(document.activeElement).toBe(next);
    });

    test("Shift+Tab off the row is left to the browser, so the panel stays open", () => {
      // Backwards Tab goes into the query field, which is the natural previous
      // stop and is still inside the panel — closing it there would yank the
      // element the browser is about to focus.
      openPanel();
      const event = { shiftKey: true, preventDefault: jest.fn() };

      component.onManualEntryTab(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(component.isOpen).toBe(true);
    });

    test("the keyboard route actually enters manual entry", () => {
      // The binding assertions above prove the wiring; this proves the wiring
      // leads somewhere. Invoked exactly as the handler would be, with the
      // event object Alpine passes.
      const event = {
        stopPropagation: jest.fn(),
        stopImmediatePropagation: jest.fn(),
      };
      openPanel();
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

  /*
   * The old "two affordances, exactly one reachable" model this described
   * (bug 4.2 round 2 restoring a below-the-field `.two-company-manual-entry`
   * link) is superseded by the 2026-08-05 ruling: there is exactly ONE
   * manual-entry affordance now (the in-dropdown row above), permanently,
   * because the panel opens on click/keypress from zero typed characters —
   * see company-search-control.phtml's own comment on bug 2. Reachability at
   * zero characters is pinned above ("opening the panel shows the row...");
   * that the removed link stays removed is pinned in
   * company-search-dropdown.test.js ("the deleted route must really be
   * gone").
   */
});
