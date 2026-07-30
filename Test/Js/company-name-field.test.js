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
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

describe("company-name field picker", () => {
  let env;
  let fetchStub;
  let component;
  let field;
  let root;

  beforeEach(() => {
    // setAddressData() walks four levels up from $root to find the address
    // container, so the nesting depth here is load-bearing.
    document.body.innerHTML = [
      '<div id="address-container">',
      '  <input name="city" value="" />',
      '  <input name="postcode" value="" />',
      '  <input name="street[0]" value="" />',
      "  <div><div><div>",
      '    <div id="company-root"><input type="text" id="company-field" value="" /></div>',
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
   * Wrapped rather than returned bare: an async function returning the
   * promise would adopt it, so the caller would block on a request it has not
   * settled yet.
   *
   * @param {string} term
   * @returns {Promise<{pending: Promise}>}
   */
  async function startSearch(term) {
    field.value = term;
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
    test("a selection in progress consumes its flag and stops", async () => {
      component.isSelecting = true;
      field.value = "acme";

      await component.getItems();

      // The flag is one-shot: selectItem() sets it because writing the
      // chosen name back into the field fires `input` again.
      expect(component.isSelecting).toBe(false);
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
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
      field.value = "ac";

      await component.getItems();

      expect(component.items).toEqual([]);
      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("no resolvable country warns the buyer once and does not search", async () => {
      component.quoteData = {};
      field.value = "acme";

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

      field.value = "ac";
      const shortened = component.getItems();
      await Promise.all([pending, shortened]);

      expect(component.searchAbortController).toBeNull();
      expect(component.isSearching).toBe(false);
      expect(component.items).toEqual([]);
    });
  });

  describe("results", () => {
    test("a successful search opens the dropdown and lowers the spinner", async () => {
      const { pending } = await startSearch("acme");
      expect(component.isSearching).toBe(true);

      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });
      await pending;

      expect(component.items).toHaveLength(1);
      expect(component.items[0].companyName).toBe("Acme Widgets");
      expect(component.isOpen).toBe(true);
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
      expect(component.isSearchUnavailable).toBe(false);
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

    test("a genuine zero-result search is not flagged unavailable", async () => {
      const { pending } = await startSearch("acme");
      fetchStub.last().respond({ items: [] });
      await pending;

      expect(component.items).toEqual([]);
      expect(component.isOpen).toBe(false);
      expect(component.isSearchUnavailable).toBe(false);
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
      field.value = "acme";

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

    test("closing the dropdown aborts whatever is in flight", async () => {
      const { pending } = await startSearch("acme");

      component.closeDropdown();
      await pending;

      expect(component.searchAbortController).toBeNull();
      expect(component.isSearching).toBe(false);
      expect(component.isOpen).toBe(false);
      expect(component.items).toEqual([]);
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
      // isSelecting suppresses the `input` event the write above fires.
      expect(component.isSelecting).toBe(true);

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
      expect(component.isOpen).toBe(false);
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
      expect(component.isOpen).toBe(true);
    });
  });

  describe("returning to search from manual entry", () => {
    /**
     * The "Search for company" link is a route back INTO search, not a
     * visibility toggle: taking it has to leave the buyer with the caret in the
     * field and the dropdown for the term already in it open. Both halves used
     * to be missing — enterManually() empties `items`, and `showDropdown()` is
     * gated on `items.length > 0`, so unhiding the search section alone
     * produced a populated, closed, unexplained field.
     *
     * Asserted against the real DOM (`document.activeElement`) and the real
     * wire (a recorded fetch), never against a spy on the handler: a
     * `toHaveBeenCalledWith` on getItems would pass over a getItems that
     * returned at its first guard and searched nothing.
     */

    /** Move focus off the field so a focus assertion cannot pass vacuously. */
    function blurField() {
      field.blur();
      expect(document.activeElement).not.toBe(field);
    }

    test("the link the buyer clicks is bound to enableSearch", () => {
      // Under Hyvä's CSP-friendly Alpine the attribute is a key lookup, so a
      // handler the markup does not name is dead code and a name the component
      // does not define is a silently inert link.
      const bound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        '[x-show="manualModeActive"] span',
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

    test("focuses the field and re-opens the dropdown for the term in it", async () => {
      const started = await startSearch("Alpha Widgets");
      fetchStub.last().respond({ items: [apiItem("Alpha Widgets", "111")] });
      await started.pending;
      expect(component.showDropdown()).toBe(true);

      component.enterManually();
      expect(component.items).toEqual([]);
      expect(component.showDropdown()).toBe(false);
      blurField();

      component.enableSearch();

      // (b) keyboard focus, in the document, synchronously — not on a tick the
      // buyer's next keystroke could beat.
      expect(document.activeElement).toBe(field);

      // (a) and a dropdown that is genuinely open again, with the hits in it.
      // No new request is asserted here on purpose: the helper caches by
      // query, so re-running the SAME term is legitimately served without one
      // — the outcome the buyer sees is the assertion, not the mechanism.
      await H.flushPromises();

      expect(component.manualMode).toBe(false);
      expect(component.items).toHaveLength(1);
      expect(component.isOpen).toBe(true);
      expect(component.showDropdown()).toBe(true);
    });

    test("puts a real request on the wire for a name typed while in manual mode", async () => {
      // The cache cannot mask this one: the term has never been searched. Proof
      // that the link runs an actual lookup rather than replaying state.
      component.enterManually();
      field.value = "Beta Holdings";
      await component.getItems();
      const before = fetchStub.calls.length;
      blurField();

      component.enableSearch();
      await H.flushPromises();

      expect(fetchStub.calls).toHaveLength(before + 1);
      expect(fetchStub.last().url).toContain("q=Beta+Holdings");
      fetchStub.last().respond({ items: [apiItem("Beta Holdings", "222")] });
      await H.flushPromises();

      expect(document.activeElement).toBe(field);
      expect(component.items).toHaveLength(1);
      expect(component.showDropdown()).toBe(true);
    });

    test("re-searches even inside the debounce window after a pick", async () => {
      // selectItem() arms `isSelecting` for the next getItems() tick, and that
      // tick is debounced 500ms. A buyer who picked a hit and then took both
      // mode links inside that window arrives here with the flag still set, and
      // the guard at the top of getItems() would swallow the whole search.
      const started = await startSearch("Gamma Trading");
      fetchStub.last().respond({ items: [apiItem("Gamma Trading", "333")] });
      await started.pending;

      component.selectItem({
        companyName: "Gamma Trading",
        companyId: "333",
        lookupId: "",
      });
      expect(component.isSelecting).toBe(true);

      component.enterManually();
      blurField();

      component.enableSearch();
      await H.flushPromises();

      expect(document.activeElement).toBe(field);
      expect(component.isSelecting).toBe(false);
      expect(component.items).toHaveLength(1);
      expect(component.showDropdown()).toBe(true);
    });

    test("a term too short to search opens nothing but still takes focus", async () => {
      component.enterManually();
      field.value = "Ab";
      await component.getItems();
      blurField();
      const before = fetchStub.calls.length;

      component.enableSearch();
      await H.flushPromises();

      expect(document.activeElement).toBe(field);
      expect(fetchStub.calls).toHaveLength(before);
      expect(component.isOpen).toBe(false);
      expect(component.showDropdown()).toBe(false);
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
});
