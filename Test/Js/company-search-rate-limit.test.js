/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-27211: a 429 from company search parks the surface that earned it
 * until the retry window ends: it says search is unavailable and asks the
 * registry nothing on the next keystroke. The window is the answer's
 * Retry-After, else the base's per-minute window. Other failures park nothing,
 * and another surface keeps searching.
 */

"use strict";

const H = require("./hyva-harness");

describe("company search: a 429 parks the calling surface", () => {
  let env;
  let fetchStub;
  let now;

  beforeEach(() => {
    document.body.innerHTML = "";
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    H.loadSharedHelpers();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  function mount() {
    const engine = window.twoGatewayCompanySearchEngine({
      checkoutApiUrl: "https://api.test.invalid",
      restBaseUrl: "https://shop.test.invalid",
      isProxyAvailable: true,
      minSearchChars: 3,
      isCompanySearchEnabled: true,
      getQuote: function () {
        return { quote_id: "q1", shipping_country_id: "GB" };
      },
    });
    return H.mountComponent(function () {
      return engine;
    });
  }

  /** Run one search, answering its request (if it makes one) with `answer`. */
  async function search(component, term, answer) {
    const before = fetchStub.calls.length;
    const pending = component.runCompanySearch(term);
    await Promise.resolve();
    const asked = fetchStub.calls.length > before;
    if (asked) answer(fetchStub.calls[fetchStub.calls.length - 1]);
    await pending;
    return asked;
  }

  const ok = (call) => call.respondProxy({ items: [] });

  it.each([
    {
      answer: (call) => call.respondWithStatus(429),
      stillParkedAt: 59_000,
      freeAt: 60_001,
      description: "a 429 from the store's rate limit, with no Retry-After, parks for its minute",
    },
    {
      answer: (call) => call.respond({ message: "Too many requests" }, 429, { "Retry-After": "5" }),
      stillParkedAt: 4_000,
      freeAt: 5_001,
      description: "a Retry-After in seconds sets the window",
    },
    {
      answer: (call) => call.respondProxy(null, false, 429),
      stillParkedAt: 59_000,
      freeAt: 60_001,
      description: "an upstream 429 inside the envelope parks the same way",
    },
  ])("$description", async ({ answer, stillParkedAt, freeAt }) => {
    const component = mount();

    expect(await search(component, "acme", answer)).toBe(true);
    expect(component.isSearchUnavailable).toBe(true);

    now += stillParkedAt;
    expect(await search(component, "acmes", ok)).toBe(false);
    expect(component.isSearchUnavailable).toBe(true);

    now += freeAt - stillParkedAt;
    expect(await search(component, "acmes", ok)).toBe(true);
    expect(component.isSearchUnavailable).toBe(false);
  });

  it("any other failure parks nothing", async () => {
    const component = mount();

    expect(await search(component, "acme", (call) => call.respondWithStatus(500))).toBe(true);
    expect(component.isSearchUnavailable).toBe(true);
    expect(await search(component, "acmes", ok)).toBe(true);
  });

  it("parks only the surface that earned it", async () => {
    const parked = mount();
    const other = mount();

    await search(parked, "acme", (call) => call.respondWithStatus(429));

    expect(await search(other, "acme", ok)).toBe(true);
    expect(await search(parked, "acme", ok)).toBe(false);
  });
});
