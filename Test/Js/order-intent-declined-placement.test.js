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
    ].join("\n");
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
    const root = document.getElementById("two_payment_form");
    const form = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: root,
      root: root,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    form.$watch = function () {};
    form.init();
    form.companyName = company.name;
    form.orderIntentDecisions = decisions;
    form.orderIntentDeclinedMessage = DECLINED_MESSAGE;

    expect(validators.length).toBe(1);

    return validators[0]();
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
});
