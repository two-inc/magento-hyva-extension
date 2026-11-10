/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The address-form company picker from companyName-csp-js.phtml.
 *
 * This one has no magewire loader — it drives an in-field spinner
 * (`isSearching`) and an "unavailable" verdict (`isSearchUnavailable`) instead.
 * The invariant is the same shape as the overlay's: EVERY exit from a search
 * has to leave the spinner down and nothing on the wire, because a latched
 * `isSearching` is a field that spins forever, and a request left in flight
 * repopulates a list the buyer has already moved past.
 *
 * TWO-25503 deleted this checkout's own popover. The dropdown, its query box,
 * the mode chips and the route in and out of manual entry are the base
 * plugin's shared panel, which is not loadable here — its behaviour is covered
 * where that file lives, and the options this
 * checkout hands it in `company-popover-adapter.test.js`.
 *
 * What is left for this suite is the ENGINE beneath the panel and the address
 * step's own wiring over it. Searches are driven two ways:
 *   - `runCompanySearch(term)` where the case is about engine state;
 *   - `capturePanelSearch({term})` where it is about what the buyer's search
 *     yields, since that is the path the panel takes.
 *
 * Mode is driven through the page-level capture controller, never by assigning
 * `manualMode`: that property is a MIRROR of the shared identity, rewritten on
 * every notification, so an assignment to it decides nothing.
 */

"use strict";

const H = require("./hyva-harness");
const fs = require("fs");
const path = require("path");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";
// The attribute every autofill write carries (TWO-27212).
const MARK = "data-two-autofilled-value";

describe("company-name field picker", () => {
  let env;
  let fetchStub;
  let component;
  let field;
  let root;

  beforeEach(() => {
    // setAddressData() walks four levels up from the control root to find the
    // address container, so the nesting depth here is load-bearing.
    //
    // `class="two-company-search"` on the component root is load-bearing too:
    // the shared control resolves its own root through `controlRoot()`, which
    // returns `$root` only when `$root` itself carries that class and otherwise
    // looks for a descendant carrying it. That is what lets ONE control serve
    // both this surface (where the control IS the Alpine component) and the
    // payment tile (where the control is a subtree of the form's component).
    // Without the class, `companyNameField()` resolves null and every assertion
    // below degrades into "nothing happened".
    document.body.innerHTML = [
      '<div id="address-container">',
      '  <input name="city" value="" />',
      '  <input name="postcode" value="" />',
      '  <input name="street[0]" value="" />',
      '  <input name="telephone" value="" />',
      "  <div><div><div>",
      '    <div id="company-root" class="two-company-search" data-two-capture-host="address">',
      '      <input type="text" id="company-field" data-two-capture-field value="" />',
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
   * Start an engine search and wait until it is on the wire.
   *
   * Wrapped rather than returned bare: an async function returning the promise
   * would adopt it, so the caller would block on a request it has not settled
   * yet.
   *
   * @param {string} term
   * @returns {Promise<{pending: Promise}>}
   */
  async function startSearch(term) {
    const pending = component.runCompanySearch(term);
    await H.flushPromises();
    return { pending: pending };
  }

  /**
   * Start a search the way the popover does, and wait until it is on the wire.
   *
   * @param {string} term
   * @returns {Promise<{pending: Promise<{items: Array, unavailable: boolean, aborted: boolean}>}>}
   */
  async function startPanelSearch(term) {
    const pending = component.capturePanelSearch({ term: term });
    await H.flushPromises();
    return { pending: pending };
  }

  /** @returns {Object} the one page-level capture controller */
  function capture() {
    return env.captureControllers[env.captureControllers.length - 1];
  }

  test("custom headers reach the address-step surface's own capture config", () => {
    // Never wired before now — see docs/api-proxy.md's autofill exception. Default
    // harness value is '{}'; the header itself is only ever read by the
    // shared sole-trader.js this repo does not test.
    expect(capture().config().customHeaders).toEqual({});
  });

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
    test("a selection drops the query it was made from", async () => {
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

      // And the search behind it asks for nothing, because there is no query
      // left to ask for.
      await component.runCompanySearch("");
      expect(fetchStub.searchCalls()).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("the chosen name reaches the name field through a non-bubbling input event", async () => {
      // Non-bubbling or the address-book modal reads it as an outside
      // interaction and closes.
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

    test("manual entry mode never reaches the wire", async () => {
      capture().manualEntryMode();

      const result = await component.capturePanelSearch({ term: "acme" });

      expect(result.aborted).toBe(true);
      expect(fetchStub.searchCalls()).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("fewer than three characters clears the list without searching", async () => {
      component.items = [{ companyName: "Stale" }];

      await component.runCompanySearch("ac");

      expect(component.items).toEqual([]);
      // The verdict from the previous search is dropped with the list, or
      // "No matches found" would sit under a query that was never run.
      expect(component.searchCompletedFor).toBeNull();
      expect(fetchStub.searchCalls()).toHaveLength(0);
      expect(component.isSearching).toBe(false);
    });

    test("no resolvable country warns the buyer once and does not search", async () => {
      component.quoteData = {};

      await component.runCompanySearch("acme");
      await component.runCompanySearch("acme");

      expect(fetchStub.searchCalls()).toHaveLength(0);
      expect(component.isSearching).toBe(false);
      expect(env.messages).toHaveLength(1);
      expect(component.countrySelectionShown).toBe(true);
    });

    test("an in-flight search is aborted when the buyer drops below three characters", async () => {
      const { pending } = await startSearch("acme");
      expect(fetchStub.searchCalls()).toHaveLength(1);

      const shortened = component.runCompanySearch("ac");
      await Promise.all([pending, shortened]);

      expect(component.searchAbortController).toBeNull();
      expect(component.isSearching).toBe(false);
      expect(component.items).toEqual([]);
    });
  });

  describe("results", () => {
    test("a successful search fills the list and lowers the spinner, without opening anything", async () => {
      // The engine owns no open/closed state of its own any more — the panel
      // decides when it shows — so a result arriving must not move `isOpen`.
      component.isOpen = false;
      const { pending } = await startSearch("acme");
      expect(component.isSearching).toBe(true);

      fetchStub
        .lastSearch()
        .respondProxy({ items: [apiItem("Acme Widgets", "111")] });
      await pending;

      expect(component.items).toHaveLength(1);
      expect(component.items[0].companyName).toBe("Acme Widgets");
      expect(component.isOpen).toBe(false);
      expect(component.searchCompletedFor).toBe("acme");
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
      expect(component.isSearchUnavailable).toBe(false);
    });

    test("the search asks for the country the quote resolves to", async () => {
      const { pending } = await startSearch("acme");

      expect(fetchStub.lastSearch().jsonBody()).toEqual({
        country: "GB",
        query: "acme",
      });

      // Settled before finishing: an unsettled search leaves a live 30s timer
      // armed behind the test.
      fetchStub.lastSearch().respondProxy({ items: [] });
      await pending;
    });

    test("a genuine zero-result search is not flagged unavailable", async () => {
      const { pending } = await startPanelSearch("acme");

      fetchStub.lastSearch().respondProxy({ items: [] });
      const result = await pending;

      expect(result).toEqual({ items: [], unavailable: false, aborted: false });
      // The verdict is recorded against the query it ran for, which is what
      // separates a completed empty search from one still in flight.
      expect(component.searchCompletedFor).toBe("acme");
      expect(component.isSearching).toBe(false);
    });

    test("a failed search says nothing about whether matches exist", async () => {
      const { pending } = await startPanelSearch("acme");
      fetchStub.lastSearch().networkError();
      const result = await pending;

      expect(result.unavailable).toBe(true);
      expect(component.isSearchUnavailable).toBe(true);
      expect(component.searchCompletedFor).toBeNull();
    });

    test.each([
      [(call) => call.respondWithStatus(503), "a non-2xx"],
      [(call) => call.networkError(), "a network error"],
      [
        (call) => call.respondProxy({ degraded: true, items: [] }),
        "a degraded 200",
      ],
    ])(
      '%#: is flagged unavailable, not as "no companies found" (%s)',
      async (settle) => {
        const { pending } = await startPanelSearch("acme");
        settle(fetchStub.lastSearch());
        const result = await pending;

        expect(result.unavailable).toBe(true);
        expect(result.items).toEqual([]);
        expect(component.isSearchUnavailable).toBe(true);
        expect(component.items).toEqual([]);
        expect(component.isSearching).toBe(false);
      },
    );

    test("a missing helper is caught rather than becoming an unhandled rejection", async () => {
      delete window.twoGatewayCompanySearch;

      await component.runCompanySearch("acme");

      // Failing structurally must not latch the spinner on.
      expect(component.isSearchUnavailable).toBe(true);
      expect(component.isSearching).toBe(false);
    });

    test("a stale response cannot repopulate the list under a newer search", async () => {
      const { pending: first } = await startSearch("acm");
      const staleRequest = fetchStub.lastSearch();
      const { pending: second } = await startSearch("acme");

      staleRequest.respondProxy({ items: [apiItem("Stale Result", "999")] });
      await first;
      fetchStub
        .lastSearch()
        .respondProxy({ items: [apiItem("Acme Widgets", "111")] });
      await second;

      expect(component.items).toHaveLength(1);
      expect(component.items[0].companyId).toBe("111");
    });

    test("switching to manual entry mid-flight discards the results", async () => {
      const { pending } = await startSearch("acme");

      capture().manualEntryMode();
      fetchStub
        .lastSearch()
        .respondProxy({ items: [apiItem("Acme Widgets", "111")] });
      await pending;

      // Writing items here would leave a stale result list ready to appear the
      // moment the buyer switched back to searching.
      expect(component.manualMode).toBe(true);
      expect(component.items).toEqual([]);
      expect(component.isOpen).toBe(false);
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
    });

    test("closing the dropdown aborts whatever is in flight and empties the query", async () => {
      const { pending } = await startSearch("acme");
      component.query = "acme";

      component.closeDropdown();
      await pending;

      expect(component.searchAbortController).toBeNull();
      expect(component.isSearching).toBe(false);
      expect(component.isOpen).toBe(false);
      expect(component.items).toEqual([]);
      // The query text is the PANEL's state, not the buyer's captured company:
      // a reopened panel starts from the min-characters hint, not from a term
      // someone abandoned.
      expect(component.query).toBe("");
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

    test("the chosen company is written to the field and storage", async () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({ quote_id: "test-quote-1" }),
      );

      component.selectItem(chosen);

      expect(field.value).toBe("Acme Widgets");
      expect(component.search).toBe("Acme Widgets");
      expect(component.isOpen).toBe(false);
      expect(component.manualMode).toBe(false);
      expect(component.query).toBe("");

      // A pick is the only writer allowed to claim registry provenance, and the
      // restore path locks the number field on exactly that claim.
      expect(
        JSON.parse(env.browserStorage.getItem(H.COMPANY_SELECTION_KEY)),
      ).toEqual({
        quote_id: "test-quote-1",
        company_name: "Acme Widgets",
        company_id: "111",
        company_id_source: "registry",
        // TWO-26295: the country the company was captured in.
        company_country: "GB",
        manual_mode: false,
      });
    });

    test("a selection aborts the search still on the wire", async () => {
      const { pending } = await startSearch("acme");

      component.selectItem(chosen);
      fetchStub.lastSearch().respondWithStatus(500);
      await Promise.all([pending, H.flushPromises()]);

      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBeNull();
    });

    test("the detail record fills the address fields", async () => {
      component.selectItem(chosen);

      expect(fetchStub.lastSearch().url).toContain("/rest/V1/two/company");
      expect(fetchStub.lastSearch().jsonBody()).toEqual({
        lookupId: "lookup-111",
      });
      fetchStub.lastSearch().respondProxy({
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
      // TWO-27212: each written field is marked with what was written.
      expect(
        ["city", "postcode", "street[0]"].map((name) =>
          document.querySelector('input[name="' + name + '"]').getAttribute(MARK),
        ),
      ).toEqual(["Oslo", "0150", "1 Example Road"]);
    });

    test("a failed detail lookup leaves what the buyer typed alone", async () => {
      document.querySelector('input[name="city"]').value = "Typed by the buyer";

      component.selectItem(chosen);
      fetchStub.lastSearch().respondWithStatus(500);
      await H.flushPromises();

      expect(document.querySelector('input[name="city"]').value).toBe(
        "Typed by the buyer",
      );
    });

    describe("the registry phone (TWO-27160)", () => {
      const PHONE_A = "+47 22 00 00 01";
      const PHONE_B = "+47 22 00 00 02";
      let picks = 0;

      /** @returns {HTMLInputElement} */
      function telephone() {
        return document.querySelector('input[name="telephone"]');
      }

      /**
       * Pick a fresh company and settle its detail lookup.
       *
       * @param {string|number} reply a phone (`""` for an address with none),
       *   `"no address"`, `"network"`, or an HTTP status the relay passed on
       */
      async function pick(reply) {
        picks += 1;
        const noLookup = reply === "no lookup";
        component.selectItem({
          companyName: "Company " + picks,
          companyId: String(picks),
          lookupId: noLookup ? "" : "lookup-" + picks,
        });
        if (noLookup) return;
        const call = fetchStub.lastSearch();
        if (reply === "network") call.networkError();
        else if (typeof reply === "number")
          call.respondProxy(null, false, reply);
        else if (reply === "no address") call.respondProxy({ addresses: [] });
        else
          call.respondProxy({
            addresses: [{ city: "Oslo", phone_number: reply }],
          });
        await H.flushPromises();
      }

      /** The merchant turns address search off. */
      function searchOff() {
        component.isAddressSearchEnabled = false;
      }

      /** The capture controller's pick of a company with no lookup id. */
      function controllerPickWithNoLookup() {
        picks += 1;
        component.captureAddressLookup({
          text: "Company " + picks,
          companyId: String(picks),
          lookupId: "",
        });
      }

      /** @param {string} value what the buyer leaves in the field */
      function type(value) {
        telephone().value = value;
      }

      /** @param {string} value a sole trader's verified phone */
      function soleTrader(value) {
        component.isAddressAutopopulationEnabled = true;
        component.captureApplyTelephone(value);
      }

      /*
       * The last column counts the `input` events the telephone field got:
       * `wire:model.defer` saves the phone with the quote only on that event,
       * so every write and every clear has to announce itself, and a field
       * left alone must not.
       */
      test.each([
        [
          "a pick with a phone fills an empty field",
          [() => pick(PHONE_A)],
          PHONE_A,
          1,
        ],
        [
          "a registry phone replaces a typed one",
          [() => type("+44 typed"), () => pick(PHONE_A)],
          PHONE_A,
          1,
        ],
        [
          "a re-pick's phone replaces the previous pick's",
          [() => pick(PHONE_A), () => pick(PHONE_B)],
          PHONE_B,
          2,
        ],
        ["the phone is trimmed", [() => pick(" " + PHONE_A + " ")], PHONE_A, 1],
        [
          "a pick with no phone clears the previous pick's",
          [() => pick(PHONE_A), () => pick("")],
          "",
          2,
        ],
        [
          "a re-pick with no address clears it",
          [() => pick(PHONE_A), () => pick("no address")],
          "",
          2,
        ],
        [
          "a failed re-pick clears it",
          [() => pick(PHONE_A), () => pick(500)],
          "",
          2,
        ],
        [
          "a rate-limited re-pick clears it",
          [() => pick(PHONE_A), () => pick(429)],
          "",
          2,
        ],
        [
          "a re-pick lost on the network clears it",
          [() => pick(PHONE_A), () => pick("network")],
          "",
          2,
        ],
        [
          "a pick with no phone keeps a typed one",
          [() => type("+44 typed"), () => pick("")],
          "+44 typed",
          0,
        ],
        [
          "a failed pick keeps a typed one",
          [() => type("+44 typed"), () => pick(500)],
          "+44 typed",
          0,
        ],
        [
          "a pick with no phone keeps an edited registry phone",
          [() => pick(PHONE_A), () => type("+47 edited"), () => pick("")],
          "+47 edited",
          1,
        ],
        [
          "a sole trader's verified phone survives a pick with no phone",
          [() => pick(PHONE_A), () => soleTrader(PHONE_A), () => pick("")],
          PHONE_A,
          2,
        ],
        // TWO-27212: a pick that looks nothing up still replaces the company.
        [
          "a re-pick with no lookup id clears the previous pick's",
          [() => pick(PHONE_A), () => pick("no lookup")],
          "",
          2,
        ],
        [
          "the controller's re-pick with no lookup id clears it",
          [() => pick(PHONE_A), controllerPickWithNoLookup],
          "",
          2,
        ],
        [
          "a re-pick with no lookup id keeps a typed one",
          [() => type("+44 typed"), () => pick("no lookup")],
          "+44 typed",
          0,
        ],
        [
          "a re-pick with no lookup id keeps an edited registry phone",
          [() => pick(PHONE_A), () => type("+47 edited"), () => pick("no lookup")],
          "+47 edited",
          1,
        ],
        [
          "the controller's re-pick with no lookup id keeps a typed one",
          [() => type("+44 typed"), controllerPickWithNoLookup],
          "+44 typed",
          0,
        ],
        [
          "a re-pick with no lookup id keeps a sole trader's verified phone",
          [() => pick(PHONE_A), () => soleTrader(PHONE_A), () => pick("no lookup")],
          PHONE_A,
          2,
        ],
        // With address search off nothing is looked up or retracted, as on
        // Luma: no registry phone can have been written that way.
        [
          "with address search off, a re-pick leaves the phone",
          [() => pick(PHONE_A), searchOff, () => pick("no lookup")],
          PHONE_A,
          1,
        ],
        [
          "with address search off, the controller's re-pick leaves it",
          [() => pick(PHONE_A), searchOff, controllerPickWithNoLookup],
          PHONE_A,
          1,
        ],
      ])("%s", async (description, steps, expected, inputEvents) => {
        let announced = 0;
        telephone().addEventListener("input", () => (announced += 1));

        for (const step of steps) await step();

        expect([telephone().value, announced, description]).toEqual([
          expected,
          inputEvents,
          description,
        ]);
      });

      test.each([
        [
          "a sole trader's address",
          () =>
            component.captureApplyBuyerAddress({
              city: "Ashford",
              postal_code: "TN23 1AA",
              street_address: "Mill Lane",
            }),
          "Ashford",
          "",
        ],
        [
          "a sole trader's phone",
          () => soleTrader("+44 7700 900000"),
          "",
          "+44 7700 900000",
        ],
      ])(
        "%s written while a pick's lookup is in flight is not overwritten by its reply",
        async (_label, verify, city, phone) => {
          component.selectItem({
            companyName: "Slow",
            companyId: "1",
            lookupId: "lookup-slow",
          });
          const slow = fetchStub.lastSearch();
          verify();

          slow.respondProxy({
            addresses: [{ city: "Oslo", phone_number: PHONE_A }],
          });
          await H.flushPromises();

          expect(document.querySelector('input[name="city"]').value).toBe(city);
          expect(telephone().value).toBe(phone);
        },
      );

      test("a reply to an earlier pick writes nothing over the latest", async () => {
        component.selectItem({
          companyName: "Slow",
          companyId: "1",
          lookupId: "lookup-slow",
        });
        const slow = fetchStub.lastSearch();
        component.selectItem({
          companyName: "Fast",
          companyId: "2",
          lookupId: "lookup-fast",
        });
        fetchStub.lastSearch().respondProxy({
          addresses: [{ city: "Bergen", phone_number: PHONE_B }],
        });
        await H.flushPromises();

        slow.respondProxy({ addresses: [{ city: "Oslo" }] });
        await H.flushPromises();

        expect(telephone().value).toBe(PHONE_B);
        expect(document.querySelector('input[name="city"]').value).toBe(
          "Bergen",
        );
      });

      /*
       * TWO-27212: every write is marked with what it wrote, and a retraction
       * takes the mark with it. `null` is no mark at all.
       */
      test.each([
        ["a registry phone", [() => pick(PHONE_A)], PHONE_A],
        ["a sole trader's phone", [() => soleTrader(PHONE_B)], PHONE_B],
        ["a retracted registry phone", [() => pick(PHONE_A), () => pick("")], null],
        ["a phone the buyer typed", [() => type("+44 typed"), () => pick("")], null],
      ])("%s carries the autofill mark it should", async (description, steps, expected) => {
        for (const step of steps) await step();

        expect([telephone().getAttribute(MARK), description]).toEqual([expected, description]);
      });

      /*
       * The edge case a Magewire morph opens (TWO-27212): the form is rebuilt
       * between two picks, so the first pick's token would sit on a node the
       * second pick never sees. Its late failure must still say nothing under
       * the second company, whose role the notice belongs to.
       */
      test("a pick's late failure says nothing after the form is rebuilt and the company re-picked", async () => {
        component.selectItem({ companyName: "Slow", companyId: "1", lookupId: "lookup-slow" });
        const slow = fetchStub.lastSearch();

        const old = document.getElementById("address-container");
        const rebuilt = old.cloneNode(true);
        rebuilt.querySelector("#company-root").replaceWith(root);
        old.replaceWith(rebuilt);
        component.selectItem({ companyName: "Next", companyId: "2", lookupId: "" });

        slow.respondProxy(null, false, 500);
        await H.flushPromises();

        expect(
          window.twoGatewayCompanyIdentity(component.captureRole()).addressNotice(),
        ).toBe("");
      });
    });

    describe("the address notice (TWO-27211)", () => {
      let picks = 0;

      /**
       * @param {string|number} reply as the registry-phone cases' pick(), or
       *   `"no lookup"` for a hit with no lookup id, which asks nothing
       */
      async function pick(reply) {
        picks += 1;
        component.selectItem({
          companyName: "Company " + picks,
          companyId: String(picks),
          lookupId: reply === "no lookup" ? "" : "lookup-" + picks,
        });
        if (reply === "no lookup") {
          await H.flushPromises();
          return;
        }
        const call = fetchStub.lastSearch();
        if (reply === "network") call.networkError();
        else if (typeof reply === "number")
          call.respondProxy(null, false, reply);
        else if (reply === "no address") call.respondProxy({ addresses: [] });
        else call.respondProxy({ addresses: [{ city: "Oslo" }] });
        await H.flushPromises();
      }

      /** What the role's identity holds for its controller to render. */
      function notice() {
        return window.twoGatewayCompanyIdentity(component.captureRole()).addressNotice();
      }

      test.each([
        ["an address arrives", ["address"], ""],
        ["the lookup has no address", ["no address"], H.ESCAPED_STRING],
        ["the lookup fails", [500], H.ESCAPED_STRING],
        ["the lookup is lost on the network", ["network"], H.ESCAPED_STRING],
        ["a later pick that fills the address withdraws it", [500, "address"], ""],
        ["a later pick with no lookup id withdraws it", [500, "no lookup"], ""],
      ])("%s", async (_description, replies, expected) => {
        for (const reply of replies) await pick(reply);

        expect(notice()).toBe(expected);
      });

      test("the controller's pick with no lookup id withdraws it too", async () => {
        await pick(500);
        expect(notice()).toBe(H.ESCAPED_STRING);

        component.captureAddressLookup({ text: "Next", companyId: "9", lookupId: "" });

        expect(notice()).toBe("");
      });

      /*
       * A pick with no lookup id retires the pending one: its late reply,
       * whatever it says, neither announces nor writes under the new company.
       */
      test.each([
        ["the engine's pick", "fails", 500],
        ["the engine's pick", "fills an address", "address"],
        ["the controller's pick", "fails", 500],
        ["the controller's pick", "fills an address", "address"],
      ])("%s with no lookup id drops a pending lookup that later %s", async (path, _outcome, reply) => {
        component.selectItem({ companyName: "Slow", companyId: "1", lookupId: "lookup-slow" });
        const slow = fetchStub.lastSearch();

        if (path === "the engine's pick") {
          component.selectItem({ companyName: "Next", companyId: "2", lookupId: "" });
        } else {
          component.captureAddressLookup({ text: "Next", companyId: "2", lookupId: "" });
        }
        if (reply === "address") {
          slow.respondProxy({ addresses: [{ city: "Oslo", phone_number: "+47 22 00 00 01" }] });
        } else {
          slow.respondProxy(null, false, reply);
        }
        await H.flushPromises();

        expect([
          notice(),
          document.querySelector('input[name="city"]').value,
          document.querySelector('input[name="telephone"]').value,
        ]).toEqual(["", "", ""]);
      });

      test("the notice is the guide's sentence, through the catalogue", () => {
        const template = fs.readFileSync(
          path.join(H.REPO_ROOT, H.GATEWAY_METHOD_TEMPLATE),
          "utf8",
        );
        expect(template).toContain(
          "addressUnavailableMessage: '<?= $escaper->escapeJs(__('We could not fetch this company\\'s address. Please enter it below.')) ?>'",
        );
      });
    });

    test("a company with no lookup id skips the detail request entirely", async () => {
      component.selectItem({
        companyName: "Acme Widgets",
        companyId: "111",
        lookupId: "",
      });

      expect(fetchStub.searchCalls()).toHaveLength(0);
    });
  });

  describe("manual entry", () => {
    test("entering manual mode persists it and abandons the vouched number", () => {
      capture().selectCompany({ text: "Acme Widgets", companyId: "111" });

      capture().manualEntryMode();

      expect(component.manualMode).toBe(true);
      // The registry number goes with the mode: nothing vouches for a company
      // the buyer is about to type by hand.
      expect(component.companyId).toBe("");
      expect(
        JSON.parse(env.browserStorage.getItem(H.COMPANY_SELECTION_KEY))
          .manual_mode,
      ).toBe(true);
    });

    test("going back to search persists that too", () => {
      capture().selectCompany({ text: "Acme Widgets", companyId: "111" });
      capture().manualEntryMode();

      capture().registeredMode();

      expect(component.manualMode).toBe(false);
      expect(
        JSON.parse(env.browserStorage.getItem(H.COMPANY_SELECTION_KEY))
          .manual_mode,
      ).toBe(false);
    });

    test("this surface owns no second manual-entry toggle", () => {
      // The route in and out is the panel's chips, driving the page-level
      // controller. The engine's own toggles are composed inert
      // (`manualModeSupported: false`), so a call to one decides nothing —
      // two live toggles over one identity is the duplication TWO-25503 removed.
      capture().manualEntryMode();

      component.enableSearch();

      expect(component.manualMode).toBe(true);
      expect(capture().identity().captureMode()).toBe("manual");
    });
  });

  describe("returning to search from manual entry", () => {
    test("does NOT re-run the manually-typed company name as a query", async () => {
      // The name field is a NAME, not a search box: replaying it would put the
      // buyer's hand-entered company name onto the wire as a registry query.
      capture().manualEntryMode();
      field.value = "Beta Holdings";
      component.onNameFieldInput();
      const before = fetchStub.searchCalls().length;

      capture().registeredMode();
      await H.flushPromises();

      expect(fetchStub.searchCalls()).toHaveLength(before);
      expect(field.value).toBe("Beta Holdings");
      expect(component.query).toBe("");
    });

    test("the picked NAME survives bouncing out to manual entry and back", async () => {
      // The number does not: manual entry abandons what vouched for it. The
      // name does, because the buyer is still buying as that company.
      capture().selectCompany({ text: "Gamma Trading", companyId: "333" });
      const before = fetchStub.searchCalls().length;

      capture().manualEntryMode();
      capture().registeredMode();
      await H.flushPromises();

      expect(fetchStub.searchCalls()).toHaveLength(before);
      expect(component.companyName).toBe("Gamma Trading");
      expect(component.items).toEqual([]);
    });

    test("resolves the company-name field, not the clicked control, when reached from a mode button", () => {
      // Alpine resolves `$el` PER EXPRESSION, so a method reached from a chip's
      // own handler sees the chip, not the input. With the resolver reduced to
      // `return this.$el`, the manual-entry commit records the button's
      // (absent) value as the captured company name.
      const button = document.createElement("button");
      button.type = "button";
      root.appendChild(button);
      field.value = "Delta Logistics";
      capture().manualEntryMode();
      field.value = "Delta Logistics";

      component.$el = button;

      expect(component.companyNameField()).toBe(field);

      component.onNameFieldInput();

      expect(component.search).toBe("Delta Logistics");
      expect(fetchStub.searchCalls()).toHaveLength(0);
    });

    test("never mistakes the company-number input for the search field", () => {
      // Both are `type="text"` inside one control root, so an unanchored
      // selector is correct only by document order. Put the number input FIRST
      // and the exclusion is the only thing left standing between the resolver
      // and publishing an organisation number as the company name.
      const number = document.createElement("input");
      number.type = "text";
      number.className =
        "company_id block w-full form-input grow renderer-text";
      number.value = "999999999";
      // First in the root's own order, not before the field: the popover has
      // wrapped the field by now, so the field is no longer a child of root.
      root.insertBefore(number, root.firstChild);
      field.value = "Epsilon Foods";

      component.$el = null;

      expect(component.companyNameField()).toBe(field);
    });

    test("does not disturb an intact registry pick whose field is not re-read", () => {
      // The field is empty on a freshly restored step while state holds the
      // stored company. Driving a search from that field would drop a registry
      // number nothing was wrong with and re-ask for it. Restored as a
      // registered capture: a record saying manual entry restores no number at
      // all (TWO-26775, pinned in manual-entry-restore.test.js).
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          company_name: "Acme Ltd",
          company_id: "111",
          company_id_source: "registry",
        }),
      );
      const restored = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: field,
        root: root,
      });
      restored.init();
      field.value = "";
      const before = fetchStub.searchCalls().length;

      capture().registeredMode();

      expect(fetchStub.searchCalls()).toHaveLength(before);
      expect(restored.companyId).toBe("111");
      expect(restored.companyIdSource).toBe("registry");
      expect(restored.hasVouchedCompanyId()).toBe(true);
    });
  });

  describe("a Magewire re-render mid-flight", () => {
    test("does not write results into a detached component", async () => {
      const started = await startSearch("example");
      expect(fetchStub.searchCalls().length).toBe(1);

      // Magewire's diff-merge replaces the address-form subtree: this
      // component's root leaves the document while its request is in flight.
      // The node has no `wire:ignore` — deliberately, it wraps a
      // Magewire-bound address field — so the guard is in the engine.
      root.remove();

      fetchStub
        .lastSearch()
        .respondProxy({ items: [{ name: "Example Trading Ltd" }] });
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

      fetchStub
        .lastSearch()
        .respondProxy({ items: [{ name: "Example Trading Ltd" }] });
      await started.pending;

      expect(component.items).toEqual([]);
      expect(component.isSearching).toBe(false);
      expect(component.searchAbortController).toBe(null);
    });

    test("a component still in the document is written to as normal", async () => {
      const started = await startSearch("example");

      fetchStub
        .lastSearch()
        .respondProxy({ items: [{ name: "Example Trading Ltd" }] });
      await started.pending;

      expect(component.items.length).toBe(1);
      expect(component.searchCompletedFor).toBe("example");
    });
  });

  describe("the highlighted row", () => {
    beforeEach(() => {
      component.items = [
        { companyName: "Acme Ltd", companyId: "1" },
        { companyName: "Beta Ltd", companyId: "2" },
        { companyName: "Gamma Ltd", companyId: "3" },
      ];
      component.selectedIndex = 1;
    });

    test.each([
      [(c) => c.selectItem(c.items[1]), "a pick"],
      [(c) => c.closeDropdown(), "the results going away"],
    ])("%#: resets the highlight (%s)", async (act) => {
      act(component);
      await H.flushPromises();

      expect(component.selectedIndex).toBe(-1);
    });

    test("a fresh query resets it before the request goes out", async () => {
      const { pending } = await startSearch("New search term");

      expect(component.selectedIndex).toBe(-1);

      fetchStub.lastSearch().respondProxy({ items: [] });
      await pending;
    });
  });

  describe("the company-name field's own markup", () => {
    /** @returns {HTMLInputElement} the one text input the control renders */
    function nameInput() {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const inputs = doc.querySelectorAll('input[type="text"]');
      expect(inputs).toHaveLength(1);
      return inputs[0];
    }

    test("carries no key or click bindings of its own", () => {
      // DOM ORDER IS THE DESIGN and the panel owns it: it binds mousedown,
      // focus, keydown and input natively, so a binding left here would give
      // two listeners racing for the same keys.
      const names = Array.from(nameInput().attributes).map((a) => a.name);

      expect(names.filter((n) => n.startsWith("@keydown"))).toEqual([]);
      expect(names.filter((n) => n.startsWith("@click"))).toEqual([]);
    });

    /**
     * Every Alpine binding the control renders, as `[label, attribute name]`.
     *
     * CSP-friendly Alpine looks the WHOLE attribute string up as a KEY, so a
     * binding naming something the component does not define paints nothing and
     * says nothing. The payment tile's own enumeration cannot reach these: the
     * harness substitutes one `x-data` value for both mount points, so the
     * control's subtree reads as a foreign scope there.
     *
     * @returns {Array<Array<string>>}
     */
    function controlBindings() {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const found = [];
      Array.from(doc.querySelectorAll("*")).forEach((element) => {
        Array.from(element.attributes).forEach((attr) => {
          const bound =
            attr.name.startsWith("x-show") ||
            attr.name.startsWith("x-text") ||
            attr.name.startsWith("@") ||
            attr.name.startsWith(":");
          if (!bound || attr.value === "") return;
          found.push([attr.name + '="' + attr.value + '"', attr.value]);
        });
      });
      expect(found.length).toBeGreaterThan(0);
      return found;
    }

    test.each(controlBindings())(
      "%s names a key the component defines",
      (_label, expression) => {
        expect(component[expression]).toBeDefined();
      },
    );

    test("keeps the debounced input binding manual entry commits through", () => {
      // Under Hyvä's CSP-friendly Alpine the attribute is a key lookup, so a
      // name the component does not define is a silently inert control.
      const input = nameInput();

      expect(input.getAttribute("@input.debounce.300ms")).toBe(
        "onNameFieldInput",
      );
      expect(typeof component.onNameFieldInput).toBe("function");
    });
  });
});
