/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326. The gate reads the company NUMBER, never the name, and never
 * the field's own `required` — the default markup mode's company pair is
 * hidden inputs, which carry no validation at all.
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
   * @param {string} [companyName] the name the buyer captured
   */
  function render(companyId, selectedMethod, companyName) {
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
      '  <input type="text" id="company_name" name="payment[company_name]" value="' +
        (companyName || "") +
        '" />',
      "  " + companyField,
      "</form>",
    ].join("\n");
  }

  /** Make hyva.formValidation report the rest of the form invalid. */
  function failFieldValidation() {
    global.hyva.formValidation = function () {
      return {
        validate: function () {
          return Promise.reject(new Error("field-level failure"));
        },
      };
    };
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
    ["", "", METHOD_CODE, false, true, "no company at all"],
    ["   ", "", METHOD_CODE, false, true, "whitespace only"],
    [null, "", METHOD_CODE, false, true, "no company field in the markup"],
    // The search response is allowed to omit the national identifier, so a
    // named company with no number is a real state and is NOT a number.
    [
      "",
      "Example Trading Ltd",
      METHOD_CODE,
      false,
      true,
      "a name but no number",
    ],
    ["123456789", "", METHOD_CODE, true, false, "a registered company number"],
    ["TWO:ST:abc123", "", METHOD_CODE, true, false, "an internal identifier"],
    ["", "", "other_method", true, false, "another method is selected"],
  ])(
    "%s / %s / %s: placement allowed=%s, message=%s (%s)",
    async (
      companyId,
      companyName,
      selectedMethod,
      allowed,
      messaged,
      description,
    ) => {
      render(companyId, selectedMethod, companyName);

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
    const script = H.renderTemplateJs(H.GATEWAY_METHOD_TEMPLATE);

    expect(script.indexOf(COMPANY_REQUIRED_MESSAGE)).toBeGreaterThan(-1);
  });

  test("a field-level failure still blocks placement on its own", async () => {
    // Given no company gate to trip, when the rest of the form is invalid,
    // then placement is refused and no company message is invented.
    failFieldValidation();
    render("123456789", METHOD_CODE, "Example Trading Ltd");

    expect(await placeOrder()).toBe(false);
    expect(env.messages).toEqual([]);
  });

  test("both failures are reported in one submit", async () => {
    // The company check runs even on an invalid form, so a buyer missing both
    // does not have to submit twice to learn about the second one.
    failFieldValidation();
    render("", METHOD_CODE);

    expect(await placeOrder()).toBe(false);

    const texts = env.messages
      .reduce((all, payload) => all.concat(payload), [])
      .map((message) => message.text);

    expect(texts).toEqual([COMPANY_REQUIRED_MESSAGE]);
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
