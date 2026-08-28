/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326: the buyer is TOLD to select a company, rather than meeting a
 * bare required-field error or nothing at all.
 *
 * Neither markup mode gets there on `required` alone. In the default mode the
 * company pair is hidden inputs, which carry no validation; in tile mode the
 * field is required but a native error names the field, not the fix. The
 * refusal itself lives server-side either way — this is the message that keeps
 * the buyer from ever reaching it.
 */

"use strict";

const H = require("./hyva-harness");

const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const METHOD_CODE = "two_payment";
const COMPANY_REQUIRED_MESSAGE = "Select a company first";

describe("the no-company-number message", () => {
  let env;
  let fetchStub;
  let form;
  let root;
  let validators;

  /**
   * @param {string|null} companyId the field's value, or null for no field
   * @param {string} selectedMethod the checked payment-method radio's value
   */
  function render(companyId, selectedMethod) {
    const companyField =
      companyId === null
        ? ""
        : '<input type="text" name="payment[company_id]" data-name="company_id"' +
          ' value="' +
          companyId +
          '" />';

    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="' +
        selectedMethod +
        '" checked />',
      '<form id="two_payment_form">',
      '  <input type="text" id="company_name" value="" />',
      "  " + companyField,
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
   * Mount the form component and run the validator Place Order runs.
   *
   * @returns {Promise<boolean>}
   */
  function placeOrder() {
    root = document.getElementById("two_payment_form");
    form = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: root,
      root: root,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    form.$watch = function () {};
    form.init();

    expect(validators.length).toBe(1);

    return validators[0]();
  }

  test.each([
    ["", METHOD_CODE, false, true, "no company at all"],
    ["   ", METHOD_CODE, false, true, "whitespace only"],
    [null, METHOD_CODE, false, true, "no company field in the markup"],
    ["123456789", METHOD_CODE, true, false, "a registered company number"],
    ["TWO:ST:abc123", METHOD_CODE, true, false, "an internal identifier"],
    ["", "other_method", true, false, "another method is selected"],
  ])(
    "%s / %s: placement allowed=%s, message=%s (%s)",
    async (companyId, selectedMethod, allowed, messaged, description) => {
      render(companyId, selectedMethod);

      const result = await placeOrder();

      expect([description, result]).toEqual([description, allowed]);

      const texts = env.messages
        .reduce((all, payload) => all.concat(payload), [])
        .map((message) => message.text);

      expect([description, texts.indexOf(COMPANY_REQUIRED_MESSAGE) !== -1]) //
        .toEqual([description, messaged]);
    },
  );

  test("the message the buyer sees is the one the template carries", () => {
    // The refusal is only useful if it names the fix, so pin the string that
    // reaches dispatchMessages rather than merely that something was shown.
    const script = H.renderTemplateJs(H.GATEWAY_METHOD_TEMPLATE);

    expect(script.indexOf(COMPANY_REQUIRED_MESSAGE)).toBeGreaterThan(-1);
  });

  test("the message is dispatched as an error, not a notice", async () => {
    render("", METHOD_CODE);

    await placeOrder();

    const dispatched = env.messages
      .reduce((all, payload) => all.concat(payload), [])
      .filter((message) => message.text === COMPANY_REQUIRED_MESSAGE);

    expect(dispatched.map((message) => message.type)).toEqual(["error"]);
  });
});
