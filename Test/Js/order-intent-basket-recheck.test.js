/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-26296. The base prices an order intent from the quote at request time,
 * so a check sent when the company is picked, before shipping and tax are
 * known, is priced on a basket the order will not have. The tile re-checks
 * when a Magewire re-render carries a basket other than the one the company's
 * last check was sent under, and asks nothing when the basket is unchanged.
 *
 * The basket is the fingerprint gateway_method.phtml renders outside its
 * re-render-ignored form; these tests move it the way a re-render does, by
 * rewriting that element's attribute and firing Magewire's `element.updated`.
 */

"use strict";

const H = require("./hyva-harness");

const BASE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";
const METHOD_CODE = "two_payment";
const BASKET_ID = METHOD_CODE + "_intent_basket";

const COMPANY = { id: "111111111", name: "Alpha Ltd" };

/** A promise plus its resolver, so a test decides when each request settles. */
function deferred() {
  let resolve;
  const promise = new Promise(function (res) {
    resolve = res;
  });
  return { promise: promise, resolve: resolve };
}

/** @param {string} basket the fingerprint a re-render would carry */
function setBasket(basket) {
  document.getElementById(BASKET_ID).dataset.basket = basket;
}

describe("order intent re-check on a basket change (TWO-26296)", () => {
  let env;
  let fetchStub;
  let component;
  let calls;
  let replies;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="' +
        METHOD_CODE +
        '" checked />',
      '<span hidden id="' + BASKET_ID + '" data-basket="K1"></span>',
      '<form id="two_payment_form">',
      '  <input type="text" class="two-company-search" style="display:none" />',
      '  <input type="text" id="company_name" name="payment[company_name]" value="" />',
      '  <input type="text" id="company_id" name="payment[company_id]" value="" />',
      "</form>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});
    H.loadSharedHelpers();
    env.fireAlpineInit();

    const form = document.getElementById("two_payment_form");
    component = H.mountComponent(env.alpineComponents[BASE_COMPONENT], {
      el: form,
      root: form,
    });
    component.$watch = function () {};
    component.initialize(JSON.parse(H.QUOTE_JSON));

    // Captured per test: an earlier test's template evaluation leaves its
    // window listener behind, and it must not record into this test's arrays.
    const ownCalls = [];
    const ownReplies = [];
    calls = ownCalls;
    replies = ownReplies;
    component.placeOrderIntent = function () {
      ownCalls.push(component.orderIntentBasket());
      const reply = deferred();
      ownReplies.push(reply);
      return reply.promise;
    };
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  /** Pick the company the way onCompanyCommitted() does, past the debounce. */
  function pick() {
    component.companyName = COMPANY.name;
    component.companyId = COMPANY.id;
    component.fillCompanyData(COMPANY.id, COMPANY.name);
    jest.advanceTimersByTime(500);
  }

  /**
   * One re-render: move the basket, fire the hook once per touched element,
   * and let the dispatcher's debounce elapse.
   *
   * @param {string} basket
   * @param {number} [elements]
   */
  function rerender(basket, elements) {
    setBasket(basket);
    env.fireMagewireHook("element.updated", elements || 1);
    jest.advanceTimersByTime(500);
  }

  /** @param {number} index @param {boolean} approved */
  async function settle(index, approved) {
    replies[index].resolve({ approved: approved });
    await H.flushPromises();
  }

  test.each([
    [
      async () => {
        pick();
        await settle(0, true);
        rerender("K2");
      },
      ["K1", "K2"],
      "a basket moved after the decision landed is checked again",
    ],
    [
      async () => {
        pick();
        await settle(0, true);
        rerender("K1", 3);
      },
      ["K1"],
      "an identical re-render asks nothing",
    ],
    [
      async () => {
        pick();
        rerender("K2");
      },
      ["K1", "K2"],
      "a basket moved while the first check is in flight replaces it",
    ],
    [
      async () => {
        pick();
        await settle(0, true);
        rerender("K2", 5);
      },
      ["K1", "K2"],
      "one re-render touching many elements costs one request",
    ],
    [
      async () => {
        pick();
        await settle(0, true);
        rerender("K2");
        await settle(1, true);
        rerender("K2");
      },
      ["K1", "K2"],
      "the re-checked basket is not asked about again",
    ],
    [
      async () => {
        rerender("K2");
      },
      [],
      "no company, no request",
    ],
  ])("requests case %#", async (steps, expected, description) => {
    await steps();

    expect([description, calls]).toEqual([description, expected]);
  });

  test("a reply for the superseded basket stands for nothing", async () => {
    pick();
    rerender("K2");
    // The first basket's reply lands late and says no; it must not decide K2.
    await settle(0, false);
    expect(component.orderIntentRecordForCurrentCompany()).toBeNull();

    await settle(1, true);
    expect(component.orderIntentRecordForCurrentCompany()).toEqual({
      kind: "decision",
      approved: true,
    });
  });
});

describe("a decision stands only for the basket it was priced on (TWO-26296)", () => {
  let env;
  let fetchStub;
  let validators;
  let form;

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

    document.body.innerHTML = [
      '<input type="radio" name="payment-method-option" value="' +
        METHOD_CODE +
        '" checked />',
      '<span hidden id="' + BASKET_ID + '" data-basket="K2"></span>',
      '<form id="two_payment_form">',
      '  <input type="text" id="company_name" name="payment[company_name]" value="' +
        COMPANY.name +
        '" />',
      '  <input type="hidden" id="company_id" name="payment[company_id]"' +
        ' data-name="company_id" value="' +
        COMPANY.id +
        '" />',
      "</form>",
      '<button type="button" x-bind="buttonPlaceOrder">Place Order</button>',
    ].join("\n");

    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();

    const root = document.getElementById("two_payment_form");
    form = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: root,
      root: root,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    form.$watch = function () {};
    form.init();
    env.identityFor("billing").write(
      {
        companyName: COMPANY.name,
        companyId: COMPANY.id,
        companyIdSource: "registry",
      },
      { authoritative: true },
    );
    form.companyName = COMPANY.name;
  });

  afterEach(() => {
    delete window.hyvaCheckout;
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  test.each([
    ["K2", false, false, true, false, "a decline for this basket refuses"],
    ["K1", false, false, false, true, "a decline for an older basket still refuses until this one is answered"],
    ["K2", true, true, true, false, "an approval for this basket"],
    [
      "K1",
      true,
      true,
      false,
      true,
      "an approval for an older basket is no decision",
    ],
  ])(
    "decision case %#",
    async (basket, approved, allowed, decided, mayAsk, description) => {
      form.orderIntentDecisions = {
        [COMPANY.id]: {
          name: COMPANY.name,
          approved: approved,
          basket: basket,
        },
      };
      form.refreshOrderIntentVerdict();

      const button = document.querySelector('[x-bind="buttonPlaceOrder"]');
      const result = await validators[0]();

      expect([
        description,
        result,
        button.hasAttribute("disabled"),
        form.orderIntentRecordForCurrentCompany() !== null,
        !form.hasOrderIntentDecisionFor(COMPANY.id, COMPANY.name),
      ]).toEqual([description, allowed, !allowed, decided, mayAsk]);
    },
  );

  test.each([
    [null, false, "no answer yet for the new basket: the old decline still holds"],
    [{ approved: true, basket: "K2" }, true, "an approval for the new basket lifts it"],
    [{ approved: false, basket: "K2" }, false, "a decline for the new basket keeps it"],
    ["failure", true, "a failed re-check places, as any failure does"],
  ])(
    "after the basket moves, answer %j leaves placement allowed=%s (%s)",
    async (answer, allowed, description) => {
      form.orderIntentDecisions = {
        [COMPANY.id]: { name: COMPANY.name, approved: false, basket: "K1" },
      };
      setBasket("K1");
      form.refreshOrderIntentVerdict();
      const button = document.querySelector('[x-bind="buttonPlaceOrder"]');
      expect(button.hasAttribute("disabled")).toBe(true);

      // The new basket arrives; no company changed, so only the re-check path runs.
      setBasket("K2");
      form.fillCompanyData("", "", true);
      if (answer === "failure") {
        form.orderIntentFailures = { [COMPANY.id]: { name: COMPANY.name } };
      } else if (answer) {
        form.orderIntentDecisions = {
          [COMPANY.id]: { name: COMPANY.name, approved: answer.approved, basket: answer.basket },
        };
      }
      form.applyOrderIntentPlacementGate();

      const result = await validators[0]();
      expect([description, result, button.hasAttribute("disabled")]).toEqual([
        description,
        allowed,
        !allowed,
      ]);
    },
  );
});
