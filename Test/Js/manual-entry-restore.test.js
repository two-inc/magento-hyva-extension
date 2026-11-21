/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-26775: manual entry is name-only capture, so no company number from an
 * earlier pick or sole trader may be carried into it. Two routes did:
 *
 *  - a stored record merges field by field, so one can say manual entry and
 *    still hold an earlier number, and every restore wrote that number back;
 *  - the invoice resolver fell back from a billing panel with no number to the
 *    delivery company, so a name typed into the invoice panel went out under
 *    the delivery company's number.
 */

"use strict";

const H = require("./hyva-harness");

const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";

const KEYS = {
  shipping: H.COMPANY_SELECTION_KEY,
  billing: H.BILLING_COMPANY_KEY,
};

describe("what a stored record restores", () => {
  let env;

  beforeEach(() => {
    env = H.installHyvaEnvironment();
    H.loadSharedHelpers();
  });

  afterEach(() => env.restore());

  test.each([
    [
      {
        company_name: "Typed",
        company_id: "111",
        company_id_source: "registry",
        manual_mode: true,
      },
      { companyName: "Typed", companyId: "", companyIdSource: "" },
      "manual entry restores its name alone",
    ],
    [
      {
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
        manual_mode: false,
      },
      {
        companyName: "Acme Ltd",
        companyId: "111",
        companyIdSource: "registry",
      },
      "a registered pick restores its number",
    ],
    [
      {
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      },
      {
        companyName: "Acme Ltd",
        companyId: "111",
        companyIdSource: "registry",
      },
      "a record with no mode is a registered pick",
    ],
    [
      {},
      { companyName: "", companyId: "", companyIdSource: "" },
      "an empty record restores nothing",
    ],
  ])("%j restores %j (%s)", (record, expected, why) => {
    expect([why, window.twoGatewayRecordedCompany(record)]).toEqual([
      why,
      expected,
    ]);
  });
});

describe("the address step's restore and the invoice resolver", () => {
  let env;
  let fetchStub;

  /** One address panel with its own capture control; the role is read off the id prefix. */
  function addressPanel(role) {
    return [
      '<form id="' + role + '-form">',
      '  <select id="' + role + '-country_id" name="' + role + '[country_id]">',
      '    <option value="GB" selected>x</option>',
      "  </select>",
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

  function controller(role) {
    return window.twoGatewayCompanyCaptureInstances[role];
  }

  beforeEach(() => {
    // Billing an address of its own, as the invoice panel's own form means.
    document.body.innerHTML =
      '<input type="checkbox" id="billing-as-shipping" />' +
      addressPanel("shipping") +
      addressPanel("billing");
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    document.body.innerHTML = "";
  });

  test.each([
    [
      "shipping",
      true,
      ["manual", "Typed", ""],
      "a record saying manual entry brings back no number",
    ],
    [
      "billing",
      true,
      ["manual", "Typed", ""],
      "the same on the invoice panel's own record",
    ],
    [
      "shipping",
      false,
      ["registered", "Typed", "111"],
      "a registered pick keeps its number",
    ],
  ])("%s, manual %p: restores %j (%s)", (role, manual, expected, why) => {
    env.browserStorage.setItem(
      KEYS[role],
      JSON.stringify({
        company_name: "Typed",
        company_id: "111",
        company_id_source: "registry",
        manual_mode: manual,
      }),
    );

    mountPanel(role);

    const identity = env.identityFor(role);
    expect([
      why,
      [identity.captureMode(), identity.companyName(), identity.companyId()],
    ]).toEqual([why, expected]);
  });

  test.each([
    [
      "manual",
      { companyName: "Typed Name", companyId: "", role: "billing" },
      "manual entry answers with its own name, no number",
    ],
    [
      "soletrader-over-manual",
      { companyName: "Typed Name", companyId: "", role: "billing" },
      "so does a Sole trader click pending over it",
    ],
    [
      "registered",
      { companyName: "Delivery Ltd", companyId: "22222222", role: "shipping" },
      "a billing panel holding no number in search mode falls back",
    ],
    [
      "manual, then billing-as-shipping ticked",
      { companyName: "Delivery Ltd", companyId: "22222222", role: "shipping" },
      "once billing is the delivery address, the delivery company is the invoice company",
    ],
  ])("billing in %s resolves %j (%s)", (mode, expected, why) => {
    mountPanel("shipping");
    mountPanel("billing");
    env
      .identityFor("shipping")
      .write(
        { companyName: "Delivery Ltd", companyId: "22222222" },
        { authoritative: true },
      );
    env
      .identityFor("billing")
      .write({ companyName: "Typed Name" }, { authoritative: true });
    if (mode !== "registered") controller("billing").manualEntryMode();
    if (mode === "soletrader-over-manual")
      controller("billing").soleTraderMode();
    if (mode.endsWith("ticked")) {
      document.getElementById("billing-as-shipping").checked = true;
      document.getElementById("billing-form").remove();
    }

    const resolved = window.twoGatewayResolveInvoiceCompany();

    expect([
      why,
      {
        companyName: resolved.companyName,
        companyId: resolved.companyId,
        role: resolved.role,
      },
    ]).toEqual([why, expected]);
  });
});

describe("the payment tile's restore (TWO-26775)", () => {
  const TILE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
  let env;
  let fetchStub;

  /** The tile hosting its own control, as it does with address-step search off. */
  function render() {
    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="two_payment" checked />',
      '<input id="shipping-country_id" value="GB" />',
      '<form id="two_payment_form"><div id="payment-root">',
      '  <div class="two-company-search" data-two-capture-host="tile">',
      '    <input type="text" id="company_name" name="payment[company_name]" data-two-capture-field value="" />',
      "  </div>",
      '  <input type="text" id="company_id" name="payment[company_id]" data-name="company_id" value="" />',
      "</div></form>",
    ].join("\n");
  }

  beforeEach(() => {
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    render();
    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    delete window.twoGatewayInvoiceCompanyWritten;
    delete window.twoGatewayInvoiceCompanyWatchers;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  test.each([
    [
      true,
      "",
      "a record saying manual entry puts no number back after the tick",
    ],
    [false, "111", "a registered pick's number is restored"],
  ])(
    "manual %p: the submitted number and the intent's are %p (%s)",
    (manual, expected, why) => {
      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
        JSON.stringify({
          company_name: "Typed",
          company_id: "111",
          company_id_source: "registry",
          manual_mode: manual,
        }),
      );
      const root = document.getElementById("payment-root");
      const tile = H.mountComponent(env.alpineComponents[TILE_COMPONENT], {
        el: root,
        root: root,
      });
      // Alpine runs a tick after the current one, not inside it: the seed and
      // the mirror run first, then the tick's restore.
      const ticks = [];
      tile.$nextTick = (fn) => {
        ticks.push(fn);
        return Promise.resolve();
      };
      tile.$watch = function () {};
      tile.initialize(JSON.parse(H.QUOTE_JSON));
      ticks.splice(0).forEach((fn) => fn());

      const intent = tile.buildOrderIntentRequestBody(JSON.parse(H.QUOTE_JSON))
        .buyer.company;
      expect([
        why,
        document.getElementById("company_id").value,
        intent.organization_number || "",
      ]).toEqual([why, expected, expected]);
    },
  );
});
