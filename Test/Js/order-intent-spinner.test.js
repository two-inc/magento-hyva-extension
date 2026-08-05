/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 tile bugfix batch, bug 5 + cross-platform requirement 11.
 *
 * Bug 5: the order-intent check had no visible progress indicator at all on
 * Hyvä. A buyer who picked a company sat looking at an unchanged tile for
 * however long the decision took, with no way to tell it was working.
 *
 * Requirement 11 is the standing cross-platform rule about the fix: the
 * indicator must be LOCAL to the payment tile, never a page-covering overlay.
 * The reason is the same one that made the company-search spinner an in-field
 * element rather than `magewire:loader:start` — a full-screen overlay over a
 * checkout the buyer is still filling in blocks interaction for a background
 * check they did not ask for. So this file asserts both halves: that the
 * indicator exists and is driven by real request state, AND that the intent path
 * dispatches no magewire loader event.
 *
 * The lifecycle assertions run against the REAL module-level dispatcher, because
 * that is what owns the flag once a request is on the wire; `placeOrderIntent()`
 * is the seam.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/** The indicator's own gate, read out of the shipped markup. */
const CHECKING_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="order_intent_checking"]',
  "x-show",
);

/** A promise plus its resolver, so a test decides when the request settles. */
function deferred() {
  let resolve;
  const promise = new Promise(function (res) {
    resolve = res;
  });
  return { promise: promise, resolve: resolve };
}

describe("order-intent progress indicator (bug 5 / requirement 11)", () => {
  describe("the shipped markup", () => {
    let doc;

    beforeAll(() => {
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
      doc = new DOMParser().parseFromString(markup, "text/html");
    });

    test("the indicator is inside the payment tile, not a page-level overlay", () => {
      const indicator = doc.querySelector('[data-name="order_intent_checking"]');
      expect(indicator).not.toBeNull();

      // Inside the tile's own root — the element that carries the tile
      // component. An indicator rendered as a sibling of the tile, or appended
      // to `<body>`, is the page overlay requirement 11 forbids.
      const tileRoot = doc.querySelector(".payment-method-custom-form");
      expect(tileRoot).not.toBeNull();
      expect(tileRoot.contains(indicator)).toBe(true);

      // Nothing that would make it cover the page. `fixed`/`inset-0` are the
      // Tailwind utilities an overlay is built from, and this element carries
      // neither; it is in the tile's normal flow.
      const classes = indicator.getAttribute("class") || "";
      expect(classes).not.toMatch(/\bfixed\b/);
      expect(classes).not.toMatch(/\binset-0\b/);
    });

    test("it announces itself rather than being a bare decorative GIF", () => {
      const indicator = doc.querySelector('[data-name="order_intent_checking"]');

      // Same treatment as the two intent verdict notices it precedes: a live
      // region with real text. The GIF alone tells a screen-reader user
      // nothing, which is why the spinner span is `aria-hidden` and the
      // sentence beside it is not.
      expect(indicator.getAttribute("role")).toBe("status");
      expect(indicator.textContent.trim().length).toBeGreaterThan(0);

      const spinner = indicator.querySelector(".two-company-search__spinner");
      expect(spinner).not.toBeNull();
      expect(spinner.getAttribute("aria-hidden")).toBe("true");
      // Childless: the class paints a `background-image`, and a background
      // image needs no child nodes.
      expect(spinner.childNodes.length).toBe(0);
    });

    test("its gate is a bare property the component actually defines", () => {
      // `readAlpineBinding` already refused anything but a bare property name.
      // What it cannot check is that the component HAS that property — a
      // binding resolving to `undefined` is exactly as invisible as a missing
      // one, and this repo has shipped that before.
      const env = H.installHyvaEnvironment();
      try {
        H.loadSharedHelpers();
        env.fireAlpineInit();
        const component = H.mountComponent(
          env.alpineComponents[COMPONENT_NAME],
          {},
        );
        expect(typeof component[CHECKING_SHOW_BINDING]).toBe("boolean");
        expect(component[CHECKING_SHOW_BINDING]).toBe(false);
      } finally {
        env.restore();
      }
    });
  });

  describe("the lifecycle", () => {
    let env;
    let component;
    let form;

    beforeEach(() => {
      jest.useFakeTimers();
      document.body.innerHTML = [
        '<input type="radio" name="payment-method-option" value="two_payment" checked />',
        '<form id="two_payment_form">',
        '  <input type="text" class="two-company-search" style="display:none" />',
        '  <input type="text" id="company_name" name="payment[company_name]" value="" />',
        '  <input type="text" id="company_id" name="payment[company_id]" value="" />',
        "</form>",
      ].join("\n");

      env = H.installHyvaEnvironment();
      jest.spyOn(console, "error").mockImplementation(() => {});
      H.loadSharedHelpers();
      env.fireAlpineInit();

      form = document.getElementById("two_payment_form");
      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: form,
        root: form,
      });
      component.$watch = function () {};
      component.initialize(JSON.parse(H.QUOTE_JSON));
    });

    afterEach(() => {
      env.restore();
      jest.useRealTimers();
      document.body.innerHTML = "";
    });

    test("goes up on the pick, not 500ms later when the request leaves", () => {
      component.placeOrderIntent = function () {
        return deferred().promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");

      // Before the dispatcher's debounce has elapsed. Half a second of a tile
      // that has visibly not reacted to the pick is the complaint.
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);
    });

    test("comes down when the request settles", async () => {
      const request = deferred();
      component.placeOrderIntent = function () {
        return request.promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      jest.advanceTimersByTime(500);
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);

      request.resolve({ approved: true });
      await H.flushPromises();

      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("a superseded request finishing late does not take it down", async () => {
      const first = deferred();
      const second = deferred();
      let call = 0;
      component.placeOrderIntent = function () {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      jest.advanceTimersByTime(500);

      component.companyName = "Company B";
      component.companyId = "222222222";
      component.fillCompanyData("222222222", "Company B");
      jest.advanceTimersByTime(500);

      first.resolve({ approved: true });
      await H.flushPromises();

      // B's check is genuinely still running. Lowering the indicator here would
      // tell the buyer a decision has been reached when none has.
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);

      second.resolve({ approved: true });
      await H.flushPromises();
      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("a dispatch that declines to request takes it down again", () => {
      let calls = 0;
      component.placeOrderIntent = function () {
        calls += 1;
        return deferred().promise;
      };

      // Order intent switched off for the merchant: the dispatcher makes no
      // request at all, so an indicator raised by fillCompanyData() would spin
      // for the rest of the session.
      component.isOrderIntentEnabled = "";
      component.orderIntentChecking = true;
      window.dispatchEvent(new Event("dispatch-order-intent"));
      jest.advanceTimersByTime(500);

      expect(calls).toBe(0);
      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("nothing on the intent path raises the page-wide magewire loader", async () => {
      const request = deferred();
      component.placeOrderIntent = function () {
        return request.promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      jest.advanceTimersByTime(500);
      request.resolve({ approved: true });
      await H.flushPromises();

      // The harness records `magewire:loader:start` / `:done` as a sequence.
      // Requirement 11: this check must never reach for that overlay.
      expect(env.loaderEvents).toEqual([]);
    });
  });
});
