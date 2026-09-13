/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * ABN-554. `setPaymentData` is the ONLY writer of the captured company number
 * into the quote's payment, and the server refuses placement without it.
 */

"use strict";

const H = require("./hyva-harness");

const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const METHOD_CODE = "two_payment";
const BLOCK_NAME = "checkout.payment.method.two_payment";

describe("what the payment form persists to the quote", () => {
  let env;
  let fetchStub;
  let calls;
  let tasks;
  let validators;

  /**
   * @param {string} companyId the captured company number
   * @param {string} intentFlag the `$isOrderIntentEnabled` the PHP emits
   */
  function render(companyId, intentFlag) {
    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="' +
        METHOD_CODE +
        '" checked />',
      '<form id="two_payment_form">',
      '  <input type="text" id="company_name" name="payment[company_name]"' +
        ' value="Example Trading Ltd" />',
      '  <input type="text" id="company_id" name="payment[company_id]" value="' +
        companyId +
        '" />',
      "</form>",
    ].join("\n");

    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE, [
      [/^\$isOrderIntentEnabled$/, intentFlag],
    ]);
    env.fireAlpineInit();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    calls = [];
    tasks = [];
    validators = [];
    // The harness component double records `set()` only; placement goes
    // through `call()`.
    window.Magewire.find = function (id) {
      return {
        call: function (method, payload) {
          calls.push({ id: id, method: method, payload: payload });
          return Promise.resolve();
        },
      };
    };
    window.hyvaCheckout = {
      navigation: {
        addTask: function (task) {
          tasks.push(task);
        },
      },
      validation: {
        register: function (name, callback) {
          validators.push(callback);
        },
      },
    };
  });

  afterEach(() => {
    delete window.hyvaCheckout;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * Mount the form, run the navigation task Place Order runs, then the
   * validator that decides whether placement proceeds.
   *
   * @returns {Promise<boolean>} whether placement was allowed
   */
  async function placeOrder() {
    const root = document.getElementById("two_payment_form");
    const form = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: root,
      root: root,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    form.$watch = function () {};
    form.init();

    expect(tasks.length).toBe(1);
    const saved = tasks[0].call(form);
    // The task defers its field read by a second before calling Magewire.
    await jest.advanceTimersByTimeAsync(1000);
    await saved;

    expect(validators.length).toBe(1);
    return validators[0]();
  }

  test.each([
    ["1", "123456789", "123456789", true, "order intent on"],
    ["", "123456789", "123456789", true, "order intent off"],
    ["1", "", "", false, "order intent on, no number captured"],
    ["", "", "", false, "order intent off, no number captured"],
  ])(
    "intent=%p company=%p -> persists %p, placeable %p (%s)",
    async (intentFlag, companyId, persisted, placeable) => {
      render(companyId, intentFlag);

      await expect(placeOrder()).resolves.toBe(placeable);

      expect(calls).toEqual([
        {
          id: BLOCK_NAME,
          method: "setPaymentData",
          payload: {
            additionalData: expect.objectContaining({
              companyId: persisted,
              organization_number: persisted,
            }),
          },
        },
      ]);
    },
  );

});
