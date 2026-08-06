/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The shared company-search helpers published by
 * gateway_method-csp-js.phtml onto `window`, which all three Hyvä company
 * pickers call.
 *
 * The invariant the whole file is built around: the helper returns a
 * DISCRIMINATED result and never throws. Collapsing its five outcomes into
 * `items = []` is the defect it exists to prevent, because an empty dropdown is
 * pixel-identical to "no companies matched" — which is how a buyer with a
 * perfectly valid company concludes the shop will not take them.
 */

"use strict";

const H = require("./hyva-harness");

describe("shared company-search helpers", () => {
  let env;
  let fetchStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    // The failure paths log; asserting on the log is not the point, but
    // letting it spray through the test output is not either.
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * @param {Object} [overrides]
   * @returns {Object} options for window.twoGatewayCompanySearch
   */
  function searchOptions(overrides) {
    return Object.assign(
      {
        checkoutApiUrl: "https://checkout-api.test.invalid",
        countryCode: "gb",
        query: "acme",
        limit: 10,
      },
      overrides || {},
    );
  }

  /**
   * One search result in the shape the API returns.
   *
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

  describe("request envelope", () => {
    test("the timeout is 30s and sits outside the API retry envelope", () => {
      // stop_after_delay(10) is the checkout API's own retry window. A
      // client ceiling inside it would abandon requests the server is
      // still legitimately retrying.
      expect(window.TWO_GATEWAY_COMPANY_SEARCH_TIMEOUT_MS).toBe(30000);
      expect(window.TWO_GATEWAY_COMPANY_SEARCH_TIMEOUT_MS).toBeGreaterThan(
        10000,
      );
    });

    // Each of these settles its request before finishing. An unsettled search
    // leaves a live 30s timer armed behind the test, which is both a leak and a
    // reason for jest to complain about a worker that would not exit.
    test("the query string carries an upper-cased country, limit, offset and q", async () => {
      const promise = window.twoGatewayCompanySearch(
        searchOptions({ countryCode: "no", query: "a b" }),
      );

      const url = new URL(fetchStub.last().url);
      expect(url.pathname).toBe("/companies/v2/company");
      expect(url.searchParams.get("country")).toBe("NO");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.get("offset")).toBe("0");
      expect(url.searchParams.get("q")).toBe("a b");

      fetchStub.last().respond({ items: [] });
      await promise;
    });

    test('an absent country code degrades to an empty parameter, not "undefined"', async () => {
      const promise = window.twoGatewayCompanySearch(
        searchOptions({ countryCode: undefined }),
      );

      expect(new URL(fetchStub.last().url).searchParams.get("country")).toBe(
        "",
      );

      fetchStub.last().respond({ items: [] });
      await promise;
    });
  });

  describe("outcomes", () => {
    test("results are mapped and reported as ok", async () => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });

      const result = await promise;

      expect(result.status).toBe("ok");
      expect(result.items).toEqual([
        {
          companyName: "Acme Widgets",
          companyDisplayName: "<em>Acme Widgets</em> (111)",
          companyId: "111",
          lookupId: "lookup-111",
          item: apiItem("Acme Widgets", "111"),
        },
      ]);
    });

    // `national_identifier` is OPTIONAL in the search response — the company
    // may have none in its home registry, internal identifier types are
    // stripped from the field, and the field inside it is `id`, not `value`.
    // So all four of these shapes are reachable on a legitimate hit. Reading
    // it unguarded threw a TypeError inside the dropdown's own query
    // pipeline, which took the whole result list down and left the field on
    // "Searching…" — hence a rendered company rather than a throw, and rather
    // than a dropped hit the buyer could no longer select at all.
    describe.each([
      ["national_identifier absent", {}],
      ["national_identifier null", { national_identifier: null }],
      ["id null", { national_identifier: { id: null } }],
      ["id empty", { national_identifier: { id: "" } }],
    ])("a hit with %s", (_label, missing) => {
      /** @returns {Object} an api item with the identifier shape under test */
      function unusableItem() {
        return Object.assign(
          {
            name: "Example Trading Ltd",
            highlight: "<em>Example</em> Trading Ltd",
            lookup_id: "lookup-1",
          },
          missing,
        );
      }

      test("is reported ok, with no identifier suffix and an empty id", async () => {
        const item = unusableItem();
        const promise = window.twoGatewayCompanySearch(searchOptions());
        fetchStub.last().respond({ items: [item] });

        const result = await promise;

        expect(result.status).toBe("ok");
        expect(result.items).toEqual([
          {
            companyName: "Example Trading Ltd",
            companyDisplayName: "<em>Example</em> Trading Ltd",
            companyId: "",
            lookupId: "lookup-1",
            item: item,
          },
        ]);
      });

      test("does not take the rest of the result list down with it", async () => {
        // The whole point of the guard: one hit with no identifier must not
        // cost the buyer every other company that matched.
        const promise = window.twoGatewayCompanySearch(searchOptions());
        fetchStub.last().respond({
          items: [unusableItem(), apiItem("Other Example Ltd", "222")],
        });

        const result = await promise;

        expect(result.status).toBe("ok");
        expect(result.items.map((i) => i.companyName)).toEqual([
          "Example Trading Ltd",
          "Other Example Ltd",
        ]);
        expect(result.items.map((i) => i.companyId)).toEqual(["", "222"]);
      });
    });

    test("a numeric identifier is carried as a string", async () => {
      // `companyId` is written into an input's `.value` and `.trim()`ed by
      // the order-intent guard, so a number arriving from the API has to be
      // coerced here rather than at each of those call sites.
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({
        items: [
          {
            name: "Example Trading Ltd",
            highlight: "<em>Example</em> Trading Ltd",
            national_identifier: { id: 12345678 },
          },
        ],
      });

      const result = await promise;

      expect(result.items[0].companyId).toBe("12345678");
      expect(result.items[0].companyDisplayName).toBe(
        "<em>Example</em> Trading Ltd (12345678)",
      );
    });

    test("an identifier of 0 is a value, not an absence", async () => {
      // The predicate is `id != null`, not truthiness. A truthiness test read
      // `id: 0` as "no identifier" and dropped it, which would hand the buyer
      // an empty company-number field to retype an identifier the registry had
      // already answered with.
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({
        items: [
          {
            name: "Example Trading Ltd",
            highlight: "<em>Example</em> Trading Ltd",
            national_identifier: { id: 0 },
          },
        ],
      });

      const result = await promise;

      expect(result.items[0].companyId).toBe("0");
      expect(result.items[0].companyDisplayName).toBe(
        "<em>Example</em> Trading Ltd (0)",
      );
    });

    test("a genuine zero-result answer is empty, not failed", async () => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ items: [] });

      expect((await promise).status).toBe("empty");
    });

    test("a body with no items array at all is empty rather than a throw", async () => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({});

      const result = await promise;

      expect(result.status).toBe("empty");
      expect(result.items).toEqual([]);
    });

    test("a non-2xx is failed, never empty", async () => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respondWithStatus(503);

      const result = await promise;

      expect(result.status).toBe("failed");
      expect(result.items).toEqual([]);
    });

    test("a network error is failed", async () => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().networkError();

      expect((await promise).status).toBe("failed");
    });
  });

  describe("degraded responses", () => {
    test("degraded === true renders the results AND flags them", async () => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub
        .last()
        .respond({ degraded: true, items: [apiItem("Acme Widgets", "111")] });

      const result = await promise;

      // Not 'failed': there ARE results, they are just known-partial.
      expect(result.status).toBe("degraded");
      expect(result.items).toHaveLength(1);
    });

    test("a degraded answer is never cached", async () => {
      const first = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ degraded: true, items: [] });
      await first;

      const second = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });

      // Caching it would pin the buyer to a transient upstream failure
      // for the rest of the session.
      expect(fetchStub.calls).toHaveLength(2);
      expect((await second).status).toBe("ok");
    });

    test.each([
      ["absent", {}],
      ["false", { degraded: false }],
      ['the string "true"', { degraded: "true" }],
      ["1", { degraded: 1 }],
    ])("%s reads as not degraded", async (_label, body) => {
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub
        .last()
        .respond(
          Object.assign({ items: [apiItem("Acme Widgets", "111")] }, body),
        );

      // The strict === true check is deliberate: the field may not be
      // deployed yet, so anything other than a literal true has to mean
      // "healthy" or today's responses would all read as degraded.
      expect((await promise).status).toBe("ok");
    });

    test("twoGatewayIsDegradedResponse survives a null response", () => {
      expect(window.twoGatewayIsDegradedResponse(null)).toBe(false);
      expect(window.twoGatewayIsDegradedResponse(undefined)).toBe(false);
      expect(window.twoGatewayIsDegradedResponse({})).toBe(false);
      expect(window.twoGatewayIsDegradedResponse({ degraded: true })).toBe(
        true,
      );
    });
  });

  describe("abort versus timeout — the distinction the buyer sees", () => {
    test("a caller abort before the call issues no request at all", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await window.twoGatewayCompanySearch(
        searchOptions({ signal: controller.signal }),
      );

      expect(result.status).toBe("aborted");
      expect(fetchStub.calls).toHaveLength(0);
    });

    test("a caller abort mid-flight is silent", async () => {
      const controller = new AbortController();
      const promise = window.twoGatewayCompanySearch(
        searchOptions({ signal: controller.signal }),
      );
      controller.abort();

      const result = await promise;

      // Silent by design: this is the buyer typing on, or a teardown.
      expect(result.status).toBe("aborted");
      expect(result.items).toEqual([]);
    });

    test("a timeout is reported as failed, NOT as an abort", async () => {
      jest.useFakeTimers();
      const controller = new AbortController();
      const promise = window.twoGatewayCompanySearch(
        searchOptions({ signal: controller.signal }),
      );

      jest.advanceTimersByTime(29999);
      await H.flushPromises();
      expect(fetchStub.last().settled).toBe(false);

      jest.advanceTimersByTime(1);
      const result = await promise;

      // Both arrive as an AbortError, so the helper asks the CALLER's
      // signal rather than inspecting the error. Reporting this as
      // 'aborted' would leave the buyer looking at an inert field.
      expect(controller.signal.aborted).toBe(false);
      expect(result.status).toBe("failed");
    });

    test("the timeout timer is cleared once a search settles", async () => {
      jest.useFakeTimers();
      const promise = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ items: [] });
      await promise;

      // A leaked timer would abort a controller nobody is listening to
      // 30s after every single keystroke.
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("the result cache", () => {
    test("an identical search is served from cache", async () => {
      const first = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });
      await first;

      const second = await window.twoGatewayCompanySearch(searchOptions());

      expect(fetchStub.calls).toHaveLength(1);
      expect(second.status).toBe("ok");
      expect(second.items[0].companyId).toBe("111");
    });

    test("a cached empty answer still reads as empty, not ok", async () => {
      const first = window.twoGatewayCompanySearch(searchOptions());
      fetchStub.last().respond({ items: [] });
      await first;

      expect(
        (await window.twoGatewayCompanySearch(searchOptions())).status,
      ).toBe("empty");
    });

    test("the country is part of the key, so two countries never share results", async () => {
      const first = window.twoGatewayCompanySearch(
        searchOptions({ countryCode: "GB" }),
      );
      fetchStub.last().respond({ items: [apiItem("Acme Widgets", "111")] });
      await first;

      const second = window.twoGatewayCompanySearch(
        searchOptions({ countryCode: "NO" }),
      );
      expect(fetchStub.calls).toHaveLength(2);
      fetchStub.last().respond({ items: [apiItem("Acme Norge", "222")] });

      expect((await second).items[0].companyId).toBe("222");
    });

    test("the cache evicts oldest-first at fifty entries", async () => {
      for (let i = 0; i < 50; i += 1) {
        const promise = window.twoGatewayCompanySearch(
          searchOptions({ query: "q" + i }),
        );
        fetchStub.last().respond({ items: [apiItem("Acme " + i, String(i))] });
        await promise;
      }
      expect(window.twoGatewayCompanySearchCache.size).toBe(50);

      const overflow = window.twoGatewayCompanySearch(
        searchOptions({ query: "q50" }),
      );
      fetchStub.last().respond({ items: [apiItem("Acme 50", "50")] });
      await overflow;

      expect(window.twoGatewayCompanySearchCache.size).toBe(50);
      // q0 was the oldest, so it has to go back to the network; q1 must not.
      const callsBefore = fetchStub.calls.length;
      await window.twoGatewayCompanySearch(searchOptions({ query: "q1" }));
      expect(fetchStub.calls).toHaveLength(callsBefore);

      const evicted = window.twoGatewayCompanySearch(
        searchOptions({ query: "q0" }),
      );
      expect(fetchStub.calls).toHaveLength(callsBefore + 1);
      fetchStub.last().respond({ items: [] });
      await evicted;
    });
  });

  describe("twoGatewayCompanyDetail", () => {
    test("the record is returned on success", async () => {
      const promise = window.twoGatewayCompanyDetail(
        "https://checkout-api.test.invalid",
        "lookup-111",
      );

      expect(fetchStub.last().url).toBe(
        "https://checkout-api.test.invalid/companies/v2/company/lookup-111",
      );
      fetchStub.last().respond({ addresses: [{ city: "Oslo" }] });

      expect(await promise).toEqual({ addresses: [{ city: "Oslo" }] });
    });

    test("a non-2xx returns null instead of parsing the error body as an address", async () => {
      const promise = window.twoGatewayCompanyDetail(
        "https://checkout-api.test.invalid",
        "x",
      );
      fetchStub.last().respondWithStatus(500);

      // Without the response.ok check an error body parses cleanly and
      // silently produces "no addresses".
      expect(await promise).toBeNull();
    });

    test("a network error returns null", async () => {
      const promise = window.twoGatewayCompanyDetail(
        "https://checkout-api.test.invalid",
        "x",
      );
      fetchStub.last().networkError();

      expect(await promise).toBeNull();
    });

    test("it carries the same 30s ceiling, and clears the timer", async () => {
      jest.useFakeTimers();
      const promise = window.twoGatewayCompanyDetail(
        "https://checkout-api.test.invalid",
        "x",
      );

      jest.advanceTimersByTime(29999);
      await H.flushPromises();
      expect(fetchStub.last().settled).toBe(false);

      jest.advanceTimersByTime(1);
      expect(await promise).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe("twoGatewayGetCountryCode fallback order", () => {
    /**
     * @param {string} id
     * @param {string} value
     * @returns {void}
     */
    function addCountryField(id, value) {
      const field = document.createElement("input");
      field.id = id;
      field.value = value;
      document.body.appendChild(field);
    }

    const quote = {
      shipping_country_id: "SE",
      billing_country_id: "DK",
      country_id: "FI",
      default_country_id: "NO",
    };

    test("the shipping dropdown wins over everything", () => {
      addCountryField("shipping-country_id", "GB");
      addCountryField("billing-country_id", "DE");

      expect(window.twoGatewayGetCountryCode(quote)).toBe("GB");
    });

    test("the billing dropdown wins over the quote", () => {
      addCountryField("billing-country_id", "DE");

      expect(window.twoGatewayGetCountryCode(quote)).toBe("DE");
    });

    test("an empty dropdown falls through to the quote shipping country", () => {
      addCountryField("shipping-country_id", "");

      expect(window.twoGatewayGetCountryCode(quote)).toBe("SE");
    });

    test.each([
      ["billing_country_id", ["shipping_country_id"], "DK"],
      ["country_id", ["shipping_country_id", "billing_country_id"], "FI"],
      [
        "default_country_id",
        ["shipping_country_id", "billing_country_id", "country_id"],
        "NO",
      ],
    ])("it falls through to %s", (_label, absent, expected) => {
      const partial = Object.assign({}, quote);
      absent.forEach((key) => delete partial[key]);

      expect(window.twoGatewayGetCountryCode(partial)).toBe(expected);
    });

    test("nothing resolvable is an empty string, not undefined", () => {
      // The callers branch on truthiness and then warn the buyer to pick
      // a country; undefined would work by accident, '' is the contract.
      expect(window.twoGatewayGetCountryCode({})).toBe("");
      expect(window.twoGatewayGetCountryCode(null)).toBe("");
      expect(window.twoGatewayGetCountryCode(undefined)).toBe("");
    });

    /**
     * The reported bug (2026-08-06): company search returned US companies on
     * the FIRST visit to a checkout whose buyer had selected another country,
     * and corrected itself as soon as they changed the country.
     *
     * Both halves are the store-default fallback. The quote snapshot is
     * rendered by PHP at page load, so before any address has been saved it
     * carries no country and the store default answered instead — while the
     * buyer's own selection sat in the DOM under an id the lookup did not
     * recognise, or had not been made yet at all.
     */
    describe("the buyer's own country selection", () => {
      /**
       * A country SELECT the way an address form renders it: named
       * `country_id` (or namespaced), never one of the two known ids.
       *
       * @param {string} name
       * @param {string} value
       * @returns {HTMLSelectElement}
       */
      function addCountrySelect(name, value) {
        const select = document.createElement("select");
        select.name = name;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value || "";
        select.appendChild(option);
        select.value = value;
        document.body.appendChild(select);
        return select;
      }

      test("a country_id select with no recognised id still wins over the quote", () => {
        addCountrySelect("country_id", "GB");

        expect(window.twoGatewayGetCountryCode(quote)).toBe("GB");
      });

      test("a namespaced country_id select wins over the quote too", () => {
        addCountrySelect("shipping[country_id]", "GB");

        expect(window.twoGatewayGetCountryCode(quote)).toBe("GB");
      });

      test("the shipping id keeps its priority over a name-matched field, whatever the document order", () => {
        // Document order puts the name-matched select FIRST, so a single
        // querySelectorAll would hand the priority decision to the theme.
        addCountrySelect("billing[country_id]", "DE");
        addCountryField("shipping-country_id", "GB");

        expect(window.twoGatewayGetCountryCode(quote)).toBe("GB");
      });

      test("the store default is NOT used while the buyer has a country selector they have not chosen in", () => {
        // The whole reported symptom: US companies for a buyer who has
        // chosen no country yet. Answering '' is what makes the callers
        // say "Please select a country first" instead of searching the
        // store's own country silently.
        addCountrySelect("country_id", "");

        expect(
          window.twoGatewayGetCountryCode({ default_country_id: "US" }),
        ).toBe("");
      });

      test("a quote country still beats the empty selector — only the STORE DEFAULT is suppressed", () => {
        addCountrySelect("country_id", "");

        expect(
          window.twoGatewayGetCountryCode({
            shipping_country_id: "SE",
            default_country_id: "US",
          }),
        ).toBe("SE");
      });

      test("the store default survives on a checkout with no country selector at all", () => {
        // Exactly the case its own comment was always written for: a
        // single-country store, where the default is the only answer there
        // is. A hidden mirror input is not a selector.
        addCountryField("shipping-country_id", "");

        expect(
          window.twoGatewayGetCountryCode({ default_country_id: "US" }),
        ).toBe("US");
        expect(window.twoGatewayHasCountrySelector()).toBe(false);
      });

      /**
       * Review round 1 on this batch. Broadening the lookup by NAME also
       * reaches fields the buyer has never seen: a logged-in checkout keeps an
       * address-book "add address" form in the DOM with its country select
       * pre-selected to the store's own country. Letting that outrank the
       * quote's real shipping country is the same wrong-country bug again, from
       * a field nobody touched.
       */
      describe("fields the buyer cannot have used are ignored", () => {
        test("a select hidden by an ancestor's inline display:none does not win", () => {
          const modal = document.createElement("div");
          modal.style.display = "none";
          document.body.appendChild(modal);
          const select = document.createElement("select");
          select.name = "country_id";
          const option = document.createElement("option");
          option.value = "US";
          select.appendChild(option);
          select.value = "US";
          modal.appendChild(select);

          expect(window.twoGatewayGetCountryCode(quote)).toBe("SE");
          // …and it does not suppress the store default either, or a
          // single-country checkout with an address-book modal in the DOM
          // would dead-end on "Please select a country first".
          expect(window.twoGatewayHasCountrySelector()).toBe(false);
        });

        test("the `hidden` class and the hidden attribute count too", () => {
          const byClass = addCountrySelect("country_id", "US");
          byClass.classList.add("hidden");
          const byAttribute = addCountrySelect("billing[country_id]", "DE");
          byAttribute.hidden = true;

          expect(window.twoGatewayCountryFields()).toEqual([]);
          expect(window.twoGatewayGetCountryCode(quote)).toBe("SE");
        });

        test("a disabled select does not win", () => {
          const select = addCountrySelect("country_id", "US");
          select.disabled = true;

          expect(window.twoGatewayCountryFields()).toEqual([]);
          expect(window.twoGatewayGetCountryCode(quote)).toBe("SE");
        });

        test("a visible select still wins — the filter is not a blanket refusal", () => {
          addCountrySelect("country_id", "GB");

          expect(window.twoGatewayGetCountryCode(quote)).toBe("GB");
          expect(window.twoGatewayHasCountrySelector()).toBe(true);
        });

        test("a name-matched select inside a disabled fieldset is ignored", () => {
          // `<fieldset disabled>` disables everything inside it without setting
          // the attribute on any descendant, and this checkout disables
          // fieldsets while a step saves — so the field-level check alone would
          // read a value the buyer cannot currently change.
          const fieldset = document.createElement("fieldset");
          fieldset.disabled = true;
          document.body.appendChild(fieldset);
          const select = document.createElement("select");
          select.name = "country_id";
          const option = document.createElement("option");
          option.value = "US";
          select.appendChild(option);
          select.value = "US";
          fieldset.appendChild(select);

          expect(window.twoGatewayCountryFields()).toEqual([]);
          expect(window.twoGatewayGetCountryCode(quote)).toBe("SE");
        });

        /**
         * Review round 2. The filter covers exactly what this batch ADDED —
         * fields found by NAME. The two known ids were read unconditionally by
         * every previous version of this helper, and this checkout hides a
         * step's form subtree rather than unmounting it in at least some states,
         * so filtering them would move behaviour that was already correct in the
         * direction of the very bug this batch closes, on a surface no test here
         * can see.
         */
        test("the two known ids are NOT filtered — a hidden one still wins", () => {
          const wrapper = document.createElement("div");
          wrapper.style.display = "none";
          document.body.appendChild(wrapper);
          const field = document.createElement("input");
          field.id = "shipping-country_id";
          field.value = "GB";
          wrapper.appendChild(field);

          expect(window.twoGatewayGetCountryCode(quote)).toBe("GB");
          expect(window.twoGatewayCountryFields()).toEqual([field]);
        });

        test("a hidden known-id SELECT still counts as a selector", () => {
          // Same exemption, for the other question the list answers. A hidden
          // shipping form on the payment step is still the buyer's country
          // selector; it is one step away, not absent.
          const wrapper = document.createElement("div");
          wrapper.style.display = "none";
          document.body.appendChild(wrapper);
          const select = addCountrySelect("country_id", "");
          select.id = "shipping-country_id";
          wrapper.appendChild(select);

          expect(window.twoGatewayHasCountrySelector()).toBe(true);
          expect(
            window.twoGatewayGetCountryCode({ default_country_id: "US" }),
          ).toBe("");
        });
      });

      test("twoGatewayCountryFields lists the two known ids once each, ahead of name matches", () => {
        // `#shipping-country_id` also matches `[name="country_id"]` when the
        // form names it that way; a duplicated entry would be harmless here
        // but makes the priority list a lie for anything else reading it.
        const shipping = addCountrySelect("country_id", "GB");
        shipping.id = "shipping-country_id";
        addCountrySelect("billing[country_id]", "DE");

        const fields = window.twoGatewayCountryFields();
        expect(fields.filter((f) => f === shipping)).toHaveLength(1);
        expect(fields[0]).toBe(shipping);
        expect(fields).toHaveLength(2);
      });
    });
  });
});
