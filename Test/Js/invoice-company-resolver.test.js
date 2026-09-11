/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25554. Which captured company the order is placed for — billing when it has
 * a number, else shipping — and the pair carrying it, in both tile markup modes.
 */

"use strict";

const H = require("./hyva-harness");

const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const DELIVERY_COMPONENT = "twoGatewayHyvaCompanySearchField";
const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const METHOD_CODE = "two_payment";

const BILLING = { companyName: "Invoice GmbH", companyId: "11111111" };
const SHIPPING = { companyName: "Delivery Ltd", companyId: "22222222" };
const NAME_ONLY = { companyName: "Unnumbered Ltd", companyId: "" };
const NOTHING = { companyName: "", companyId: "" };

/** A buyer record as `/autofill/v1/buyer/current` returns one. */
const BUYER = {
  email: "sole@trader.test",
  company_name: "Sole Trader Ltd",
  organization_number: "998877",
  phone_number: "+44 7700 900000",
};

describe("the invoice-company resolver", () => {
  let env;
  let fetchStub;
  let validators;

  /**
   * @param {boolean} withTileControl the non-default markup mode, whose pair is
   *        the visible field the buyer can also type into
   */
  function render(withTileControl) {
    const pair = withTileControl
      ? [
          '  <div class="two-company-search" data-two-capture-host="tile">',
          '    <input type="text" id="company_name" name="payment[company_name]"' +
            ' data-two-capture-field value="" />',
          "  </div>",
          '  <input type="text" id="company_id" name="payment[company_id]"' +
            ' data-name="company_id" value="" />',
        ]
      : [
          '  <input type="hidden" id="company_name" name="payment[company_name]"' +
            ' data-name="company_name" />',
          '  <input type="hidden" id="company_id" name="payment[company_id]"' +
            ' data-name="company_id" />',
        ];

    document.body.innerHTML = []
      .concat([
        '<input type="radio" name="payment-method-option" value="' +
          METHOD_CODE +
          '" checked />',
        '<input id="shipping-country_id" value="GB" />',
        '<form id="two_payment_form">',
        '<div id="payment-root">',
      ])
      .concat(pair)
      .concat(["</div>", "</form>"])
      .join("\n");
  }

  /**
   * The delivery form's own capture surface, and the controller behind it.
   *
   * @returns {Object} the shipping-role capture controller
   */
  function mountDeliveryCapture() {
    const form = document.createElement("form");
    form.id = "shipping-form";
    form.innerHTML = [
      '<select id="shipping-country_id" name="shipping[country_id]">',
      '  <option value="GB" selected>x</option>',
      "</select>",
      '<div id="shipping-company-root" class="two-company-search"',
      '     data-two-capture-host="address" data-two-capture-role="">',
      '  <input type="text" id="shipping-company-field" data-two-capture-field value="" />',
      "</div>",
    ].join("\n");
    document.body.appendChild(form);

    const surface = H.mountComponent(env.alpineComponents[DELIVERY_COMPONENT], {
      el: document.getElementById("shipping-company-field"),
      root: document.getElementById("shipping-company-root"),
    });
    surface.init();
    return window.twoGatewayCompanyCaptureInstances.shipping;
  }

  /**
   * Capture a company for one address role, as that panel's controller does.
   *
   * @param {string} role 'shipping' or 'billing'
   * @param {{companyName: string, companyId: string}} company
   */
  function capture(role, company) {
    env.identityFor(role).write(
      {
        companyName: company.companyName,
        companyId: company.companyId,
        companyIdSource: company.companyId ? "registry" : "",
      },
      { authoritative: true },
    );
  }

  /** @returns {Object} the mounted tile, initialized */
  function mountTile() {
    const root = document.getElementById("payment-root");
    const tile = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
      el: root,
      root: root,
    });
    // The harness deliberately withholds `$watch`; the tile installs its own.
    tile.$watch = function () {};
    tile.initialize(JSON.parse(H.QUOTE_JSON));
    return tile;
  }

  /**
   * Run the validator Place Order runs.
   *
   * @returns {Promise<boolean>}
   */
  function placeOrder() {
    const form = document.getElementById("two_payment_form");
    const component = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: form,
      root: form,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    component.$watch = function () {};
    component.init();

    expect(validators.length).toBe(1);
    return validators[0]();
  }

  /** @returns {{name: string, id: string}} the pair that submits */
  function submittedPair() {
    return {
      name: document.getElementById("company_name").value,
      id: document.getElementById("company_id").value,
    };
  }

  /** @returns {Object} the one popover the shared controller mounted */
  function panel() {
    expect(env.companyPanels).toHaveLength(1);
    return env.companyPanels[0];
  }

  beforeEach(() => {
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    validators = [];
    window.hyvaCheckout = {
      navigation: { addTask: function () {} },
      validation: {
        register: function (name, callback) {
          validators.push(callback);
        },
      },
    };

    render(false);
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    delete window.hyvaCheckout;
    delete window.twoGatewayInvoiceCompanyWritten;
    delete window.twoGatewayInvoiceCompanyWatchers;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  describe.each([
    [false, "the hidden pair"],
    [true, "the tile's own control"],
  ])("with %s (%s)", (tileControl, mode) => {
    test.each([
      [
        BILLING,
        SHIPPING,
        "billing",
        BILLING,
        true,
        "billing presents a number",
      ],
      [NOTHING, SHIPPING, "shipping", SHIPPING, true, "only shipping has one"],
      [
        NAME_ONLY,
        SHIPPING,
        "shipping",
        SHIPPING,
        true,
        "billing has a name but no number",
      ],
      [NOTHING, NOTHING, "", NOTHING, false, "neither presents one"],
      [BILLING, NOTHING, "billing", BILLING, true, "only billing has one"],
    ])(
      "billing %s with shipping %s resolves to the %s role, submits %s," +
        " placement allowed=%s (%s)",
      async (billing, shipping, role, expected, allowed, row) => {
        const description = mode + ": " + row;
        render(tileControl);
        // The tile's own control restores its billing company from the record.
        if (tileControl) {
          env.browserStorage.setItem(
            H.BILLING_COMPANY_KEY,
            JSON.stringify({
              company_name: billing.companyName,
              company_id: billing.companyId,
              company_id_source: billing.companyId ? "registry" : "",
            }),
          );
        } else {
          capture("billing", billing);
        }
        capture("shipping", shipping);

        const tile = mountTile();

        expect([description, window.twoGatewayResolveInvoiceCompany()]).toEqual(
          [
            description,
            {
              companyName: expected.companyName,
              companyId: expected.companyId,
              companyIdSource: expected.companyId ? "registry" : "",
              role: role,
            },
          ],
        );
        expect([description, submittedPair()]).toEqual([
          description,
          { name: expected.companyName, id: expected.companyId },
        ]);
        expect([
          description,
          tile.buildOrderIntentRequestBody(JSON.parse(H.QUOTE_JSON)).buyer
            .company,
        ]).toEqual([
          description,
          {
            organization_number: expected.companyId,
            company_name: expected.companyName,
            country_prefix: "GB",
          },
        ]);
        expect([description, await placeOrder()]).toEqual([
          description,
          allowed,
        ]);
      },
    );
  });

  test("a pick in the delivery panel after the tile mounted reaches the pair", () => {
    // Given the payment step mounted, when a delivery capture lands, then the pair follows.
    mountTile();
    expect(submittedPair()).toEqual({ name: "", id: "" });

    capture("shipping", SHIPPING);

    expect(submittedPair()).toEqual({
      name: SHIPPING.companyName,
      id: SHIPPING.companyId,
    });
  });

  test.each([
    [false, ["intent"], "a delivery-panel pick dispatches the pre-check"],
    [true, [], "the resolved company's decision on record dispatches nothing"],
  ])(
    "order intent: decided=%s dispatches %s (%s)",
    (decided, expected, description) => {
      const tile = mountTile();
      if (decided) {
        tile.orderIntentDecisions[SHIPPING.companyId] = {
          name: SHIPPING.companyName,
          approved: true,
        };
      }

      const dispatched = [];
      const listener = () => dispatched.push("intent");
      window.addEventListener("dispatch-order-intent", listener);
      try {
        capture("shipping", SHIPPING);
      } finally {
        window.removeEventListener("dispatch-order-intent", listener);
      }

      expect([description, dispatched]).toEqual([description, expected]);
    },
  );

  test("a pick in the tile itself still dispatches its own pre-check", () => {
    render(true);
    mountTile();

    const dispatched = [];
    const listener = () => dispatched.push("intent");
    window.addEventListener("dispatch-order-intent", listener);
    try {
      panel().options.onSelect({
        text: BILLING.companyName,
        companyId: BILLING.companyId,
        lookupId: "lookup-billing",
      });
    } finally {
      window.removeEventListener("dispatch-order-intent", listener);
    }

    expect(dispatched).toEqual(["intent"]);
  });

  test("a delivery company the buyer discards takes the pair with it", () => {
    capture("shipping", SHIPPING);
    mountTile();

    env.identityFor("shipping").clear();

    expect(submittedPair()).toEqual({ name: "", id: "" });
  });

  test("a fresh page with no delivery form still submits the stored company", () => {
    // A reload onto the payment step, with no delivery form to hydrate its identity.
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({
        company_name: SHIPPING.companyName,
        company_id: SHIPPING.companyId,
        company_id_source: "registry",
      }),
    );

    const tile = mountTile();

    expect(env.identityFor("shipping").companyId()).toBe(SHIPPING.companyId);
    expect(tile.invoiceCompany().role).toBe("shipping");
    expect(submittedPair()).toEqual({
      name: SHIPPING.companyName,
      id: SHIPPING.companyId,
    });
  });

  test("a sole trader adopted in the delivery form submits and places", async () => {
    const capture = mountDeliveryCapture();
    const tile = mountTile();

    capture.soleTraderMode();
    capture.adoptSoleTrader(BUYER);

    expect(env.identityFor("shipping").soleTraderAdopted()).toBe(true);
    expect(tile.invoiceCompany().role).toBe("shipping");
    expect(submittedPair()).toEqual({
      name: BUYER.company_name,
      id: BUYER.organization_number,
    });
    expect(await placeOrder()).toBe(true);
  });

  test("a live sole-trader flow is not overwritten by the stored company", () => {
    const capture = mountDeliveryCapture();
    capture.soleTraderMode();
    // The address-book picker also writes this record, signup in flight or not.
    env.browserStorage.setItem(
      H.COMPANY_SELECTION_KEY,
      JSON.stringify({
        company_name: SHIPPING.companyName,
        company_id: SHIPPING.companyId,
        company_id_source: "registry",
      }),
    );

    const tile = mountTile();

    expect(env.identityFor("shipping").companyId()).toBe("");
    expect(tile.invoiceCompany().companyId).toBe("");
    expect(submittedPair()).toEqual({ name: "", id: "" });
  });

  test("the delivery watcher is disposed by the re-render that destroys the tile", () => {
    const tile = mountTile();
    const registry = window.twoGatewayInvoiceCompanyWatchers;
    expect(registry.has(tile.$root)).toBe(true);

    document.body.innerHTML = "";
    window.twoGatewayReapCaptureIdentityWatchers();

    expect(registry.size).toBe(0);
  });

  test("reading shipping writes nothing back to the billing panel", () => {
    capture("shipping", SHIPPING);

    const tile = mountTile();

    expect(env.identityFor("billing").companyName()).toBe("");
    expect(env.identityFor("billing").companyId()).toBe("");
    expect(tile.companyName).toBe("");
    expect(tile.companyId).toBe("");
  });

  test("a capture in the tile itself still wins over the delivery company", () => {
    render(true);
    capture("shipping", SHIPPING);
    mountTile();

    panel().options.onSelect({
      text: BILLING.companyName,
      companyId: BILLING.companyId,
      lookupId: "lookup-billing",
    });

    expect(window.twoGatewayResolveInvoiceCompany().role).toBe("billing");
    expect(submittedPair()).toEqual({
      name: BILLING.companyName,
      id: BILLING.companyId,
    });
  });

  test.each([
    [NOTHING, "nothing captured anywhere"],
    [SHIPPING, "a delivery company captured as well"],
  ])(
    "a stray number in the submitted field is never taken as a capture, with %s (%s)",
    (shipping, description) => {
      // No surface offers an editable identifier (ABN-564), so a value the
      // writer did not put there vouches for nothing and must not become the
      // company being placed for.
      render(true);
      capture("shipping", shipping);
      const tile = mountTile();

      document.getElementById("company_id").value = "99999999";

      expect([description, tile.invoiceCompany().companyId]).toEqual([
        description,
        shipping === NOTHING ? "" : shipping.companyId,
      ]);
    },
  );

  test.each([
    [
      "a re-render finding no tile capture",
      (tile) => {
        tile.mountCompanyPopover();
      },
    ],
    [
      "a tile capture the buyer discards",
      (tile, environment) => {
        environment.identityFor("billing").write(
          {
            companyName: BILLING.companyName,
            companyId: BILLING.companyId,
            companyIdSource: "registry",
          },
          { authoritative: true },
        );
        environment.identityFor("billing").clear();
      },
    ],
  ])("%s leaves the delivery company submitting", (description, act) => {
    render(true);
    capture("shipping", SHIPPING);
    const tile = mountTile();

    act(tile, env);

    expect([description, submittedPair()]).toEqual([
      description,
      { name: SHIPPING.companyName, id: SHIPPING.companyId },
    ]);
  });

  test("a name the buyer typed with nothing captured is left alone", () => {
    render(true);
    const tile = mountTile();

    document.getElementById("company_name").value = "Typed Trading Co";
    window.twoGatewayApplyInvoiceCompanyFields(tile);

    expect(document.getElementById("company_name").value) //
      .toBe("Typed Trading Co");
  });

  test("the writer blanks a pair it wrote itself when the capture goes", () => {
    // The other half of the rule above: what the writer put there is its to take back.
    capture("shipping", SHIPPING);
    const tile = mountTile();
    expect(submittedPair()).toEqual({
      name: SHIPPING.companyName,
      id: SHIPPING.companyId,
    });

    env.identityFor("shipping").clear();
    window.twoGatewayApplyInvoiceCompanyFields(tile);

    expect(submittedPair()).toEqual({ name: "", id: "" });
  });
});
