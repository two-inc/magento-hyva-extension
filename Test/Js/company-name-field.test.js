/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The address-form company picker from companyName-csp-js.phtml.
 *
 * This one has no magewire loader — it drives an in-field spinner
 * (`isSearching`) and an "unavailable" notice (`isSearchUnavailable`) instead.
 * The invariant is the same shape as the overlay's: EVERY exit from
 * `getItems()` has to leave the spinner down and nothing on the wire, because a
 * latched `isSearching` is a field that spins forever, and a request left in
 * flight repopulates a dropdown the buyer has already moved past.
 *
 * TWO-25326 §1 split the two texts this surface used to conflate. The
 * company-NAME input is no longer the search box: the dropdown panel carries a
 * query input of its own (`.two-company-query`), that is what `getItems()`
 * reads in search mode, and the name field is left untouched until a result is
 * selected. The fixture below therefore renders BOTH inputs, and every search
 * in this file is driven through the query one.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

describe("company-name field picker", () => {
  let env;
  let fetchStub;
  let component;
  let field;
  let queryInput;
  let root;

  beforeEach(() => {
    // setAddressData() walks four levels up from $root to find the address
    // container, so the nesting depth here is load-bearing.
    //
    // The `.two-company-query` input is the dropdown panel's own search box
    // (TWO-25326 §1). It sits AFTER the company-name input, as it does in the
    // shipped markup, which is what makes `companyNameField()`'s
    // `:not(.two-company-query)` exclusion do real work here rather than being
    // satisfied by document order.
    document.body.innerHTML = [
      '<div id="address-container">',
      '  <input name="city" value="" />',
      '  <input name="postcode" value="" />',
      '  <input name="street[0]" value="" />',
      "  <div><div><div>",
      '    <div id="company-root">',
      '      <input type="text" id="company-field" value="" />',
      '      <input type="text" class="two-company-query" id="company-query" value="" />',
      "    </div>",
      "  </div></div></div>",
      "</div>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    field = document.getElementById("company-field");
    queryInput = document.getElementById("company-query");
    root = document.getElementById("company-root");
    component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: field,
      root: root,
    });
    component.init();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * @param {string} name
   * @param {string} id
   * @returns {Object}
   */
  function apiItem(name, id) {
    return {
      name: name,
      highlight: "<em>" + name + "</em>",
      national_identifier: { id: id },
      lookup_id: "lookup-" + id,
    };
  }

  /**
   * Start a search and wait until it is on the wire.
   *
   * The term goes into the PANEL's query field, never the company-name field
   * (TWO-25326 §1): `getItems()` reads `queryField()` in search mode, and
   * writing the term into the name field instead would exercise nothing —
   * the search would run for the empty query.
   *
   * Wrapped rather than returned bare: an async function returning the
   * promise would adopt it, so the caller would block on a request it has not
   * settled yet.
   *
   * @param {string} term
   * @returns {Promise<{pending: Promise}>}
   */
  async function startSearch(term) {
    queryInput.value = term;
    const pending = component.getItems();
    await H.flushPromises();
    return { pending: pending };
  }

  test("the picker registers itself under the branded Alpine name", () => {
    // The name carries the brand prefix (`getAlpineFnPrefix()`), which is
    // how an overlay ships its own component alongside the vanilla one.
    expect(typeof env.alpineComponents[COMPONENT_NAME]).toBe("function");
    expect(typeof global[COMPONENT_NAME]).toBe("function");
  });

  test("manual mode is restored from browser storage on init", () => {
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({ manual_mode: true }),
    );

    const restored = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: field,
    });
    restored.init();

    expect(restored.manualMode).toBe(true);
  });

  describe("every early return leaves the spinner down and the wire clear", () => {
    test("a selection empties the panel query instead of arming a selection-echo flag", async () => {
      // REPLACES "a selection in progress consumes its flag and stops".
      //
      // The old premise was `isSelecting`: a one-shot flag selectItem() armed
      // so that the very next (debounced) getItems() tick bailed out, because
      // writing the chosen name back into the company-name field fired that
      // field's `input` binding and THAT is what drove the search. TWO-25326
      // §1 removed the whole mechanism — the name field no longer drives
      // search at all — so what stops a re-search now is that selectItem()
      // empties the panel's own query and closes the panel.
      queryInput.value = "acme";
      component.query = "acme";
      component.searchCompletedFor = "acme";

      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });
      await H.flushPromises();

      expect(component.query).toBe("");
      expect(component.searchCompletedFor).toBeNull();
      expect(component.isOpen).toBe(false);
      expect("isSelecting" in component).toBe(false);
      expect("awaitingSelectionEcho" in component).toBe(false);

      // And the tick behind it searches for nothing, because there is no
      // query left to search for.
      queryInput.value = "";
      await component.getItems();
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("the chosen name reaches the name field through a non-bubbling input event", async () => {
      // The other half of what `isSelecting` used to guard. selectItem() still
      // writes the chosen name into the company-name field and still dispatches
      // a synthetic `input` — that is how the name reaches Hyvä's own
      // Magewire-bound field state — and it must still be NON-bubbling, or the
      // address-book modal reads it as an outside interaction and closes.
      const bubbles = [];
      field.addEventListener("input", (event) => bubbles.push(event.bubbles));
      const onBody = jest.fn();
      document.body.addEventListener("input", onBody);

      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });
      await H.flushPromises();

      expect(field.value).toBe("Acme Widgets");
      expect(bubbles).toEqual([false]);
      expect(onBody).not.toHaveBeenCalled();

      document.body.removeEventListener("input", onBody);
    });

    test("manual entry mode never searches", async () => {
      component.manualMode = true;
      field.value = "acme";

      await component.getItems();

      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("fewer than three characters clears the list without searching", async () => {
      component.items = [{ companyName: "Stale" }];
      queryInput.value = "ac";

      await component.getItems();

      expect(component.items).toEqual([]);
      // The verdict from the previous search is dropped with the list, or
      // "No matches found" would sit under a query that was never run.
      expect(component.searchCompletedFor).toBeNull();
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("no resolvable country warns the buyer once and does not search", async () => {
      component.quoteData = {};
      queryInput.value = "acme";

      await component.getItems();
      await component.getItems();

      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
      expect(env.messages).toHaveLength(1);
      expect(component.countrySelectionShown).toBe(true);
    });

    test("an in-flight search is aborted when the buyer drops below three characters", async () => {
      const { pending } = await startSearch("acme");
      expect(fetchStub.calls).toHaveLength(1);

      queryInput.value = "ac";
      const shortened = component.getItems();
      await Promise.all([pending, shortened]);

      expect(component.searchAbortController).toBeNull();
      expect(component.isSearching).toBe(false);
      expect(component.items).toEqual([]);
    });
  });

  describe("results", () => {
    test("a successful search fills the list and lowers the spinner, without opening the panel itself", async () => {
      // REPLACES an `isOpen === true` assertion here. TWO-25326 §1 removed
      // `if (items.length > 0) this.isOpen = true` from getItems(): the panel
      // opens on click or keypress (see "the panel opens on interaction, not
      // on results" below), never on results arriving. Gating it on a
      // non-empty result set is precisely why a zero-result search rendered
      // no panel, so no "no matches" message could ever have been seen.
      component.isOpen = false;
      const { pending } = await startSearch("acme");
      expect(component.isSearching).toBe(true);

      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });
      await pending;

      expect(component.items).toHaveLength(1);
      expect(component.items[0].companyName).toBe("Acme Widgets");
      expect(component.isOpen).toBe(false);
      expect(component.searchCompletedFor).toBe("acme");
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
      expect(component.isSearchUnavailable).toBe(false);
    });

    test("the panel opens on interaction, not on results", async () => {
      // The behaviour that replaced the results-gated open. Clicking the
      // company-name field opens the panel and moves focus into the query
      // input; FOCUS alone deliberately does not, because the ticket requires
      // that merely tabbing into the field leaves the panel shut.
      expect(component.isOpen).toBe(false);

      component.onCompanyNameClick();
      await H.flushPromises();

      expect(component.isOpen).toBe(true);
      expect(component.showDropdown()).toBe(true);
      expect(document.activeElement).toBe(queryInput);
      // Nothing searched: the query field is empty, so the panel opens onto
      // the min-characters hint.
      expect(fetchStub.calls).toHaveLength(0);
    });

    test("a keystroke on the company-name field is routed into the query, leaving the name untouched", async () => {
      // The company-name field must not change until a result is selected
      // (TWO-25326 §1), so every editing key on it is prevented and its
      // character seeds the panel's query instead.
      field.value = "Existing Name";
      const event = { key: "a", preventDefault: jest.fn() };

      component.onCompanyNameKeydown(event);
      await H.flushPromises();

      expect(event.preventDefault).toHaveBeenCalled();
      expect(field.value).toBe("Existing Name");
      expect(component.isOpen).toBe(true);
      expect(queryInput.value).toBe("a");
      expect(component.query).toBe("a");
      expect(document.activeElement).toBe(queryInput);
    });

    test("Tab on the company-name field is left alone, so the field is not a keyboard trap", () => {
      const event = { key: "Tab", preventDefault: jest.fn() };

      component.onCompanyNameKeydown(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(component.isOpen).toBe(false);
    });

    test("the search asks for the country the quote resolves to", async () => {
      const { pending } = await startSearch("acme");

      const url = new URL(fetchStub.last().url);
      expect(url.searchParams.get("country")).toBe("GB");
      expect(url.searchParams.get("q")).toBe("acme");

      // Settled before finishing: an unsettled search leaves a live 30s timer
      // armed behind the test.
      fetchStub.last().respond({ items: [] });
      await pending;
    });

    test("a genuine zero-result search is not flagged unavailable, and says so", async () => {
      component.isOpen = true;
      const { pending } = await startSearch("acme");
      // Still on the wire: "No matches found" must NOT be claimed yet.
      expect(component.noMatchesVisible).toBe(false);

      fetchStub.last().respond({ items: [] });
      await pending;

      expect(component.items).toEqual([]);
      expect(component.isSearchUnavailable).toBe(false);
      // The verdict is recorded against the query it ran for, which is what
      // lets the panel distinguish a completed empty search from one still in
      // flight (TWO-25326 §1).
      expect(component.searchCompletedFor).toBe("acme");
      expect(component.noMatchesVisible).toBe(true);
    });

    test('"No matches found" comes down the moment the query changes, before the next search runs', async () => {
      // The window `searchCompletedFor` exists for, and the only one that
      // isolates it: `isSearching` is already false and the query is already
      // long enough, so every other term in `noMatchesVisible` reads true. The
      // buyer has typed one more character and the debounced search behind it
      // has not fired yet — claiming "no matches" here would be a verdict on a
      // query that was never run.
      component.isOpen = true;
      const { pending } = await startSearch("acme");
      fetchStub.last().respond({ items: [] });
      await pending;
      expect(component.noMatchesVisible).toBe(true);

      // One keystroke, through the undebounced handler the query field binds.
      queryInput.value = "acmex";
      component.$el = queryInput;
      component.noteCompanyQuery();
      component.$el = field;

      expect(component.isSearching).toBe(false);
      expect(component.query.length).toBeGreaterThanOrEqual(
        component.minSearchChars,
      );
      expect(component.searchCompletedFor).toBeNull();
      expect(component.noMatchesVisible).toBe(false);
    });

    test("a failed search says nothing about whether matches exist", async () => {
      component.isOpen = true;
      const { pending } = await startSearch("acme");
      fetchStub.last().networkError();
      await pending;

      expect(component.isSearchUnavailable).toBe(true);
      expect(component.searchCompletedFor).toBeNull();
      expect(component.noMatchesVisible).toBe(false);
    });

    test.each([
      ["a non-2xx", (call) => call.respondWithStatus(503)],
      ["a network error", (call) => call.networkError()],
      ["a degraded 200", (call) => call.respond({ degraded: true, items: [] })],
    ])(
      '%s is flagged unavailable, not as "no companies found"',
      async (_label, settle) => {
        const { pending } = await startSearch("acme");
        settle(fetchStub.last());
        await pending;

        expect(component.isSearchUnavailable).toBe(true);
        expect(component.items).toEqual([]);
        expect(component.isSearching).toBe(false);
      },
    );

    test("a missing helper is caught rather than becoming an unhandled rejection", async () => {
      delete window.twoGatewayCompanySearch;
      queryInput.value = "acme";

      await component.getItems();

      // Failing structurally must not latch the spinner on.
      expect(component.isSearchUnavailable).toBe(true);
      expect(component.isSearching).toBe(false);
    });

    test("a stale response cannot repopulate the dropdown under a newer search", async () => {
      const { pending: first } = await startSearch("acm");
      const staleRequest = fetchStub.last();
      const { pending: second } = await startSearch("acme");

      staleRequest.respond({ items: [apiItem("Stale Result", "999")] });
      await first;
      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });
      await second;

      expect(component.items).toHaveLength(1);
      expect(component.items[0].companyId).toBe("111");
    });

    test("switching to manual entry mid-flight does not reopen the dropdown", async () => {
      const { pending } = await startSearch("acme");

      component.enterManually();
      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });
      await pending;

      // showDropdown() does now carry a manual-mode term, so nothing would be
      // rendered over the manual-entry fields — but writing items here would
      // still leave a stale result list ready to appear the moment the buyer
      // switched back to searching, with `isOpen` still set from the keystroke
      // that started this search.
      expect(component.manualMode).toBe(true);
      expect(component.items).toEqual([]);
      expect(component.isOpen).toBe(false);
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
    });

    test("closing the dropdown aborts whatever is in flight and empties the query", async () => {
      const { pending } = await startSearch("acme");
      expect(component.query).toBe("acme");

      component.closeDropdown();
      await pending;

      expect(component.searchAbortController).toBeNull();
      expect(component.isSearching).toBe(false);
      expect(component.isOpen).toBe(false);
      expect(component.items).toEqual([]);
      // The query text is the PANEL's state, not the buyer's captured company
      // (TWO-25326 §1): a reopened panel starts from the min-characters hint,
      // not from a term someone abandoned. Both the state and the DOM value,
      // because the DOM is what the next getItems() re-reads.
      expect(component.query).toBe("");
      expect(queryInput.value).toBe("");
      expect(component.searchCompletedFor).toBeNull();
      expect(component.selectedIndex).toBe(-1);
    });
  });

  describe("selection", () => {
    const chosen = {
      companyName: "Acme Widgets",
      companyId: "111",
      lookupId: "lookup-111",
    };

    test("the chosen company is written to the field, storage and an event", async () => {
      const seen = [];
      window.addEventListener("shipping-company-selected", (event) =>
        seen.push(event.detail),
      );
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({ quote_id: "test-quote-1" }),
      );

      component.selectItem(chosen);

      expect(field.value).toBe("Acme Widgets");
      expect(component.search).toBe("Acme Widgets");
      expect(component.isOpen).toBe(false);
      expect(component.manualMode).toBe(false);
      // The panel's own query is discarded with the panel — see "a selection
      // empties the panel query…" above for why that replaced `isSelecting`.
      expect(component.query).toBe("");

      const stored = JSON.parse(
        env.browserStorage.getItem(H.COMPANY_SELECTION_KEY),
      );
      // A pick is the only writer allowed to claim registry provenance, and the
      // restore path locks the number field on exactly that claim.
      expect(stored).toEqual({
        quote_id: "test-quote-1",
        company_name: "Acme Widgets",
        company_id: "111",
        company_id_source: "registry",
        manual_mode: false,
      });
      expect(seen).toEqual([stored]);
    });

    test("a selection aborts the search still on the wire", async () => {
      const { pending } = await startSearch("acme");

      component.selectItem(chosen);
      fetchStub.last().respondWithStatus(500);
      await Promise.all([pending, H.flushPromises()]);

      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
    });

    test("the detail record fills the address fields", async () => {
      component.selectItem(chosen);

      expect(fetchStub.last().url).toContain(
        "/companies/v2/company/lookup-111",
      );
      fetchStub.last().respond({
        addresses: [
          {
            city: "Oslo",
            postal_code: "0150",
            street_address: "1 Example Road",
          },
        ],
      });
      await H.flushPromises();

      expect(document.querySelector('input[name="city"]').value).toBe("Oslo");
      expect(document.querySelector('input[name="postcode"]').value).toBe(
        "0150",
      );
      expect(document.querySelector('input[name="street[0]"]').value).toBe(
        "1 Example Road",
      );
    });

    test("a failed detail lookup leaves what the buyer typed alone", async () => {
      document.querySelector('input[name="city"]').value = "Typed by the buyer";

      component.selectItem(chosen);
      fetchStub.last().respondWithStatus(500);
      await H.flushPromises();

      expect(document.querySelector('input[name="city"]').value).toBe(
        "Typed by the buyer",
      );
    });

    test("a company with no lookup id skips the detail request entirely", async () => {
      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });

      expect(fetchStub.calls).toHaveLength(0);
    });
  });

  describe("manual entry", () => {
    test("entering manual mode persists it and clears the list", () => {
      component.items = [{ companyName: "Acme Widgets" }];
      component.isOpen = true;

      component.enterManually();

      expect(component.manualMode).toBe(true);
      expect(component.items).toEqual([]);
      expect(component.isOpen).toBe(false);
      expect(
        JSON.parse(env.browserStorage.getItem(H.COMPANY_SELECTION_KEY))
          .manual_mode,
      ).toBe(true);
    });

    test("going back to search persists that too", () => {
      component.enterManually();
      component.enableSearch();

      expect(component.manualMode).toBe(false);
      expect(
        JSON.parse(env.browserStorage.getItem(H.COMPANY_SELECTION_KEY))
          .manual_mode,
      ).toBe(false);
    });

    test("the click handlers stop propagation so the address modal stays open", () => {
      const event = {
        stopPropagation: jest.fn(),
        stopImmediatePropagation: jest.fn(),
      };

      component.enterManually(event);

      expect(event.stopPropagation).toHaveBeenCalled();
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
    });
  });

  describe("the dropdown's x-for key", () => {
    /**
     * A row's scope, the way Alpine's `x-for` supplies it: `item` and `index`
     * layered over the component, which is what the `:key` getter reads.
     *
     * @param {string} name
     * @param {string} id the mapped identifier — '' when the hit had none
     * @param {number} index
     * @returns {Object}
     */
    function row(name, id, index) {
      return Object.assign(Object.create(component), {
        item: { companyName: name, companyDisplayName: name, companyId: id },
        index: index,
      });
    }

    test("stays unique when two hits in one response have no identifier", () => {
      // Bound to `companyId`, this collided on '' — and Alpine renders one row
      // per distinct key, so the whole list went down and the buyer lost
      // companies that matched. Term-dependent, not order-dependent.
      const first = row("Example Trading Ltd", "", 0);
      const second = row("Example Holdings Ltd", "", 1);

      expect(first.twoGatewayHyvaGetCompanyId()).toBeTruthy();
      expect(second.twoGatewayHyvaGetCompanyId()).toBeTruthy();
      expect(first.twoGatewayHyvaGetCompanyId()).not.toBe(
        second.twoGatewayHyvaGetCompanyId(),
      );
    });

    test("is what the template actually binds", () => {
      // The getter is only half the fix; the other half is `companyName.phtml`
      // binding to it. Reverting the binding to `:key="item.companyId"` left
      // every other test in this file green, because they all call the getter
      // directly — so the binding is read out of the template here.
      expect(
        H.readAlpineBinding(
          H.COMPANY_NAME_MARKUP_TEMPLATE,
          "template[x-for]",
          ":key",
        ),
      ).toBe("twoGatewayHyvaGetCompanyId");
    });

    test("is the identifier itself when there is one", () => {
      expect(
        row("Example Trading Ltd", "12345678", 0).twoGatewayHyvaGetCompanyId(),
      ).toBe("12345678");
    });
  });

  describe("a Magewire re-render mid-flight", () => {
    test("does not write results into a detached component", async () => {
      const started = await startSearch("example");
      expect(fetchStub.calls.length).toBe(1);

      // Magewire's diff-merge replaces the address-form subtree: this
      // component's root leaves the document while its request is in flight.
      // The node has no `wire:ignore` — deliberately, it wraps a
      // Magewire-bound address field — so the guard is in getItems().
      root.remove();

      fetchStub.last().respond({ items: [{ name: "Example Trading Ltd" }] });
      await started.pending;

      expect(component.items).toEqual([]);
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBe(null);
      expect(component.searchCompletedFor).toBe(null);
    });

    test("does not write when the component root is gone entirely", async () => {
      const started = await startSearch("example");

      // Alpine's teardown leaves no `_x_dataStack` to walk up to, so `$root` is
      // undefined rather than a detached node. A guard written as
      // `this.$root && !this.$root.isConnected` passes here and writes anyway —
      // which is how it shipped the first time.
      component.$root = undefined;

      fetchStub.last().respond({ items: [{ name: "Example Trading Ltd" }] });
      await started.pending;

      expect(component.items).toEqual([]);
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBe(null);
    });

    test("a component still in the document is written to as normal", async () => {
      const started = await startSearch("example");

      fetchStub.last().respond({ items: [{ name: "Example Trading Ltd" }] });
      await started.pending;

      expect(component.items.length).toBe(1);
      // The counterpart of the two guards above: a live component records the
      // verdict. `isOpen` is deliberately NOT asserted here — getItems() no
      // longer opens the panel (TWO-25326 §1).
      expect(component.searchCompletedFor).toBe("example");
    });
  });

  describe("returning to search from manual entry", () => {
    /**
     * The "Search for company" button is a route back INTO search, not a
     * visibility toggle: taking it has to leave the buyer inside an OPEN panel
     * with the caret in its query field. Both halves used to be missing —
     * enterManually() empties `items`, and `showDropdown()` was gated on
     * `items.length > 0`, so unhiding the search section alone produced a
     * populated, closed, unexplained field.
     *
     * TWO-25326 §3 moved where the caret lands and dropped the re-search.
     * enableSearch() now delegates the whole thing to `openDropdown('')`: the
     * panel opens, focus goes to the QUERY field (which starts empty), and the
     * buyer's manually-typed company name is left alone in the name field
     * rather than being re-run as a query — it is a name, not a search term.
     *
     * Asserted against the real DOM (`document.activeElement`) and the real
     * wire (a recorded fetch), never against a spy on the handler: a
     * `toHaveBeenCalledWith` on getItems would pass over a getItems that
     * returned at its first guard and searched nothing.
     */

    /** Move focus off both inputs so a focus assertion cannot pass vacuously. */
    function blurField() {
      field.blur();
      queryInput.blur();
      expect(document.activeElement).not.toBe(field);
      expect(document.activeElement).not.toBe(queryInput);
    }

    test("the button the buyer clicks is bound to enableSearch", () => {
      // Under Hyvä's CSP-friendly Alpine the attribute is a key lookup, so a
      // handler the markup does not name is dead code and a name the component
      // does not define is a silently inert control.
      //
      // A real `<button>` since TWO-25326 §2, not a `role="button"` span, so
      // the selector names the element type as well as the class — a
      // regression back to a span would be a keyboard regression too.
      const bound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        'button.two-company-search-again[type="button"]',
        "@click.stop",
      );

      expect(bound).toBe("enableSearch");
      expect(typeof component[bound]).toBe("function");
    });

    test("the results dropdown is driven by showDropdown", () => {
      // Ties the state the tests below assert to the element that actually
      // appears; asserting `isOpen` alone would not.
      const bound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        "div.z-40",
        "x-show",
      );

      expect(bound).toBe("showDropdown");
      expect(typeof component[bound]).toBe("function");
    });

    test("opens the panel and puts the caret in its query field", async () => {
      // REPLACES "focuses the field and re-opens the dropdown for the term in
      // it". §3 reversed both halves of that: focus lands in the QUERY input,
      // not the company-name field, and nothing is re-searched, because the
      // query field starts empty.
      const started = await startSearch("Alpha Widgets");
      fetchStub.last().respond({ items: [apiItem("Alpha Widgets", "111")] });
      await started.pending;

      component.enterManually();
      expect(component.items).toEqual([]);
      expect(component.showDropdown()).toBe(false);
      blurField();

      component.enableSearch();
      await H.flushPromises();

      expect(component.manualMode).toBe(false);
      expect(component.isOpen).toBe(true);
      expect(component.showDropdown()).toBe(true);
      // Keyboard focus, in the document — the panel is useless if the caret is
      // still wherever the mouse left it.
      expect(document.activeElement).toBe(queryInput);
    });

    test("does NOT re-run the manually-typed company name as a query", async () => {
      // REPLACES "puts a real request on the wire for a name typed while in
      // manual mode". The previous revision re-searched whatever the
      // company-name field held; §1 makes that field a NAME, not a search box,
      // so replaying it would put the buyer's hand-entered company name onto
      // the wire as a registry query and reopen a list they had already
      // rejected. The name itself must survive untouched.
      component.enterManually();
      field.value = "Beta Holdings";
      component.onNameFieldInput();
      const before = fetchStub.calls.length;
      blurField();

      component.enableSearch();
      await H.flushPromises();

      expect(fetchStub.calls).toHaveLength(before);
      expect(field.value).toBe("Beta Holdings");
      expect(component.query).toBe("");
      expect(queryInput.value).toBe("");
      expect(document.activeElement).toBe(queryInput);
    });

    test("a pick survives bouncing out to manual entry and back", async () => {
      // REPLACES "re-searches even inside the debounce window after a pick",
      // whose whole subject was the removed `isSelecting` one-shot guard. What
      // matters now is that the round trip does not silently re-query the
      // chosen company or clear it: the name stays in the field, the panel
      // comes back empty, and nothing goes on the wire.
      const started = await startSearch("Gamma Trading");
      fetchStub.last().respond({ items: [apiItem("Gamma Trading", "333")] });
      await started.pending;

      component.selectItem({
        companyName: "Gamma Trading",
        companyId: "333",
        lookupId: "",
      });
      await H.flushPromises();
      const before = fetchStub.calls.length;

      component.enterManually();
      blurField();

      component.enableSearch();
      await H.flushPromises();

      expect(fetchStub.calls).toHaveLength(before);
      expect(field.value).toBe("Gamma Trading");
      expect(component.companyId).toBe("333");
      expect(component.items).toEqual([]);
      expect(document.activeElement).toBe(queryInput);
    });

    test("resolves the company-name field, not the clicked control, when reached from a mode button", async () => {
      // The actual defect the resolver fixes, and the one thing the harness's
      // static `$el` cannot reproduce on its own: Alpine resolves `$el` PER
      // EXPRESSION, so a method reached from `@click.stop="enterManually"` on
      // the button sees the <button>, not the input. Reassigning `$el` here is
      // what a real click does.
      //
      // Driven through enterManually() rather than enableSearch(): §3 means
      // enableSearch() no longer reads the field at all, but enterManually()
      // still has to PLACE FOCUS in it (§2), and getItems()'s manual branch
      // still has to read the typed name out of it. With the resolver reduced
      // to `return this.$el`, the first lands focus on the button and the
      // second records the button's (absent) value.
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "My company is not on the list";
      root.appendChild(button);
      field.value = "Delta Logistics";

      component.$el = button;
      component.enterManually();
      await H.flushPromises();

      expect(document.activeElement).toBe(field);

      await component.getItems();

      expect(component.search).toBe("Delta Logistics");
      expect(fetchStub.calls).toHaveLength(0);
    });

    test("never mistakes the company-number input for the search field", () => {
      // Both are `type="text"` inside one component root, so an unanchored
      // selector is correct only by document order. Put the number input FIRST
      // and the exclusion is the only thing left standing between the resolver
      // and publishing an organisation number as the company name.
      const number = document.createElement("input");
      number.type = "text";
      number.className =
        "company_id block w-full form-input grow renderer-text";
      number.value = "999999999";
      root.insertBefore(number, field);
      field.value = "Epsilon Foods";

      component.$el = null;

      expect(component.companyNameField()).toBe(field);
    });

    test("the panel opens even with nothing to search yet, so it can explain itself", async () => {
      // REPLACES "a term too short to search opens nothing but still takes
      // focus". Under §1 the min-characters hint lives INSIDE the panel and
      // fires from zero characters, so the panel opening with an empty query
      // is the whole point — a shut panel would be the old bug, where the
      // buyer clicked in and got no explanation until they had typed a letter.
      component.enterManually();
      field.value = "Ab";
      component.onNameFieldInput();
      blurField();
      const before = fetchStub.calls.length;

      component.enableSearch();
      await H.flushPromises();

      expect(document.activeElement).toBe(queryInput);
      expect(fetchStub.calls).toHaveLength(before);
      expect(component.isOpen).toBe(true);
      expect(component.showDropdown()).toBe(true);
      expect(component.query).toBe("");
      expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(true);
    });

    test("Escape closes the panel and returns focus to the company-name field", async () => {
      // §1/§4. Focus left on a removed element falls to `<body>`, which is
      // where every keyboard trap on this ticket started, so this asserts
      // where focus actually landed rather than that `.focus()` was called.
      component.openDropdown("");
      await H.flushPromises();
      expect(document.activeElement).toBe(queryInput);

      component.onQueryEscape();
      await H.flushPromises();

      expect(component.isOpen).toBe(false);
      expect(document.activeElement).toBe(field);
    });

    test("does not disturb an intact registry pick whose field is not re-read", () => {
      // The field is empty on a freshly restored step while state holds the
      // stored company. getItems() clears a stale identifier ABOVE its own
      // min-characters guard, so driving it from that field would drop a
      // registry number nothing was wrong with and re-ask for it.
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          company_name: "Acme Ltd",
          company_id: "111",
          company_id_source: "registry",
          manual_mode: true,
        }),
      );
      const restored = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: field,
        root: root,
      });
      restored.init();
      field.value = "";
      const before = fetchStub.calls.length;

      restored.enableSearch();

      expect(fetchStub.calls).toHaveLength(before);
      expect(restored.companyId).toBe("111");
      expect(restored.companyIdSource).toBe("registry");
      expect(restored.companyIdDisabled).toBe(true);
    });
  });

  /**
   * Arrow-key navigation through the results dropdown. This surface used to
   * have none: the dropdown was reachable and openable by keyboard (the
   * "Search for company" affordance and the field itself), but once open
   * there was no way to move through `items` other than a mouse — no
   * `role="listbox"`/`role="option"` here (this dropdown is plain divs, see
   * the manual-entry-row comment in companyName.phtml), so Tab visits the
   * whole page, not just the rows. Mirrors the payment tile's
   * `OnArrowDown`/`OnArrowUp`/`OnEnterSelect`/`OnItemMouseover`/`GetItemClass`.
   */
  describe("keyboard navigation of the results dropdown", () => {
    /** A row's scope the way `x-for` supplies it, matching the `row()` helper above. */
    function row(index) {
      return Object.assign(Object.create(component), { index: index });
    }

    beforeEach(() => {
      component.items = [
        { companyName: "Acme Ltd", companyDisplayName: "Acme Ltd", companyId: "1" },
        { companyName: "Beta Ltd", companyDisplayName: "Beta Ltd", companyId: "2" },
        { companyName: "Gamma Ltd", companyDisplayName: "Gamma Ltd", companyId: "3" },
      ];
      // The panel has to be genuinely open for `showDropdown()` to read true —
      // OnEnterSelect() gates on it, not just on `items`/`selectedIndex`.
      component.isOpen = true;
    });

    test("starts with nothing highlighted", () => {
      expect(component.selectedIndex).toBe(-1);
      expect(row(0).twoGatewayHyvaGetItemClass()).toBe("");
    });

    test("ArrowDown moves the highlight forward one row at a time", () => {
      component.twoGatewayHyvaOnArrowDown();
      expect(component.selectedIndex).toBe(0);

      component.twoGatewayHyvaOnArrowDown();
      expect(component.selectedIndex).toBe(1);
    });

    test("ArrowDown clamps at the last row rather than wrapping", () => {
      component.selectedIndex = 2;

      component.twoGatewayHyvaOnArrowDown();

      expect(component.selectedIndex).toBe(2);
    });

    test("ArrowUp moves the highlight backward one row at a time", () => {
      component.selectedIndex = 2;

      component.twoGatewayHyvaOnArrowUp();
      expect(component.selectedIndex).toBe(1);
    });

    test("ArrowUp clamps at the first row rather than going negative", () => {
      component.selectedIndex = 0;

      component.twoGatewayHyvaOnArrowUp();

      expect(component.selectedIndex).toBe(0);
    });

    test("hovering a row highlights it, so mouse and keyboard share one piece of state", () => {
      component.twoGatewayHyvaOnItemMouseover({
        currentTarget: { dataset: { index: "2" } },
      });

      expect(component.selectedIndex).toBe(2);
    });

    test("GetItemClass marks only the highlighted row", () => {
      component.selectedIndex = 1;

      expect(row(0).twoGatewayHyvaGetItemClass()).toBe("");
      expect(row(1).twoGatewayHyvaGetItemClass()).not.toBe("");
      expect(row(2).twoGatewayHyvaGetItemClass()).toBe("");
    });

    test("Enter selects the highlighted row — the same effect as clicking it", async () => {
      component.selectedIndex = 1;
      const event = { preventDefault: jest.fn() };

      component.twoGatewayHyvaOnEnterSelect(event);
      await H.flushPromises();

      expect(component.search).toBe("Beta Ltd");
      expect(component.isOpen).toBe(false);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    test("Enter with nothing highlighted selects nothing and does not prevent the native submit", () => {
      const before = component.search;
      const event = { preventDefault: jest.fn() };

      component.twoGatewayHyvaOnEnterSelect(event);

      expect(component.search).toBe(before);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    test("Enter falls through to the native submit once the panel has closed, even with a stale highlight", () => {
      // The race Han's round-2 review caught: noteCompanyQuery() closes the
      // panel (isOpen = false) SYNCHRONOUSLY on every keystroke once the
      // query drops below the minimum length, but items/selectedIndex are
      // only reset inside the DEBOUNCED getItems(), up to 500ms behind it.
      // A buyer who shrinks the query and hits Enter in that window must not
      // have it swallowed for a row they can no longer even see.
      component.isOpen = false;
      component.selectedIndex = 1;
      const event = { preventDefault: jest.fn() };

      component.twoGatewayHyvaOnEnterSelect(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    test("Enter in manual mode falls through to the native form submit, even with a stale highlight", () => {
      // The regression this guards: this input is shared between search and
      // manual-entry mode (unlike the payment tile, which uses two separate
      // elements), so binding Enter here at all risks swallowing the manual
      // form's submit. `selectedIndex` being left over from search mode must
      // not resurrect that behaviour once manual mode is active.
      component.manualMode = true;
      component.selectedIndex = 1;
      const event = { preventDefault: jest.fn() };

      component.twoGatewayHyvaOnEnterSelect(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    test("selecting a row resets the highlight", async () => {
      component.selectedIndex = 1;

      component.selectItem(component.items[1]);
      await H.flushPromises();

      expect(component.selectedIndex).toBe(-1);
    });

    test("switching to manual entry resets the highlight too", () => {
      component.selectedIndex = 1;

      component.enterManually();

      expect(component.selectedIndex).toBe(-1);
    });

    test("a fresh query resets the highlight", async () => {
      // The reset lives in getItems() (the debounced search), not
      // noteCompanyQuery() (the undebounced one that only opens/closes the
      // panel by length) — it runs synchronously before the request goes out,
      // so it is there even for a query still in flight.
      component.selectedIndex = 2;

      await startSearch("New search term");

      expect(component.selectedIndex).toBe(-1);
    });

    test("the QUERY field wires ArrowDown/ArrowUp/Enter to the navigation handlers", () => {
      // REPLACES the same assertions made against `input[type=text]` — the
      // company-name field — and the "no .prevent modifier" clause with them.
      //
      // Both moved with the search box (TWO-25326 §1). The keys are bound on
      // `.two-company-query`, which is search-only: it is not shared with
      // manual-entry mode the way the company-name input is, so a
      // modifier-level `.prevent` can no longer swallow the address form's
      // native submit and each binding carries one. The name field instead
      // gets a single `@keydown` that routes every editing key into the panel.
      expect(
        H.readAlpineBinding(
          H.COMPANY_NAME_MARKUP_TEMPLATE,
          "input.two-company-query",
          "@keydown.arrow-down.prevent",
        ),
      ).toBe("twoGatewayHyvaOnArrowDown");
      expect(
        H.readAlpineBinding(
          H.COMPANY_NAME_MARKUP_TEMPLATE,
          "input.two-company-query",
          "@keydown.arrow-up.prevent",
        ),
      ).toBe("twoGatewayHyvaOnArrowUp");
      expect(
        H.readAlpineBinding(
          H.COMPANY_NAME_MARKUP_TEMPLATE,
          "input.two-company-query",
          "@keydown.enter.stop.prevent",
        ),
      ).toBe("twoGatewayHyvaOnEnterSelect");
    });

    test("the company-name field no longer carries the search bindings at all", () => {
      // The other half of the move, and the one a passing binding assertion on
      // the query field cannot see: leaving the old listeners in place would
      // give two elements racing for the same keys, and would put the
      // debounced search back on a field that must not change until a result
      // is selected.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const nameInput = doc.querySelector(
        'input[type="text"]:not(.two-company-query)',
      );

      expect(nameInput).not.toBeNull();
      const names = Array.from(nameInput.attributes).map((a) => a.name);
      expect(names.filter((n) => n.startsWith("@keydown."))).toEqual([]);
      expect(names.filter((n) => n.startsWith("@input."))).toEqual([
        "@input.debounce.300ms",
      ]);
      expect(nameInput.getAttribute("@input.debounce.300ms")).toBe(
        "onNameFieldInput",
      );
      // Routed, not edited: one bare `@keydown` that prevents every editing key.
      expect(nameInput.getAttribute("@keydown")).toBe("onCompanyNameKeydown");
      expect(nameInput.getAttribute("@click")).toBe("onCompanyNameClick");
    });

    test("each result row wires mouseover and the highlight class", () => {
      // `<template>` content lives in `.content`, a separate DocumentFragment
      // — not reachable through the parsed document's own querySelector, so
      // this reads the row out of the template's content directly rather than
      // going through `H.readAlpineBinding()`, which only resolves elements in
      // the light DOM.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const template = doc.querySelector("template[x-for]");
      expect(template).not.toBeNull();
      // The index is bound dynamically (`:data-index`), not a static
      // attribute, so there is nothing literal to select on — this template
      // has exactly one row element.
      const rowEl = template.content.querySelector("div");
      expect(rowEl).not.toBeNull();

      expect(rowEl.getAttribute("@mouseover")).toBe(
        "twoGatewayHyvaOnItemMouseover",
      );
      expect(rowEl.getAttribute(":class")).toBe("twoGatewayHyvaGetItemClass");
    });
  });
});
