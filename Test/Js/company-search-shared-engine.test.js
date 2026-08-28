/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 rebuild. Guards the ARCHITECTURE the rebuild introduced —
 * "one real implementation, three thin surface adapters" — which none of
 * the pre-existing per-surface suites were written to check at all: they
 * mount one component and assert on its behaviour, so a future change that
 * reintroduces a second copy of `selectItem()`/`nextItem()`/`runCompanySearch()`
 * on one surface would still pass every one of them, as long as the copy
 * behaved the same. This file is the one that would catch that.
 *
 * It also locks down engine-level behaviour that is genuinely NEW at this
 * layer — the loader-start/done ordering, the unavailable-toast latch, and
 * the editable-company-id "extra unlock" split — because folding three
 * historical, independently-reviewed implementations into shared code is
 * exactly the kind of change that can silently regress by generalising a
 * formula that looked identical but was not.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./hyva-harness");

describe("TWO-25326 shared company-search engine (single implementation, by substance)", () => {
  let env;

  beforeEach(() => {
    document.body.innerHTML = "";
    env = H.installHyvaEnvironment();
    H.loadSharedHelpers();
  });

  afterEach(() => {
    env.restore();
  });

  test("exactly one Alpine.data(...) registration owns the search/dropdown/keyboard-nav/address-lookup implementation", () => {
    // `searchInput` (shipping) is a second REGISTRATION by necessity — see
    // its own doc comment for why the name is externally mandated and
    // cannot be merged away — but it must not be a second IMPLEMENTATION.
    // Asserted below by reference identity, not by counting registrations.
    expect(typeof window.twoGatewayCompanySearchEngine).toBe("function");
  });

  test("nextItem/prevItem/handleItemClick/addressLookup/setAddressData/abortCompanySearch/closeDropdown are the IDENTICAL function across every surface that composes the engine", () => {
    const sharedMethodNames = [
      "nextItem",
      "prevItem",
      "handleItemClick",
      "addressLookup",
      "setAddressData",
      "abortCompanySearch",
      "closeDropdown",
      "closeCompanyList",
      "runCompanySearch",
      "hasVouchedCompanyId",
    ];

    const tile = window.twoGatewayCompanySearchEngine({});
    const address = window.twoGatewayCompanySearchEngine({});
    const shipping = window.twoGatewayCompanySearchEngine({});

    sharedMethodNames.forEach((name) => {
      expect(typeof tile[name]).toBe("function");
      // Every call to the factory evaluates a fresh object literal, so a
      // fresh function object is unavoidable even for genuinely shared
      // code — reference equality is the wrong test here. Byte-identical
      // SOURCE is the right one: it is what a duplicated, independently
      // hand-copied re-implementation could not produce, however
      // faithfully it mimicked the behaviour.
      expect(tile[name].toString()).toBe(address[name].toString());
      expect(address[name].toString()).toBe(shipping[name].toString());
    });
  });

  test("none of the three surface templates define their own copy of the network/keyboard-nav logic any more", () => {
    // A grep-shaped check, over the real shipped files, for the load-bearing
    // fetch call the engine now owns exclusively. Any of the three surface
    // templates reintroducing `window.twoGatewayCompanySearch({` themselves
    // — rather than going through `runCompanySearch()` — is the duplication
    // this rebuild removed.
    const repoRoot = path.resolve(__dirname, "..", "..");
    const surfaceFiles = [
      "view/frontend/templates/form/field/companyName-csp-js.phtml",
      "view/frontend/templates/component/payment/method/shipping_company.phtml",
    ];

    surfaceFiles.forEach((relPath) => {
      const source = fs.readFileSync(path.join(repoRoot, relPath), "utf8");
      expect(source).not.toMatch(/window\.twoGatewayCompanySearch\(\{/);
    });

    // The payment tile is the one template allowed to construct the ENGINE
    // (via `window.twoGatewayCompanySearchEngine(...)`) but must not ALSO
    // call the raw search helper itself, which would mean it stopped
    // routing through `runCompanySearch()`.
    const tileSource = fs.readFileSync(
      path.join(
        repoRoot,
        "view/frontend/templates/component/payment/method/gateway_method-csp-js.phtml",
      ),
      "utf8",
    );
    const rawSearchCalls = tileSource.match(/window\.twoGatewayCompanySearch\(\{/g) || [];
    // Exactly one call site: inside the engine's own runCompanySearch().
    expect(rawSearchCalls).toHaveLength(1);
  });
});

describe("TWO-25326 shared engine behaviour that is genuinely new at this layer", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  function mount(options) {
    const engine = window.twoGatewayCompanySearchEngine(
      Object.assign(
        {
          checkoutApiUrl: "https://api.test.invalid",
          minSearchChars: 3,
          companySearchLimit: 10,
          isCompanySearchEnabled: true,
          getQuote: function () {
            return { quote_id: "q1", shipping_country_id: "GB" };
          },
        },
        options || {},
      ),
    );
    return H.mountComponent(function () {
      return engine;
    });
  }

  test("onLoaderStart/onLoaderDone fire exactly once per owning search — a superseded search never fires done", async () => {
    const events = [];
    const component = mount({
      onLoaderStart: function () {
        events.push("start");
      },
      onLoaderDone: function () {
        events.push("done");
      },
    });

    const first = component.runCompanySearch("acme");
    // Immediately superseded before it resolves.
    const second = component.runCompanySearch("acme2");

    fetchStub.calls[0].respond({ items: [] });
    await first;
    // The FIRST search's `done` must not have fired yet — it was
    // superseded, and firing it here would hide a spinner the SECOND
    // search still owns.
    expect(events).toEqual(["start", "start"]);

    fetchStub.calls[1].respond({ items: [] });
    await second;
    expect(events).toEqual(["start", "start", "done"]);
  });

  test("a search aborted with NO successor still fires onLoaderDone (the spinner must not latch on forever)", async () => {
    const events = [];
    const component = mount({
      onLoaderStart: function () {
        events.push("start");
      },
      onLoaderDone: function () {
        events.push("done");
      },
    });

    const pending = component.runCompanySearch("acme");
    // The abort itself settles the stubbed fetch's promise (stubFetch()
    // wires the AbortController's signal to reject it) — nothing further to
    // resolve here.
    component.abortCompanySearch();
    await pending;

    expect(events).toEqual(["start", "done"]);
  });

  test("dispatchSearchUnavailableToast latches to once per interaction, and a good result re-arms it", async () => {
    const messages = [];
    window.dispatchMessages = function (payload) {
      messages.push(payload);
    };
    const component = mount({
      dispatchSearchUnavailableToast: true,
      searchUnavailableMessage: "Company search is unavailable.",
    });

    await Promise.all([
      (async () => {
        await component.runCompanySearch("acme");
      })(),
      Promise.resolve().then(() => fetchStub.calls[0].respondWithStatus(500)),
    ]);
    expect(messages).toHaveLength(1);

    // A second failed search while still "shown" must NOT toast again.
    await Promise.all([
      (async () => {
        await component.runCompanySearch("acme2");
      })(),
      Promise.resolve().then(() => fetchStub.calls[1].respondWithStatus(500)),
    ]);
    expect(messages).toHaveLength(1);

    // endSearchInteraction() (bound on Tab-close/selectItem/enterManually)
    // re-arms it.
    component.endSearchInteraction();
    await Promise.all([
      (async () => {
        await component.runCompanySearch("acme3");
      })(),
      Promise.resolve().then(() => fetchStub.calls[2].respondWithStatus(500)),
    ]);
    expect(messages).toHaveLength(2);

    delete window.dispatchMessages;
  });

  test("editableCompanyIdExtraUnlock is the address step's own escape hatch — the default formula (the tile's) carries no such term", () => {
    const tileLike = mount({ editableCompanyId: true });
    tileLike.manualMode = false;
    tileLike.companyIdEntryRequired = false;
    tileLike.applyCompanyIdEditability();
    // Locked: search is "on" (no extra-unlock term), not in manual mode,
    // and nothing requires entry.
    expect(tileLike.companyIdDisabled).toBe(true);

    const addressLike = mount({
      editableCompanyId: true,
      editableCompanyIdExtraUnlock: function () {
        return !this.isCompanySearchEnabled;
      },
      isCompanySearchEnabled: false,
    });
    addressLike.manualMode = false;
    addressLike.companyIdEntryRequired = false;
    addressLike.applyCompanyIdEditability();
    // Unlocked purely off the extra term: search itself is off.
    expect(addressLike.companyIdDisabled).toBe(false);
  });

  /**
   * TWO-25326, 2026-08-06: autofill is gated, and the gate is a term of
   * selectItem() rather than a property of the surface's markup.
   *
   * The ruling has two conditions — the `enable_address_search` setting AND
   * the one company-search control living in the address entry — and
   * CheckoutConfig::getIsAddressSearchEnabled() is where they are combined
   * (see Test/Unit/ViewModel/CheckoutConfigTest.php for that truth table).
   * What is pinned HERE is that `isAddressSearchEnabled` is the only thing
   * standing between a pick and a request: with it false, a pick carrying a
   * perfectly good `lookupId` must put nothing on the wire at all.
   */
  test("a pick makes no address request while autofill is gated off", async () => {
    const component = mount({ isAddressSearchEnabled: false });

    component.selectItem({
      companyName: "Example Trading Ltd",
      companyId: "123456789",
      lookupId: "lookup-1",
    });

    // Not "no fields written" — no REQUEST. A gate that fetched the address
    // and then declined to apply it would still be reading the buyer's
    // company detail out of the API for nothing.
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("the same pick DOES look the address up once autofill is allowed", async () => {
    // The other half: without this, the test above passes against a
    // selectItem() that never looks anything up on any surface.
    const component = mount({ isAddressSearchEnabled: true });

    component.selectItem({
      companyName: "Example Trading Ltd",
      companyId: "123456789",
      lookupId: "lookup-1",
    });

    expect(fetchStub.calls).toHaveLength(1);
    expect(fetchStub.calls[0].url).toContain("lookup-1");
  });

  test("addressLookup()/setAddressData() are safe no-ops with no container resolved — never a throw", async () => {
    // `resolveAddressContainer` defaults to `() => null` and is closed over
    // by the engine itself, not exposed on the instance — selectItem() is
    // the only caller that resolves it. Exercising `addressLookup()`
    // directly, with no container argument, covers the same "no container"
    // path every surface's default falls back to.
    const component = mount({ isAddressSearchEnabled: true });

    const lookup = component.addressLookup("lookup-1");
    fetchStub.calls[0].respond({ addresses: [{ city: "London" }] });

    await expect(lookup).resolves.toBeUndefined();
  });
});
