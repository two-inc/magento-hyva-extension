/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * `ok` is read by identity: a truthy `"false"` out of one of the encoders behind
 * this JSON boundary would render a failed call as "no companies matched".
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
      // Magento's webapi layer wraps a `: string` return in a one-element array.
      expect(
        window.twoGatewayUnwrapProxyResponse([JSON.stringify(envelope)]).ok,
      ).toBe(expected);
    });
  });

  test("the engine defaults to the direct path when a caller omits the flag", () => {
    // The direct call works on every base; proxying to an absent route is a failed checkout.
    expect(window.twoGatewayCompanySearchEngine({}).isProxyAvailable).toBe(
      false,
    );
  });

  test('a search whose envelope says ok:"false" fails, and never renders as "no matches"', async () => {
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

    const result = await search;
    expect(result.status).toBe("failed");
  });

  test("a 404 on a route the capability check said exists is called out as a stale cache", async () => {
    // isProxyAvailable already ruled out "base too old", so a 404 can only be a stale route cache.
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
    ])("HTTP %i (warns: %s) — %s", async (status, shouldWarn) => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

      const buyer = window.twoGatewayAutofillBuyer(
        "https://api.test.invalid",
        "delegated-token",
        "",
      );
      await H.flushPromises();
      fetchStub.calls[0].respondWithStatus(status);

      // Every rejection resolves null; what differs is whether it went unremarked.
      expect(await buyer).toBeNull();
      expect(warn).toHaveBeenCalledTimes(shouldWarn ? 1 : 0);
    });
  });

  test("a non-404 HTTP-level proxy failure carries its HTTP status into the error", async () => {
    // The logged message is the only place a 503 is distinguishable.
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

  test("an HTTP-200 envelope that itself says ok:false relays the ENVELOPE's status, not the HTTP one", async () => {
    // HTTP 200 the whole way — only the envelope body says the upstream call failed.
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    const search = window.twoGatewayCompanySearch({
      useProxy: true,
      restBaseUrl: REST_BASE,
      countryCode: "GB",
      query: "Acme",
    });
    await H.flushPromises();

    fetchStub.calls[0].respondProxy({ items: [] }, false, 503);
    expect((await search).status).toBe("failed");

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][1])).toContain("503");
  });
});
