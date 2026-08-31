/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The `searchInput` company picker from shipping_company.phtml, and above all
 * its `magewire:loader` bookkeeping.
 *
 * The magewire loader is a full-screen overlay driven by a BOOLEAN, not a
 * counter, so two rules have to hold simultaneously and they pull in opposite
 * directions:
 *
 *   - a SUPERSEDED search must not dispatch `done`, or it hides the overlay
 *     while its replacement is still running;
 *   - a search aborted with NO successor MUST dispatch `done`, or the overlay
 *     latches on forever and the buyer cannot check out.
 *
 * A review round found the second rule broken: typing three characters and then
 * backspacing left the overlay up permanently. Every dismissal path is that
 * same case — backspace below three characters, tab out, pick a result, clear
 * the country, a DOM-morph disconnect — so each one gets a test here.
 */

"use strict";

const H = require("./hyva-harness");

describe("shipping-company picker", () => {
  let env;
  let fetchStub;
  let component;
  let field;

  beforeEach(() => {
    document.body.innerHTML = [
      "<form>",
      '  <input type="hidden" id="shipping-company_id" value="" />',
      '  <input type="hidden" id="shipping-company" value="" />',
      '  <input type="text" id="company-search" value="" />',
      '  <input name="city" value="" />',
      '  <input name="postcode" value="" />',
      '  <input name="street[0]" value="" />',
      "</form>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
    env.fireAlpineInit();

    field = document.getElementById("company-search");
    component = H.mountComponent(env.alpineComponents.searchInput, {
      el: field,
    });
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
   * Start a search for `term` and wait until it is on the wire.
   *
   * The still-pending `getItems()` promise comes back WRAPPED deliberately:
   * returning it bare from an async function would make `await startSearch()`
   * adopt it, so the caller would block until the request it has not settled
   * yet completes.
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

  /**
   * Is the overlay up? `start` shows it, `done` hides it; the last event wins
   * because it is a boolean, not a counter.
   *
   * @returns {boolean}
   */
  function overlayIsUp() {
    return env.loaderEvents[env.loaderEvents.length - 1] === "start";
  }

  test("the picker registers itself with Alpine", () => {
    expect(typeof env.alpineComponents.searchInput).toBe("function");
    // It is also hung off window, which is how the branded overlay's fork
    // of the markup reaches it.
    expect(typeof window.searchInput).toBe("function");
  });

  test("a successful search shows the overlay and takes it back down", async () => {
    const { pending } = await startSearch("acme");
    expect(env.loaderEvents).toEqual(["start"]);

    fetchStub.last().respondProxy({ items: [apiItem("Acme Widgets", "111")] });
    await pending;

    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(overlayIsUp()).toBe(false);
    expect(component.items).toHaveLength(1);
    expect(component.isOpen).toBe(true);
    expect(component.isSearching).toBe(false);
  });

  test("typing three characters then backspacing releases the overlay", async () => {
    // The exact regression: three chars dispatches start, the backspace
    // takes the search below the minimum and aborts it, and the aborted
    // search has no successor — so it owes a `done`.
    const { pending } = await startSearch("acme");
    expect(env.loaderEvents).toEqual(["start"]);

    field.value = "ac";
    const shortened = component.getItems();
    await Promise.all([pending, shortened]);

    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(overlayIsUp()).toBe(false);
    expect(component.items).toEqual([]);
    expect(component.isSearching).toBe(false);
  });

  test("a search under three characters never raises the overlay at all", async () => {
    field.value = "ac";
    await component.getItems();

    expect(env.loaderEvents).toEqual([]);
    expect(fetchStub.calls).toHaveLength(0);
  });

  test("a superseded search does not hide the overlay under its replacement", async () => {
    const { pending: first } = await startSearch("acm");
    const { pending: second } = await startSearch("acme");

    // Two starts, no done: the first search was aborted but its successor
    // owns the overlay now. Dispatching done here is the opposite bug —
    // start(A), abort(A), start(B), done(A) — and would clear the overlay
    // while B is still on the wire.
    expect(env.loaderEvents).toEqual(["start", "start"]);
    expect(overlayIsUp()).toBe(true);
    expect(fetchStub.calls).toHaveLength(2);

    fetchStub.last().respondProxy({ items: [apiItem("Acme Widgets", "111")] });
    await Promise.all([first, second]);

    expect(env.loaderEvents).toEqual(["start", "start", "done"]);
    expect(overlayIsUp()).toBe(false);
  });

  test("a stale response cannot repopulate the dropdown under a newer search", async () => {
    const { pending: first } = await startSearch("acm");
    const staleRequest = fetchStub.last();
    const { pending: second } = await startSearch("acme");

    staleRequest.respondProxy({ items: [apiItem("Stale Result", "999")] });
    await first;
    fetchStub.last().respondProxy({ items: [apiItem("Acme Widgets", "111")] });
    await second;

    expect(component.items).toHaveLength(1);
    expect(component.items[0].companyId).toBe("111");
  });

  test("picking a result releases the overlay held by the in-flight search", async () => {
    const { pending } = await startSearch("acme");

    component.selectItem({
      companyName: "Acme Widgets",
      companyId: "111",
      lookupId: "lookup-111",
    });
    // The address lookup selectItem() kicks off is a separate request; fail
    // it so this test stays about the loader.
    fetchStub.last().respondWithStatus(500);
    await Promise.all([pending, H.flushPromises()]);

    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(overlayIsUp()).toBe(false);
    expect(document.getElementById("shipping-company").value).toBe(
      "Acme Widgets",
    );
    expect(document.getElementById("shipping-company_id").value).toBe("111");
  });

  test("tabbing out of the field releases the overlay", async () => {
    const { pending } = await startSearch("acme");

    component.closeCompanyList({ key: "Tab" });
    await pending;

    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(component.isOpen).toBe(false);
    expect(component.items).toEqual([]);
  });

  test("a DOM-morph disconnect releases the overlay and writes nothing", async () => {
    const { pending } = await startSearch("acme");

    field.remove();
    fetchStub.last().respondProxy({ items: [apiItem("Acme Widgets", "111")] });
    await pending;

    // The response arrives for a detached instance: the overlay still has
    // to come down, but nothing may be written to the dead component.
    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(component.items).toEqual([]);
    expect(component.isOpen).toBe(false);
    expect(component.isSearching).toBe(false);
  });

  test("clearing the country mid-flight releases the overlay and drops the response", async () => {
    const { pending } = await startSearch("acme");

    component.quote = "{}";
    field.value = "acme";
    const afterClear = component.getItems();
    await Promise.all([pending, afterClear]);

    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(component.items).toEqual([]);
    // The buyer is told what to do about it, once.
    expect(env.messages).toHaveLength(1);
    expect(component.countrySelectionShown).toBe(true);
  });

  test("a timeout releases the overlay too", async () => {
    jest.useFakeTimers();
    const { pending } = await startSearch("acme");

    jest.advanceTimersByTime(30000);
    await pending;

    // A timeout is not a caller abort: the search fails, it is not
    // superseded, and it still owns the overlay it raised.
    expect(env.loaderEvents).toEqual(["start", "done"]);
    expect(component.isSearchUnavailable).toBe(true);
  });

  describe('failure is not reported as "no companies found"', () => {
    test("a failed search flags unavailable and warns the buyer once", async () => {
      const { pending } = await startSearch("acme");
      fetchStub.last().respondWithStatus(503);
      await pending;

      expect(component.isSearchUnavailable).toBe(true);
      expect(component.items).toEqual([]);
      expect(env.messages).toHaveLength(1);
      expect(env.messages[0][0].type).toBe("warning");

      // Latched: the field is debounced per keystroke, so a down API
      // would otherwise toast on every one.
      const { pending: again } = await startSearch("acmex");
      fetchStub.last().respondWithStatus(503);
      await again;

      expect(env.messages).toHaveLength(1);
      expect(env.loaderEvents).toEqual(["start", "done", "start", "done"]);
    });

    test("the warning can fire again after the interaction ends", async () => {
      const { pending } = await startSearch("acme");
      fetchStub.last().respondWithStatus(503);
      await pending;
      expect(env.messages).toHaveLength(1);

      // Backspacing below the minimum ends the interaction — without the
      // reset the buyer gets one toast per page load and then an inert
      // field for the rest of the session.
      field.value = "ac";
      await component.getItems();

      const { pending: retry } = await startSearch("acme2");
      fetchStub.last().respondWithStatus(503);
      await retry;

      expect(env.messages).toHaveLength(2);
    });

    test("a degraded 200 is flagged as unavailable, not as an empty result", async () => {
      const { pending } = await startSearch("acme");
      fetchStub.last().respondProxy({ degraded: true, items: [] });
      await pending;

      expect(component.isSearchUnavailable).toBe(true);
      expect(env.messages).toHaveLength(1);
      expect(env.loaderEvents).toEqual(["start", "done"]);
    });

    test("a genuine zero-result search is NOT flagged unavailable", async () => {
      const { pending } = await startSearch("acme");
      fetchStub.last().respondProxy({ items: [] });
      await pending;

      expect(component.isSearchUnavailable).toBe(false);
      expect(component.isOpen).toBe(false);
      expect(env.messages).toEqual([]);
    });

    test("a missing search helper fails visibly rather than as a rejection", async () => {
      delete window.twoGatewayCompanySearch;

      field.value = "acme";
      await component.getItems();

      // Structural failure: the overlay still has to come down and the
      // buyer still has to be told, or this reads as an inert field.
      expect(env.loaderEvents).toEqual(["start", "done"]);
      expect(component.isSearchUnavailable).toBe(true);
      expect(env.messages).toHaveLength(1);
    });
  });

  test("selecting a company fills the shipping address from the detail record", async () => {
    component.selectItem({
      companyName: "Acme Widgets",
      companyId: "111",
      lookupId: "lookup-111",
    });

    expect(fetchStub.last().url).toContain("/rest/V1/two/company");
    expect(fetchStub.last().jsonBody()).toEqual({ lookupId: "lookup-111" });
    fetchStub.last().respondProxy({
      addresses: [
        { city: "Oslo", postal_code: "0150", street_address: "1 Example Road" },
      ],
    });
    await H.flushPromises();

    expect(document.querySelector('input[name="city"]').value).toBe("Oslo");
    expect(document.querySelector('input[name="postcode"]').value).toBe("0150");
    expect(document.querySelector('input[name="street[0]"]').value).toBe(
      "1 Example Road",
    );
  });

  test("a failed detail lookup leaves the address fields alone", async () => {
    document.querySelector('input[name="city"]').value = "Typed by the buyer";

    component.selectItem({
      companyName: "Acme Widgets",
      companyId: "111",
      lookupId: "lookup-111",
    });
    fetchStub.last().respondWithStatus(500);
    await H.flushPromises();

    expect(document.querySelector('input[name="city"]').value).toBe(
      "Typed by the buyer",
    );
  });
});
