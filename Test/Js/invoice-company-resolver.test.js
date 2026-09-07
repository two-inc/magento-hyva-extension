/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25554. WHICH of the two captured companies the order is placed for:
 * billing when it presents a company number, else shipping.
 *
 * The default checkout path is the one that was broken — `#billing-as-shipping`
 * ticked, the company picked in the DELIVERY form — because the tile seeded
 * only from its own billing record and the pair that submits stayed blank.
 */

"use strict";

const H = require("./hyva-harness");

const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const METHOD_CODE = "two_payment";

const BILLING = { companyName: "Invoice GmbH", companyId: "11111111" };
const SHIPPING = { companyName: "Delivery Ltd", companyId: "22222222" };
const NAME_ONLY = { companyName: "Unnumbered Ltd", companyId: "" };
const NOTHING = { companyName: "", companyId: "" };

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
    env.fireAlpineInit();
  });

  afterEach(() => {
    delete window.hyvaCheckout;
    delete window.twoGatewayInvoiceCompanyWritten;
    delete window.twoGatewayInvoiceCompanyWatcher;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  test.each([
    [BILLING, SHIPPING, "billing", BILLING, true, "billing presents a number"],
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
    async (billing, shipping, role, expected, allowed, description) => {
      capture("billing", billing);
      capture("shipping", shipping);

      const tile = mountTile();

      expect([description, window.twoGatewayResolveInvoiceCompany()]).toEqual([
        description,
        {
          companyName: expected.companyName,
          companyId: expected.companyId,
          companyIdSource: expected.companyId ? "registry" : "",
          role: role,
        },
      ]);
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
      expect([description, await placeOrder()]).toEqual([description, allowed]);
    },
  );

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

  test("a delivery company the buyer discards leaves the pair with it", () => {
    capture("shipping", SHIPPING);
    mountTile();

    env.identityFor("shipping").clear();

    expect(submittedPair()).toEqual({ name: "", id: "" });
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
    "a number typed into the tile's own field outranks %s (%s)",
    (shipping, description) => {
      render(true);
      capture("shipping", shipping);
      const tile = mountTile();

      document.getElementById("company_id").value = "99999999";
      window.twoGatewayApplyInvoiceCompanyFields(tile);

      expect([description, document.getElementById("company_id").value]) //
        .toEqual([description, "99999999"]);
      expect([description, tile.invoiceCompany()]).toEqual([
        description,
        {
          companyName: "",
          companyId: "99999999",
          companyIdSource: "manual",
          role: "typed",
        },
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
