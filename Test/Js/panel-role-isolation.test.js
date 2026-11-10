/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The delivery panel and the invoice panel do not interact. At all.
 *
 * One identity and one capture controller per address ROLE, so a company
 * captured in one panel is invisible to the other. The reported symptom of a
 * single shared identity was an oscillation: a Magewire re-render fired
 * `element.updated`, both mounts remounted, each stole the other's capture
 * claim, both subscribed to the one page-global identity, and every
 * notification overwrote both surfaces — so the company appeared in one panel,
 * blanked in the other, and flipped back on the next sweep with no timer
 * anywhere. Every assertion here is on a PAIR of surfaces, because a
 * single-surface assertion passes on a shared identity too.
 */

"use strict";

const H = require("./hyva-harness");

const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";

const SHIPPING_COMPANY = { companyName: "Delivery Ltd", companyId: "11111111" };
const BILLING_COMPANY = { companyName: "Invoice GmbH", companyId: "22222222" };

describe("address panels are isolated by role", () => {
  let env;
  let fetchStub;

  /**
   * One address panel: its own country select and its own capture control.
   *
   * The `<form>` and the `<role>-` id prefixes are both load-bearing: the form
   * is where the country scope walk stops, and the prefix is the only marker of
   * which role a panel is.
   *
   * @param {string} role "shipping" or "billing"
   * @param {string} country the value its select is on
   * @returns {string}
   */
  function addressPanel(role, country) {
    return [
      '<form id="' + role + '-form">',
      '  <select id="' + role + '-country_id" name="' + role + '[country_id]">',
      '    <option value="' + country + '" selected>x</option>',
      "  </select>",
      '  <input name="city" value="" data-panel="' + role + '" />',
      '  <input name="postcode" value="" data-panel="' + role + '" />',
      '  <input name="street[0]" value="" data-panel="' + role + '" />',
      '  <input name="telephone" value="" data-panel="' + role + '" />',
      "  <div><div><div>",
      '  <div id="' +
        role +
        '-company-root" class="two-company-search"' +
        ' data-two-capture-host="address" data-two-capture-role="">',
      '    <input type="text" id="' +
        role +
        '-company-field" data-two-capture-field value="" />',
      "  </div>",
      "  </div></div></div>",
      "</form>",
    ].join("\n");
  }

  /**
   * One address field of one panel.
   *
   * @param {string} role
   * @param {string} name
   * @returns {HTMLInputElement}
   */
  function addressField(role, name) {
    return document.querySelector(
      '[name="' + name + '"][data-panel="' + role + '"]',
    );
  }

  /**
   * @param {string} role
   * @returns {Object} that panel's stored company record
   */
  function storedRecord(role) {
    const key =
      role === "billing" ? H.BILLING_COMPANY_KEY : H.COMPANY_SELECTION_KEY;
    return JSON.parse(env.browserStorage.getItem(key) || "{}");
  }

  /**
   * @param {string} role
   * @returns {Object} the mounted surface
   */
  function mountPanel(role) {
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

  beforeEach(() => {
    document.body.innerHTML =
      addressPanel("shipping", "NO") + addressPanel("billing", "GB");
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    // Autopopulation on, so the phone write is reachable and its target
    // assertable.
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE, [
      [/^\$isAddressAutopopulationEnabled$/, "true"],
    ]);
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
  });

  test("each panel resolves its own role", () => {
    expect(mountPanel("shipping").captureRole()).toBe("shipping");
    expect(mountPanel("billing").captureRole()).toBe("billing");
  });

  test("two mounted panels hold two identities and two controllers", () => {
    mountPanel("shipping");
    mountPanel("billing");

    expect(env.identityFor("shipping")).not.toBe(env.identityFor("billing"));
    expect(window.twoGatewayCompanyCaptureInstances.shipping).not.toBe(
      window.twoGatewayCompanyCaptureInstances.billing,
    );
  });

  describe.each([
    ["shipping", "billing", SHIPPING_COMPANY],
    ["billing", "shipping", BILLING_COMPANY],
  ])("a company captured in the %s panel", (written, other, company) => {
    let panels;

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
      env
        .identityFor(written)
        .write(Object.assign({ companyIdSource: "registry" }, company), {
          authoritative: true,
        });
    });

    test.each([
      ["companyName", company.companyName],
      ["companyId", company.companyId],
      ["search", company.companyName],
    ])("reaches its own surface's %s", (key, expected) => {
      expect(panels[written][key]).toBe(expected);
    });

    test.each([["companyName"], ["companyId"], ["search"]])(
      "leaves the " + other + " surface's %s untouched",
      (key) => {
        expect(panels[other][key]).toBe("");
      },
    );

    test("leaves the " + other + " identity untouched", () => {
      expect(env.identityFor(other).companyName()).toBe("");
      expect(env.identityFor(other).companyId()).toBe("");
    });

    test("leaves the " + other + " panel's field untouched", () => {
      expect(document.getElementById(other + "-company-field").value).toBe("");
    });
  });

  describe("a re-render sweep with both panels mounted", () => {
    let panels;

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
      env
        .identityFor("shipping")
        .write(
          Object.assign({ companyIdSource: "registry" }, SHIPPING_COMPANY),
          { authoritative: true },
        );
      env
        .identityFor("billing")
        .write(
          Object.assign({ companyIdSource: "registry" }, BILLING_COMPANY),
          { authoritative: true },
        );
      // Many `element.updated` calls per re-render, and several re-renders: one
      // sweep cannot show an oscillation, which flips on every cycle.
      env.fireMagewireHook("element.updated", 6);
    });

    test.each([
      ["shipping", SHIPPING_COMPANY],
      ["billing", BILLING_COMPANY],
    ])("leaves the %s panel on its own company", (role, company) => {
      expect(panels[role].companyName).toBe(company.companyName);
      expect(panels[role].companyId).toBe(company.companyId);
    });

    test("does not converge the two panels onto one company", () => {
      expect(panels.shipping.companyName).not.toBe(panels.billing.companyName);
      expect(panels.shipping.companyId).not.toBe(panels.billing.companyId);
    });

    test("re-stamps each panel's own role, which the morph would wipe", () => {
      document
        .querySelectorAll("[data-two-capture-role]")
        .forEach((root) => root.setAttribute("data-two-capture-role", ""));
      env.fireMagewireHook("element.updated");

      expect(
        document
          .getElementById("shipping-company-root")
          .getAttribute("data-two-capture-role"),
      ).toBe("shipping");
      expect(
        document
          .getElementById("billing-company-root")
          .getAttribute("data-two-capture-role"),
      ).toBe("billing");
    });
  });

  describe("each role's controller reads its own panel", () => {
    beforeEach(() => {
      mountPanel("shipping");
      mountPanel("billing");
    });

    test.each([
      ["shipping", "no"],
      ["billing", "gb"],
    ])("the %s controller's adjacent country is %s", (role, expected) => {
      const host = window.twoGatewayCompanyCaptureInstances[role].host();

      expect(host.getAdjacentCountry()).toBe(expected);
      expect(host.getQuoteCountry()).toBe(expected);
    });

    /*
     * The host's own `watchCountryChanges` is subscribed to directly rather than
     * spying on the controller: the controller binds its handler once at start,
     * and the guard under test is in the host's listener.
     */
    test.each([
      ["shipping", "billing"],
      ["billing", "shipping"],
    ])(
      "the %s host hears its own country change and not the %s panel's",
      (role, other) => {
        const seen = [];
        window.twoGatewayCompanyCaptureInstances[role]
          .host()
          .watchCountryChanges((country) => seen.push(country));

        document
          .getElementById(other + "-country_id")
          .dispatchEvent(new Event("change", { bubbles: true }));

        expect(seen).toEqual([]);

        document
          .getElementById(role + "-country_id")
          .dispatchEvent(new Event("change", { bubbles: true }));

        expect(seen).toHaveLength(1);
      },
    );
  });

  describe("each panel keeps its own storage record", () => {
    let panels;

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
    });

    test.each([
      ["shipping", "billing", SHIPPING_COMPANY],
      ["billing", "shipping", BILLING_COMPANY],
    ])(
      "a %s capture writes the %s record not at all",
      (written, other, company) => {
        env
          .identityFor(written)
          .write(Object.assign({ companyIdSource: "registry" }, company), {
            authoritative: true,
          });

        expect(storedRecord(written).company_name).toBe(company.companyName);
        expect(storedRecord(written).company_id).toBe(company.companyId);
        expect(storedRecord(other).company_name).toBeUndefined();
      },
    );

    test("a record left by the other panel does not restore into this one", () => {
      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
        JSON.stringify({
          company_name: "Invoice GmbH",
          company_id: "22222222",
        }),
      );

      mountPanel("shipping").init();

      expect(env.identityFor("shipping").companyName()).toBe("");
    });
  });

  describe("sole-trader autofill writes the panel that hosts it", () => {
    let panels;

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
    });

    test.each([
      ["shipping", "billing"],
      ["billing", "shipping"],
    ])("a %s adoption fills no field of the %s panel", (hosting, other) => {
      panels[hosting].captureApplyBuyerAddress({
        city: "Ashford",
        postal_code: "TN23 1AA",
        street_address: "Mill Lane",
      });
      panels[hosting].captureApplyTelephone("+44 7700 900000");

      expect(addressField(hosting, "city").value).toBe("Ashford");
      expect(addressField(hosting, "postcode").value).toBe("TN23 1AA");
      expect(addressField(hosting, "street[0]").value).toBe("Mill Lane");
      expect(addressField(hosting, "telephone").value).toBe("+44 7700 900000");
      ["city", "postcode", "street[0]", "telephone"].forEach((name) => {
        expect(addressField(other, name).value).toBe("");
      });
    });
  });

  describe("a company pick's registry phone stays in its own panel (TWO-27160)", () => {
    let panels;

    /**
     * @param {string} role
     * @param {string} phone the address's `phone_number`, `""` for none
     */
    async function pickIn(role, phone) {
      panels[role].selectItem({
        companyName: "Company " + role,
        companyId: "1",
        lookupId: "lookup-" + role + "-" + phone,
      });
      fetchStub.lastSearch().respondProxy({
        addresses: [{ city: "Oslo", phone_number: phone }],
      });
      await H.flushPromises();
    }

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
    });

    test.each([
      ["shipping", "billing"],
      ["billing", "shipping"],
    ])(
      "a %s pick writes and clears no phone of the %s panel",
      async (picking, other) => {
        await pickIn(other, "+47 22 00 00 02");
        await pickIn(picking, "+47 22 00 00 01");

        expect(addressField(picking, "telephone").value).toBe(
          "+47 22 00 00 01",
        );
        expect(addressField(other, "telephone").value).toBe("+47 22 00 00 02");

        await pickIn(picking, "");

        expect(addressField(picking, "telephone").value).toBe("");
        expect(addressField(other, "telephone").value).toBe("+47 22 00 00 02");
      },
    );
  });

  /*
   * TWO-27212. The capture controller reverts the autofill when the buyer
   * switches a form's country and when they leave sole-trader mode after an
   * adoption. Every case below drives it the way the page does: a real
   * `change` on a country field, or the controller's own mode switch. Only
   * what still holds this module's write goes, and only in the form concerned.
   */
  describe("the autofill is taken back out of the form concerned", () => {
    const MARK = "data-two-autofilled-value";
    const REGISTRY = {
      city: "Oslo",
      postal_code: "0150",
      street_address: "1 Example Road",
      phone_number: "+47 22 00 00 01",
    };
    const FILLED = ["Oslo", "0150", "1 Example Road", "+47 22 00 00 01"];
    const FIELDS = ["city", "postcode", "street[0]", "telephone"];
    let panels;

    /** @param {string} role */
    async function pickIn(role) {
      panels[role].selectItem({
        companyName: "Company " + role,
        companyId: "1",
        lookupId: "lookup-" + role,
      });
      fetchStub.lastSearch().respondProxy({ addresses: [REGISTRY] });
      await H.flushPromises();
    }

    /**
     * Select another country in a country field, as the buyer would.
     *
     * @param {HTMLSelectElement} select
     * @param {string} country
     */
    function selectCountry(select, country) {
      if (!select.querySelector('option[value="' + country + '"]')) {
        const option = document.createElement("option");
        option.value = country;
        select.appendChild(option);
      }
      select.value = country;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /** @param {string} role */
    function switchCountry(role) {
      selectCountry(document.getElementById(role + "-country_id"), "SE");
    }

    /**
     * @param {string} role
     * @returns {Array<string>} city, postcode, line 1 and phone, in that order
     */
    function values(role) {
      return FIELDS.map((name) => addressField(role, name).value);
    }

    beforeEach(() => {
      panels = {
        shipping: mountPanel("shipping"),
        billing: mountPanel("billing"),
      };
    });

    test.each([
      ["shipping", "billing"],
      ["billing", "shipping"],
    ])(
      "a %s country switch empties that form and leaves the %s form",
      async (role, other) => {
        await pickIn(role);
        await pickIn(other);

        switchCountry(role);

        expect([values(role), values(other)]).toEqual([
          ["", "", "", ""],
          FILLED,
        ]);
      },
    );

    test("re-selecting the country already chosen takes nothing back", async () => {
      switchCountry("shipping");
      await pickIn("shipping");

      switchCountry("shipping");

      expect(values("shipping")).toEqual(FILLED);
    });

    test.each([
      [
        "a field the buyer edited stays",
        (role) => {
          addressField(role, "postcode").value = "9999";
        },
        ["", "9999", "", ""],
      ],
      [
        "a phone the buyer edited stays",
        (role) => {
          addressField(role, "telephone").value = "+47 edited";
        },
        ["", "", "", "+47 edited"],
      ],
      [
        "a sole trader's verified phone stays",
        (role) => panels[role].captureApplyTelephone("+44 7700 900000"),
        ["", "", "", "+44 7700 900000"],
      ],
      [
        // What a Magewire morph does to a node it keeps: the record outlives it.
        "a write whose mark a morph stripped still goes",
        (role) =>
          FIELDS.forEach((name) =>
            addressField(role, name).removeAttribute(MARK),
          ),
        ["", "", "", ""],
      ],
    ])("%s", async (_description, between, expected) => {
      await pickIn("shipping");
      between("shipping");

      switchCountry("shipping");

      expect(values("shipping")).toEqual(expected);
    });

    test("a form the buyer filled by hand is left alone", () => {
      FIELDS.forEach((name, i) => {
        addressField("shipping", name).value = FILLED[i];
      });

      switchCountry("shipping");

      expect(values("shipping")).toEqual(FILLED);
    });

    /*
     * The marks a revert leaves: the phone keeps its own when the buyer edited
     * the registry's number, or when it holds a sole trader's verified one.
     */
    test.each([
      ["nothing edited", () => {}, []],
      [
        "the registry phone edited",
        () => {
          addressField("shipping", "telephone").value = "+47 edited";
        },
        ["telephone"],
      ],
      [
        "a sole trader's phone written",
        () => panels.shipping.captureApplyTelephone("+44 7700 900000"),
        ["telephone"],
      ],
    ])("with %s, the marks left are %j", async (_label, between, expected) => {
      await pickIn("shipping");
      between();

      switchCountry("shipping");

      expect(
        FIELDS.filter((name) =>
          addressField("shipping", name).hasAttribute(MARK),
        ),
      ).toEqual(expected);
    });

    test("each emptied field announces itself for wire:model", async () => {
      await pickIn("shipping");
      const announced = [];
      FIELDS.forEach((name) =>
        addressField("shipping", name).addEventListener("input", () =>
          announced.push(name),
        ),
      );

      switchCountry("shipping");

      expect(announced.sort()).toEqual(FIELDS.slice().sort());
    });

    test("a lookup still on the wire writes nothing after the switch", async () => {
      panels.shipping.selectItem({
        companyName: "Slow",
        companyId: "1",
        lookupId: "lookup-slow",
      });
      const slow = fetchStub.lastSearch();

      switchCountry("shipping");
      slow.respondProxy({ addresses: [REGISTRY] });
      await H.flushPromises();

      expect(values("shipping")).toEqual(["", "", "", ""]);
    });

    /*
     * The address-book modal's country is heard by the shipping controller,
     * but its revert belongs to the modal's own form, never the address
     * step's (as Luma reverts only the form whose country changed).
     */
    test("a country switch in the address-book modal reverts the modal's form alone", async () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        [
          '<form id="address-book-form">',
          '  <select name="country_id"><option value="NO" selected>x</option></select>',
          '  <input name="city" value="" data-panel="modal" />',
          '  <input name="postcode" value="" data-panel="modal" />',
          '  <input name="street[0]" value="" data-panel="modal" />',
          '  <input name="telephone" value="" data-panel="modal" />',
          "</form>",
        ].join("\n"),
      );
      const modal = document.getElementById("address-book-form");
      await pickIn("shipping");
      panels.shipping.setAddressData(REGISTRY, modal);
      panels.shipping.applyRegistryTelephone(REGISTRY.phone_number, modal);

      selectCountry(modal.querySelector('select[name="country_id"]'), "SE");

      expect([values("modal"), values("shipping")]).toEqual([
        ["", "", "", ""],
        FILLED,
      ]);
    });

    describe("leaving sole-trader mode", () => {
      const SOLE_TRADER = {
        city: "Ashford",
        postal_code: "TN23 1AA",
        street_address: "Mill Lane",
      };

      /** @returns {Object} the shipping role's capture controller */
      function controller() {
        return window.twoGatewayCompanyCaptureInstances.shipping;
      }

      /** Enter sole-trader mode and write its address, adopted or not. */
      function soleTraderWrites(adopted) {
        controller().soleTraderMode();
        if (adopted) {
          controller().adoptSoleTrader({
            company_name: "Jane Smith",
            organization_number: "",
          });
        }
        panels.shipping.captureApplyBuyerAddress(SOLE_TRADER);
      }

      test.each([
        ["after an adoption takes its address back out", true, ["", "", ""]],
        [
          "with nothing adopted takes nothing back",
          false,
          ["Ashford", "TN23 1AA", "Mill Lane"],
        ],
      ])("%s", (_label, adopted, expected) => {
        soleTraderWrites(adopted);

        controller().registeredMode();

        expect(values("shipping").slice(0, 3)).toEqual(expected);
      });
    });
  });

  /*
   * The controller's first resolution of a country is a baseline, not a
   * switch: an address with no country yet keeps its autofill when the buyer
   * first chooses one.
   */
  describe("the first country chosen", () => {
    beforeEach(() => {
      fetchStub.restore();
      env.restore();
      document.body.innerHTML =
        addressPanel("shipping", "") + addressPanel("billing", "");
      env = H.installHyvaEnvironment();
      fetchStub = H.stubFetch();
      H.loadSharedHelpers();
      H.loadTemplate(H.COMPANY_NAME_TEMPLATE, [
        [/^\$isAddressAutopopulationEnabled$/, "true"],
        [/^\$quoteDetailsJson$/, '{"quote_id":"test-quote-1"}'],
      ]);
      env.fireAlpineInit();
    });

    test("takes no autofill back", async () => {
      const shipping = mountPanel("shipping");
      shipping.selectItem({
        companyName: "Company",
        companyId: "1",
        lookupId: "lookup-1",
      });
      fetchStub.lastSearch().respondProxy({
        addresses: [{ city: "Oslo", postal_code: "0150" }],
      });
      await H.flushPromises();
      const select = document.getElementById("shipping-country_id");
      const option = document.createElement("option");
      option.value = "NO";
      select.appendChild(option);

      select.value = "NO";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      expect([
        addressField("shipping", "city").value,
        addressField("shipping", "postcode").value,
      ]).toEqual(["Oslo", "0150"]);
    });
  });

  describe("role resolution", () => {
    test.each([
      ["a form holding a billing- field", "billing-form", "billing"],
      ["a form holding no billing- field", "shipping-form", "shipping"],
    ])("%s is %s-role", (_label, formId, expected) => {
      expect(
        window.twoGatewayCaptureRoleForForm(document.getElementById(formId)),
      ).toBe(expected);
    });

    test("no form at all falls to shipping", () => {
      expect(window.twoGatewayCaptureRoleForForm(null)).toBe("shipping");
    });

    test("a roleless identity is refused rather than shared", () => {
      expect(window.twoGatewayCompanyIdentity()).toBeNull();
      expect(window.twoGatewayCompanyCapture({})).toBeNull();
    });
  });
});

describe("the payment tile's role does not follow #billing-as-shipping", () => {
  const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";

  let env;
  let fetchStub;

  /**
   * The tile, with both role country fields present so its country context
   * resolves in either checkbox state.
   *
   * @param {boolean} ticked whether `#billing-as-shipping` is on
   * @returns {Object} the mounted tile surface
   */
  function mountTile(ticked) {
    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="two_payment" checked />',
      '<input type="checkbox" id="billing-as-shipping"' +
        (ticked ? " checked" : "") +
        " />",
      '<input id="shipping-country_id" value="NO" />',
      '<input id="billing-country_id" value="GB" />',
      '<form id="tile-form">',
      '  <div class="two-company-search" data-two-capture-host="tile">',
      '    <input type="text" id="company_name" data-two-capture-field />',
      "  </div>",
      '  <input id="company_id" />',
      "</form>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();

    const component = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
      el: document.getElementById("company_name"),
      root: document.getElementById("tile-form"),
    });
    // The harness deliberately withholds `$watch`; the tile installs its own.
    component.$watch = function () {};
    component.initialize({ quote_id: "1", billing_country_id: "GB" });
    return component;
  }

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test.each([
    [true, "ticked"],
    [false, "unticked"],
  ])("is billing with the checkbox %s (%s)", (ticked) => {
    expect(mountTile(ticked).captureRole()).toBe("billing");
  });

  test.each([
    [true, "ticked"],
    [false, "unticked"],
  ])(
    "keeps the tile off a shipping-role write with the checkbox %s (%s)",
    (ticked) => {
      const tile = mountTile(ticked);

      env
        .identityFor("shipping")
        .write(
          Object.assign({ companyIdSource: "registry" }, SHIPPING_COMPANY),
          {
            authoritative: true,
          },
        );

      expect(tile.companyName).toBe("");
      expect(tile.companyId).toBe("");
    },
  );
});

describe("the shipping mirrors do not shadow Hyvä's own field ids", () => {
  /*
   * Hyvä's delivery form names its own company field `shipping-company` under
   * the `<role>-<field>` convention, so an id on either mirror is a duplicate —
   * and getElementById() answers with whichever comes first in the DOM, which is
   * the hidden mirror rather than the field the buyer types in.
   */
  const markup = H.renderTemplateMarkup(H.SHIPPING_COMPANY_TEMPLATE);

  test.each([["shipping-company"], ["shipping-company_id"]])(
    "the %s mirror carries no id",
    (name) => {
      document.body.innerHTML = markup;
      const mirror = document.querySelector(
        'input[type="hidden"][name="' + name + '"]',
      );

      expect(mirror).not.toBeNull();
      expect(mirror.hasAttribute("id")).toBe(false);
    },
  );

  /*
   * Per template, not over all of them concatenated: the harness resolves the
   * control's id/name attributes to one value that satisfies both mount points,
   * so a combined document carries a collision the page never renders — the two
   * mount points are exclusive PHP branches.
   */
  test.each([
    [H.SHIPPING_COMPANY_TEMPLATE],
    [H.COMPANY_NAME_MARKUP_TEMPLATE],
    [H.GATEWAY_METHOD_MARKUP_TEMPLATE],
  ])("%s renders no id twice", (template) => {
    document.body.innerHTML = H.renderTemplateMarkup(template);
    const ids = Array.prototype.map.call(
      document.querySelectorAll("[id]"),
      (el) => el.id,
    );

    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([]);
  });
});
