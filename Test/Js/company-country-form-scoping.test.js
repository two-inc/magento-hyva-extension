/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25461. WHICH FORM'S COUNTRY a company search runs in.
 *
 * There is one country resolver and every surface reuses it — that part was
 * always right. What was wrong is that it answered a DOCUMENT-WIDE question with
 * a hardcoded shipping-before-billing priority, so a control mounted in the
 * invoice address form read the DELIVERY address's country. The company-search
 * field renderer is registered globally on `entity-form.field-renderers`, so it
 * mounts on whichever address forms the checkout renders and both forms' controls
 * are the same component: nothing in the resolver knew which one was asking.
 *
 * The rule (sole-trader porting guide §1): each address form's chip visibility
 * and company/country read LIVE from that same form's own current fields, never
 * from a different address; and the payment tile, which is in no address form at
 * all, reads the address holding the INVOICE role (§1(a.3)) — the billing one,
 * or the shipping one while the buyer says they are the same.
 *
 * Every search here is driven to the WIRE and asserted on the `country` query
 * parameter, because that is the only thing that proves which country the buyer
 * was actually searched in. Asserting `component.countryCode` alone would pass
 * on a resolver that computed the right value and searched with another.
 */

"use strict";

const H = require("./hyva-harness");

const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";
const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";

describe("form-scoped country resolution", () => {
  let env;
  let fetchStub;

  /**
   * One address form: its own country select and its own company-search control.
   *
   * `class="two-company-search"` on the control root is load-bearing:
   * `controlRoot()` finds itself by that class.
   *
   * The `<form>` element is load-bearing here too: it is the boundary the scope
   * walk stops at, so it is what stops a control climbing out of its own address
   * form and into the neighbouring one.
   *
   * @param {string} role "shipping" or "billing"
   * @param {string} country the value its select is on, "" for unchosen
   * @returns {string}
   */
  function addressForm(role, country) {
    return [
      '<form id="' + role + '-form">',
      '  <select id="' + role + '-country_id" name="' + role + '[country_id]">',
      '    <option value=""></option>',
      '    <option value="' +
        country +
        '"' +
        (country ? " selected" : "") +
        ">x</option>",
      "  </select>",
      '  <div id="' +
        role +
        '-company-root" class="two-company-search" data-two-capture-host="address">',
      '    <input type="text" id="' +
        role +
        '-company-field" data-two-capture-field value="" />',
      "  </div>",
      "</form>",
    ].join("\n");
  }

  /**
   * The payment tile: a form of its own, holding the one control, with NO
   * country field anywhere inside it — which is the whole point. It is several
   * steps away from any address, so it has no form-local country to read and
   * has to name the address it means by role.
   *
   * @param {boolean} [billingAsShipping] renders the checkbox in that state;
   *   omit to render no checkbox at all
   * @returns {string}
   */
  function paymentTile(billingAsShipping) {
    return [
      '<form id="payment-form">',
      billingAsShipping === undefined
        ? ""
        : '  <input type="checkbox" id="billing-as-shipping"' +
          (billingAsShipping ? " checked" : "") +
          " />",
      '  <div id="tile-root">',
      '    <div class="two-company-search" data-two-capture-host="tile">',
      '      <input type="text" id="company_name" data-two-capture-field value="" />',
      "    </div>",
      '    <input type="text" id="company_id" value="" disabled />',
      "  </div>",
      "</form>",
    ].join("\n");
  }

  /**
   * @param {string} html
   * @returns {void}
   */
  function render(html) {
    document.body.innerHTML = html;
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();
  }

  /**
   * Mount the address step's control inside one address form.
   *
   * @param {string} role
   * @returns {Object}
   */
  function mountAddressControl(role) {
    const component = H.mountComponent(
      env.alpineComponents[ADDRESS_COMPONENT],
      {
        el: document.getElementById(role + "-company-field"),
        root: document.getElementById(role + "-company-root"),
      },
    );
    component.init();
    return component;
  }

  /**
   * Mount the payment tile's control.
   *
   * @returns {Object}
   */
  function mountTile() {
    const component = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
      el: document.getElementById("company_name"),
      root: document.getElementById("tile-root"),
    });
    component.$watch = function () {};
    component.initialize(JSON.parse(H.QUOTE_JSON));
    return component;
  }

  /**
   * Drive a search from one mounted control to the wire and report the country
   * it went out with.
   *
   * @param {Object} component
   * @returns {Promise<string|null>} the `country` parameter, or null if nothing
   *   reached the wire at all
   */
  async function searchedCountry(component) {
    // This surface's OWN search, not the controller's shared one: one
    // page-level controller answers for whichever surface mounted last, so
    // asking it could not tell the two forms apart at all.
    component.capturePanelSearch({ term: "Exa" });
    await H.flushPromises();

    const call = fetchStub.lastSearch();
    if (!call) return null;
    const country = call.jsonBody().country;
    call.respondProxy({ items: [] });
    await H.flushPromises();
    return country;
  }

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  describe("two address forms in different countries, both on screen", () => {
    // The reported bug, and the reason every assertion below is on a pair
    // rather than on one form: a resolver hardcoded to shipping is right about
    // one of these and wrong about the other, and only comparing the two can
    // tell that apart from a resolver that works.
    beforeEach(() => {
      render(addressForm("shipping", "NO") + addressForm("billing", "GB"));
    });

    test.each([
      ["shipping", "NO", "the delivery form reads its own country"],
      ["billing", "GB", "the invoice form reads its own country"],
    ])("%s control searches in %s — %s", async (role, expected) => {
      const component = mountAddressControl(role);

      expect(await searchedCountry(component)).toBe(
        expected,
      );
      expect(component.countryCode).toBe(expected);
    });

    test("a caller with no form of its own still gets the document-wide, shipping-first answer", () => {
      // Unchanged behaviour, asserted so the scoping cannot quietly become
      // mandatory: the tile's fallback, and every existing caller in the other
      // suites, depend on this path.
      expect(window.twoGatewayGetCountryCode({})).toBe("NO");
    });

    // What a form with its own country UNCHOSEN falls through to. The design
    // rule is about live reads: it must not be answered with the country the
    // buyer entered in a DIFFERENT address, so "GB" is the wrong answer to every
    // row here. What it falls through to instead is unchanged — the quote
    // snapshot, and then '' rather than the store default while a country
    // selector exists.
    test.each([
      [
        { shipping_country_id: "SE" },
        "SE",
        "the quote, not the other live form",
      ],
      [
        { default_country_id: "US" },
        "",
        "'' — the store default stays suppressed",
      ],
    ])(
      "an unchosen local field falls through to %p → %p (%s)",
      (quote, expected) => {
        document.getElementById("shipping-country_id").value = "";

        expect(
          window.twoGatewayGetCountryCode(
            quote,
            document.getElementById("shipping-company-root"),
          ),
        ).toBe(expected);
      },
    );
  });

  describe("one address form on screen", () => {
    // A buyer who has not opened a second address is the common case, and the
    // scope walk must not need the other form to exist to answer. Both rows
    // passed BEFORE the scoping too — with only one form in the document, the
    // old shipping-first list reached the same field — so they pin that the fix
    // did not break the single-form case, not that it fixed it.
    test.each([
      ["shipping", "NO", "the delivery form, no invoice form rendered yet"],
      ["billing", "GB", "the invoice form, no delivery form in this fixture"],
    ])("the %s form alone resolves %s (%s)", async (role, expected) => {
      render(addressForm(role, expected));
      const component = mountAddressControl(role);

      expect(await searchedCountry(component)).toBe(
        expected,
      );
    });
  });

  describe("the payment tile reads the INVOICE-role address", () => {
    // Only the UNTICKED row discriminates this fix from the old shipping-first
    // lookup; the other two coincide with it, and are here because they are the
    // rows that fail if the role resolution is pinned to billing instead, or if
    // the absent-checkbox default is inverted.
    test.each([
      [true, "NO", "ticked: the invoice address IS the delivery address"],
      [false, "GB", "unticked: the invoice address is the billing form"],
      [undefined, "NO", "no checkbox at all: one address holds every role"],
    ])("checkbox %p → %s (%s)", async (checked, expected) => {
      render(
        addressForm("shipping", "NO") +
          addressForm("billing", "GB") +
          paymentTile(checked),
      );
      const component = mountTile();

      expect(await searchedCountry(component)).toBe(
        expected,
      );
    });

    test("with no billing form rendered it falls back rather than refusing to search", async () => {
      // Unticked, but the billing form is not on the page — a checkout that has
      // not rendered it yet, or one that namespaces its ids differently. The
      // document-wide list answers, which is what this surface always did.
      render(addressForm("shipping", "NO") + paymentTile(false));
      const component = mountTile();

      expect(await searchedCountry(component)).toBe("NO");
    });

    test("the order-intent check is sent with the same country the search used", () => {
      // One resolution, one country. A verdict reached in a different country
      // from the search that found the company is a wrong answer that looks
      // like a right one.
      render(
        addressForm("shipping", "NO") +
          addressForm("billing", "GB") +
          paymentTile(false),
      );
      const component = mountTile();

      const body = component.buildOrderIntentRequestBody(
        JSON.parse(H.QUOTE_JSON),
      );

      expect(body.buyer.company.country_prefix).toBe("GB");
    });
  });

  describe("a surface that names no anchor", () => {
    test("resolves through the document-wide list, i.e. as it did before scoping", async () => {
      // The engine's `resolveCountryContext` default. Every surface in this repo
      // names its own anchor, so nothing here reaches it — it is the contract for
      // an out-of-repo composer, and the direction it degrades in is what makes it
      // safe: pre-scoping behaviour, never "no country at all". Composed bare
      // rather than through a surface, because a surface would override it.
      render(addressForm("shipping", "NO") + addressForm("billing", "GB"));
      const component = H.mountComponent(
        () =>
          window.twoGatewayCompanySearchEngine({
            restBaseUrl: "https://shop.test.invalid",
            getQuote: function () {
              return {};
            },
          }),
        { el: document.getElementById("billing-company-field") },
      );

      // Not awaited before the assertion: the country is resolved synchronously
      // at the top of the search, and the request is settled afterwards only so
      // the suite leaves nothing in flight.
      const pending = component.runCompanySearch("Exa");
      expect(component.countryCode).toBe("NO");

      fetchStub.calls[fetchStub.calls.length - 1].respondProxy({ items: [] });
      await pending;
    });
  });

  describe("the address-book picker, whose x-data is not ours", () => {
    // shipping_company.phtml composes the ENGINE directly under Hyvä Checkout's
    // own closed-source modal markup, so its `$root` is an element this module
    // neither owns nor can bound — if it sits above both address forms, a
    // root-anchored scope would span the checkout. It anchors on `$el`, the input
    // it is bound to, which is inside the form the buyer is editing. The mount
    // below gives it exactly the bad `$root` (the wrapper over both forms) to
    // prove the anchor, not the root, is what decides.
    test("scopes to the form holding its own input, not to its foreign root", async () => {
      render(
        '<div id="checkout-wrapper">' +
          addressForm("shipping", "NO") +
          addressForm("billing", "GB") +
          "</div>",
      );
      H.loadTemplate(H.SHIPPING_COMPANY_TEMPLATE);
      env.fireAlpineInit();
      // The visible input this picker is bound to, inside the INVOICE form —
      // whichever form Hyvä has the buyer editing is the one it must read, and
      // billing is the one a shipping-first resolver gets wrong.
      const input = document.getElementById("billing-company-field");
      const component = H.mountComponent(env.alpineComponents.searchInput, {
        el: input,
        root: document.getElementById("checkout-wrapper"),
      });

      // This surface has no query box of its own (`querySplit` off): the term is
      // read from the input it is bound to, which is the same element that
      // anchors the country scope.
      input.value = "Exa";
      component.getItems();
      await H.flushPromises();

      const call = fetchStub.calls[fetchStub.calls.length - 1];
      expect(call.jsonBody().country).toBe("GB");
      call.respondProxy({ items: [] });
      await H.flushPromises();
    });
  });

  describe("the scope walk itself", () => {
    beforeEach(() => {
      render(addressForm("shipping", "NO") + paymentTile(false));
    });

    test("stops at a form with no country field of its own", () => {
      // DEFENSIVE, and pinned as such: no surface asks by root from inside a
      // country-less form today — the tile names its field by role instead — so
      // this is what stops a future by-root caller climbing out of its own form.
      // The wrapper is what makes the boundary do any work: without an ancestor
      // holding the address form too there is nothing above to climb to, and the
      // body guard would catch it either way.
      document.body.innerHTML =
        '<div id="checkout-wrapper">' + document.body.innerHTML + "</div>";

      expect(
        window.twoGatewayCountryFieldScope(
          document.querySelector("#tile-root .two-company-search"),
        ),
      ).toBeNull();
    });

    test("stops at the body for a control that is in no form at all", () => {
      // `<body>` all but always contains SOME country field, so a walk that
      // reached it and asked the containment question would answer "your scope is
      // the whole document" — the same accident the `<form>` boundary refuses.
      // Reachable without a form ancestor: a control rendered outside the address
      // forms entirely.
      document.body.innerHTML +=
        '<div id="loose-root" class="two-company-search"></div>';

      expect(
        window.twoGatewayCountryFieldScope(
          document.getElementById("loose-root"),
        ),
      ).toBeNull();
      // …and it therefore falls through to the document-wide list rather than
      // resolving nothing at all.
      expect(
        window.twoGatewayGetCountryCode(
          {},
          document.getElementById("loose-root"),
        ),
      ).toBe("NO");
    });

    test("does not treat a form whose only country field is hidden as a scope", () => {
      // Such a caller falls through to the document-wide list, which is what it
      // did before scoping existed. The address-book modal composes the engine
      // inside its own form, and that form's field is a name match filtered out
      // while the modal is closed.
      document.body.innerHTML +=
        '<form id="modal-form">' +
        '  <select name="modal[country_id]" style="display: none">' +
        '    <option value="DE" selected>x</option>' +
        "  </select>" +
        '  <div id="modal-company-root" class="two-company-search"></div>' +
        "</form>";

      expect(
        window.twoGatewayCountryFieldScope(
          document.getElementById("modal-company-root"),
        ),
      ).toBeNull();
      expect(
        window.twoGatewayGetCountryCode(
          {},
          document.getElementById("modal-company-root"),
        ),
      ).toBe("NO");
    });

    test("a country field IS its own scope, so a caller may name one by role", () => {
      // How the tile passes the invoice-role field it resolved itself.
      const field = document.getElementById("shipping-country_id");

      expect(window.twoGatewayCountryFieldScope(field)).toBe(field);
      expect(window.twoGatewayCountryFieldsWithin(field)).toEqual([field]);
    });

    test.each([
      [undefined, "no context"],
      [null, "null"],
      [{}, "a non-element"],
    ])("%s resolves no scope (%s)", (context) => {
      expect(window.twoGatewayCountryFieldScope(context)).toBeNull();
    });
  });
});
