/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * `ok` is read by identity, never for truthiness: the envelope crosses a JSON
 * boundary with more than one encoder behind it, and a truthy `"false"` would
 * render a failed call as "no companies matched" — which a buyer with a valid
 * company reads as "this shop will not take me".
 */

"use strict";

const H = require("./hyva-harness");

const REST_BASE = "https://shop.test.invalid";
const SEARCH_ROUTE = REST_BASE + "/rest/V1/two/company-search";

describe("proxy envelope strictness", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    H.loadSharedHelpers();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.restoreAllMocks();
  });

  describe("twoGatewayUnwrapProxyResponse()", () => {
    test.each([
      ["a real success", { ok: true, status: 200, body: { items: [] } }, true],
      ["a real failure", { ok: false, status: 502, body: null }, false],
      [
        'a stringified "false" — truthy, and the bug this guards',
        { ok: "false", status: 502, body: { items: [] } },
        false,
      ],
      [
        'a stringified "true" is still not the boolean',
        { ok: "true", status: 200, body: { items: [] } },
        false,
      ],
      [
        "a numeric 1 is not the boolean",
        { ok: 1, status: 200, body: {} },
        false,
      ],
      ["an absent ok is not a success", { status: 200, body: {} }, false],
    ])("%s", (description, envelope, expected) => {
      // Given a proxy envelope / When unwrapped / Then ok is identity-tested.
      expect(window.twoGatewayUnwrapProxyResponse(envelope).ok).toBe(expected);
      // Magento's webapi layer wraps a `: string` return in a one-element
      // array, so the same answer must survive that encoding too.
      expect(
        window.twoGatewayUnwrapProxyResponse([JSON.stringify(envelope)]).ok,
      ).toBe(expected);
    });
  });

  test("the engine defaults to the direct path when a caller omits the flag", () => {
    // Every real mount passes it, so this default only ever answers for a
    // caller that forgot — and the direct call it selects works on every base,
    // where proxying to a route that may not exist is a failed checkout.
    expect(window.twoGatewayCompanySearchEngine({}).isProxyAvailable).toBe(
      false,
    );
  });

  test('a search whose envelope says ok:"false" fails, and never renders as "no matches"', async () => {
    // Given a failed upstream call whose envelope carries a plausible body.
    const search = window.twoGatewayCompanySearch({
      useProxy: true,
      restBaseUrl: REST_BASE,
      countryCode: "GB",
      query: "Acme",
    });
    await H.flushPromises();

    fetchStub.calls[0].respond([
      JSON.stringify({ ok: "false", status: 502, body: { items: [] } }),
    ]);

    // Then the buyer is told it failed, not that their company does not exist.
    const result = await search;
    expect(result.status).toBe("failed");
  });

  test("a 404 on a route the capability check said exists is called out as a stale cache", async () => {
    // Given isProxyAvailable already ruled out "base too old", a 404 can only
    // mean Magento is serving a route cache older than the base's code.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const search = window.twoGatewayCompanySearch({
      useProxy: true,
      restBaseUrl: REST_BASE,
      countryCode: "GB",
      query: "Acme",
    });
    await H.flushPromises();

    fetchStub.calls[0].respondWithStatus(404);

    expect((await search).status).toBe("failed");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cache:flush"));
    expect(warn.mock.calls[0][0]).toContain(
      SEARCH_ROUTE.replace(REST_BASE, ""),
    );
  });

  describe("the one call that cannot be proxied", () => {
    test.each([
      [404, false, "no buyer on this cookie — the documented answer"],
      [403, true, "an appliance turning away a request with no token"],
      [500, true, "any other rejection"],
    ])("HTTP %i warns: %s", async (status, shouldWarn) => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

      const buyer = window.twoGatewayAutofillBuyer(
        "https://api.test.invalid",
        "delegated-token",
        "",
      );
      await H.flushPromises();
      fetchStub.calls[0].respondWithStatus(status);

      // Every rejection still resolves null — the caller's next step is signup
      // either way. What must differ is whether it went unremarked.
      expect(await buyer).toBeNull();
      expect(warn).toHaveBeenCalledTimes(shouldWarn ? 1 : 0);
    });
  });

  test("a non-404 proxy failure carries its status into the error", async () => {
    // The logged message is the only place a 503 is distinguishable from any
    // other failure.
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    const search = window.twoGatewayCompanySearch({
      useProxy: true,
      restBaseUrl: REST_BASE,
      countryCode: "GB",
      query: "Acme",
    });
    await H.flushPromises();

    fetchStub.calls[0].respondWithStatus(503);
    expect((await search).status).toBe("failed");

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][1])).toContain("503");
  });
});
