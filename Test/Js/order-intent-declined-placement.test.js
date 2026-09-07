/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25657. A declined order intent refuses Place Order, per company.
 */

"use strict";

const H = require("./hyva-harness");

const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const METHOD_CODE = "two_payment";
const DECLINED_MESSAGE = "SENTINEL-declined";

const COMPANY_A = { id: "111111111", name: "Alpha Ltd" };
const COMPANY_B = { id: "222222222", name: "Beta Ltd" };

describe("placement after an order-intent decline", () => {
  let env;
  let fetchStub;
  let validators;

  /**
   * @param {Object} company the company whose number the tile submits
   */
  function render(company) {
    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="' +
        METHOD_CODE +
        '" checked />',
      '<form id="two_payment_form">',
      '  <input type="text" id="company_name" name="payment[company_name]" value="' +
        company.name +
        '" />',
      '  <input type="text" id="company_id" name="payment[company_id]"' +
        ' data-name="company_id" value="' +
        company.id +
        '" />',
      "</form>",
      // Hyva's own place-order button, which carries no disabled binding of its own.
      '<button type="button" x-bind="buttonPlaceOrder">Place Order</button>',
    ].join("\n");
  }

  beforeEach(() => {
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    validators = [];
    window.hyvaCheckout = {
      navigation: {
        addTask: function () {},
        disableButtonPlaceOrder: jest.fn(),
        enableButtonPlaceOrder: jest.fn(),
      },
      validation: {
        register: function (name, callback) {
          validators.push(callback);
        },
      },
    };

    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();
  });

  afterEach(() => {
    delete window.hyvaCheckout;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * Mount the form component with the given verdict records and run the
   * validator Place Order runs.
   *
   * @param {Object} company the company on screen
   * @param {Object} decisions `orderIntentDecisions`, keyed by company id
   * @returns {Promise<boolean>}
   */
  function placeOrder(company, decisions) {
    const form = mountForm();
    showCompany(form, company, decisions);

    expect(validators.length).toBe(1);

    return validators[0]();
  }

  /**
   * @returns {Object} the mounted form component
   */
  function mountForm() {
    const root = document.getElementById("two_payment_form");
    const form = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: root,
      root: root,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    form.$watch = function () {};
    form.init();
    form.orderIntentDeclinedMessage = DECLINED_MESSAGE;
    return form;
  }

  /**
   * Put one company and one set of verdict records on screen.
   *
   * @param {Object} form the mounted form component
   * @param {Object} company the company the tile submits
   * @param {Object} decisions `orderIntentDecisions`, keyed by company id
   */
  function showCompany(form, company, decisions) {
    document.getElementById("company_name").value = company.name;
    document.getElementById("company_id").value = company.id;
    form.companyName = company.name;
    form.orderIntentDecisions = decisions;
  }

  test.each([
    [COMPANY_A, {}, true, false, "no decision yet — an unanswered check"],
    [
      COMPANY_A,
      { [COMPANY_A.id]: { name: COMPANY_A.name, approved: true } },
      true,
      false,
      "approved",
    ],
    [
      COMPANY_A,
      { [COMPANY_A.id]: { name: COMPANY_A.name, approved: false } },
      false,
      true,
      "declined",
    ],
    [
      COMPANY_B,
      {
        [COMPANY_A.id]: { name: COMPANY_A.name, approved: false },
        [COMPANY_B.id]: { name: COMPANY_B.name, approved: true },
      },
      true,
      false,
      "A declined does not block B approved",
    ],
    [
      COMPANY_A,
      { [COMPANY_A.id]: { name: "Renamed Ltd", approved: false } },
      true,
      false,
      "a decline recorded under another name is no verdict",
    ],
  ])(
    "placement case %#",
    async (company, decisions, allowed, messaged, description) => {
      render(company);

      const result = await placeOrder(company, decisions);

      expect([description, result]).toEqual([description, allowed]);

      const texts = env.messages
        .reduce((all, payload) => all.concat(payload), [])
        .map((message) => message.text);

      expect([description, texts.indexOf(DECLINED_MESSAGE) !== -1]) //
        .toEqual([description, messaged]);
    },
  );

  test("the refusal is dispatched as an error, not a notice", async () => {
    render(COMPANY_A);

    await placeOrder(COMPANY_A, {
      [COMPANY_A.id]: { name: COMPANY_A.name, approved: false },
    });

    const dispatched = env.messages
      .reduce((all, payload) => all.concat(payload), [])
      .filter((message) => message.text === DECLINED_MESSAGE);

    expect(dispatched.map((message) => message.type)).toEqual(["error"]);
  });

  const DECLINED_A = { [COMPANY_A.id]: { name: COMPANY_A.name, approved: false } };
  const APPROVED_A = { [COMPANY_A.id]: { name: COMPANY_A.name, approved: true } };

  /**
   * Apply a sequence of on-screen states, re-deriving after each.
   *
   * @param {Array<Array>} steps `[company, decisions]` pairs, in order
   * @returns {Element} Hyva's Place Order button
   */
  function applySteps(steps) {
    render(steps[0][0]);
    const form = mountForm();

    steps.forEach(([company, decisions]) => {
      showCompany(form, company, decisions);
      form.refreshOrderIntentVerdict();
    });

    return document.querySelector('[x-bind="buttonPlaceOrder"]');
  }

  test.each([
    [[[COMPANY_A, {}]], false, "no decision yet — placement is untouched"],
    [[[COMPANY_A, APPROVED_A]], false, "approved"],
    [[[COMPANY_A, DECLINED_A]], true, "declined"],
    [
      [
        [COMPANY_A, DECLINED_A],
        [COMPANY_A, APPROVED_A],
      ],
      false,
      "approved after a decline re-enables",
    ],
    [
      [
        [COMPANY_A, DECLINED_A],
        [COMPANY_B, DECLINED_A],
      ],
      false,
      "a company change clears the decline",
    ],
  ])("place order disabled case %#", (steps, disabled, description) => {
    const button = applySteps(steps);

    expect([description, button.hasAttribute("disabled")]) //
      .toEqual([description, disabled]);
  });

  test("the decline is signalled through Hyva's own navigation API", () => {
    applySteps([[COMPANY_A, DECLINED_A]]);

    expect(window.hyvaCheckout.navigation.disableButtonPlaceOrder).toHaveBeenCalled();

    applySteps([[COMPANY_A, APPROVED_A]]);

    expect(window.hyvaCheckout.navigation.enableButtonPlaceOrder).toHaveBeenCalled();
  });
});
