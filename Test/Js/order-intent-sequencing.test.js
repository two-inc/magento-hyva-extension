/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 tile bugfix batch, bug 4. Doug's repro on a real Hyvä checkout:
 * selecting company A fires a correct order-intent check; selecting a DIFFERENT
 * company afterwards fires none at all.
 *
 * Root cause: the module-level `dispatch-order-intent` listener held a boolean
 * `orderIntentInProgress` mutex and, inside its 500ms debounce callback, did
 * `if (orderIntentInProgress) return`. A second selection made while the first
 * company's decision was still on the wire was therefore DISCARDED — not queued,
 * not retried — so the tile went on showing company A's verdict for company B.
 * And when A's decision finally landed, `processOrderIntentSuccessResponse()`
 * filed it against whatever `this.companyId` happened to be by then (B), which
 * pinned the per-company dedup gate to B and suppressed B's own check for the
 * rest of the session even if the buyer tried again.
 *
 * The fix is a monotonic `orderIntentSeq`: overlapping requests are allowed
 * (they are idempotent reads of a decision), and out-of-order REPLIES are
 * dropped. Same guard, and the same reasoning, as the one the PrestaShop plugin
 * adopted for its own order-intent leg on this ticket.
 *
 * These tests drive the REAL listener in the shipped template — the sequencing
 * lives there, not on the component, so a suite that only called
 * `processOrderIntentSuccessResponse()` by hand could not fail for any of this.
 * `placeOrderIntent()` is the seam: it is stubbed with hand-settled deferreds so
 * each of two overlapping requests resolves exactly when the test says.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/** Notice copy, so an approval produces text a test can tell apart per company. */
const NOTICE_COPY = {
  withCompany: "Approved for {{name}} ({{number}})",
  withoutCompany: "Approved",
  companyNameToken: "{{name}}",
  companyNumberToken: "{{number}}",
};

/** A promise plus its resolver, so a test decides when each request settles. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(function (res, rej) {
    resolve = res;
    reject = rej;
  });
  return { promise: promise, resolve: resolve, reject: reject };
}

describe("order-intent sequencing (bug 4)", () => {
  let env;
  let component;
  let form;

  beforeEach(() => {
    jest.useFakeTimers();

    // The listener refuses to run unless the Two method is the checked payment
    // option, and reads the company id out of `#company_id` when component
    // state has none — both are production preconditions, not scaffolding.
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
    // initialize() is what publishes the instance the module-level listener
    // reaches, so it cannot be skipped here. `$watch` is not supplied by the
    // harness on purpose; the notice-clearing watchers are exercised elsewhere.
    component.$watch = function () {};
    component.initialize(JSON.parse(H.QUOTE_JSON));
    component.orderIntentApprovedNoticeCopy = NOTICE_COPY;
  });

  afterEach(() => {
    env.restore();
    jest.useRealTimers();
    document.body.innerHTML = "";
  });

  /**
   * Capture a company the way selectItem() -> onCompanyCommitted() does, and let
   * the listener's debounce elapse so its decision to request (or not) is made.
   *
   * @param {string} name
   * @param {string} id
   * @returns {void}
   */
  function capture(name, id) {
    component.companyName = name;
    component.companyId = id;
    component.fillCompanyData(id, name);
    jest.advanceTimersByTime(500);
  }

  describe("a second, different company", () => {
    test("gets its own request even while the first is still on the wire", () => {
      const first = deferred();
      const second = deferred();
      const calls = [];
      component.placeOrderIntent = function () {
        calls.push(this.companyId);
        return calls.length === 1 ? first.promise : second.promise;
      };

      capture("Company A", "111111111");
      expect(calls).toEqual(["111111111"]);

      // Company A's decision has NOT come back. This is the exact state the
      // removed mutex swallowed the second request in.
      capture("Company B", "222222222");

      expect(calls).toEqual(["111111111", "222222222"]);
    });

    test("still gets one when the first company's decision has already landed", async () => {
      const calls = [];
      component.placeOrderIntent = function () {
        calls.push(this.companyId);
        return Promise.resolve({ approved: true });
      };

      capture("Company A", "111111111");
      await Promise.resolve();
      capture("Company B", "222222222");
      await Promise.resolve();

      expect(calls).toEqual(["111111111", "222222222"]);
    });

    test("re-picking the company already decided costs no request", async () => {
      const calls = [];
      component.placeOrderIntent = function () {
        calls.push(this.companyId);
        return Promise.resolve({ approved: true });
      };

      capture("Company A", "111111111");
      await H.flushPromises();
      expect(component.lastOrderIntentCompanyId).toBe("111111111");

      capture("Company A", "111111111");
      await H.flushPromises();

      // The per-company dedup gate is deliberately KEPT — it suppresses a
      // repeat check for a company already decided, which is not what the bug
      // was about.
      expect(calls).toEqual(["111111111"]);
    });
  });

  describe("an out-of-order reply", () => {
    test("a stale decision cannot overwrite a newer company's", async () => {
      const first = deferred();
      const second = deferred();
      let call = 0;
      component.placeOrderIntent = function () {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      };

      capture("Company A", "111111111");
      capture("Company B", "222222222");

      // B is the faster round trip (e.g. a decision-cache hit) and lands first.
      second.resolve({ approved: true });
      await H.flushPromises();

      expect(component.lastOrderIntentCompanyId).toBe("222222222");
      expect(component.orderIntentApprovedNotice).toBe(
        "Approved for Company B (222222222)",
      );

      // A's slower round trip finally arrives. It must be dropped silently.
      first.resolve({ approved: false });
      await H.flushPromises();

      expect(component.lastOrderIntentCompanyId).toBe("222222222");
      expect(component.orderIntentApprovedNotice).toBe(
        "Approved for Company B (222222222)",
      );
    });

    test("a stale FAILURE cannot clear a newer company's approval", async () => {
      const first = deferred();
      const second = deferred();
      let call = 0;
      component.placeOrderIntent = function () {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      };

      capture("Company A", "111111111");
      capture("Company B", "222222222");

      second.resolve({ approved: true });
      await H.flushPromises();

      first.reject(new Error("A timed out"));
      await H.flushPromises();

      // processOrderIntentErrorResponse() blanks both notices, so reaching it
      // from a superseded request is exactly as damaging as a stale success.
      expect(component.orderIntentApprovedNotice).toBe(
        "Approved for Company B (222222222)",
      );
      expect(component.placeOrderIntentFlag).toBe(true);
    });

    test("the decision is filed against the company it was REQUESTED for", async () => {
      const first = deferred();
      component.placeOrderIntent = function () {
        return first.promise;
      };

      capture("Company A", "111111111");
      // The buyer edits the captured company while A's check is outstanding,
      // without capturing a new one — so no second request is dispatched and
      // A's reply is still the current one, but `this.companyId` has moved.
      component.companyId = "999999999";

      first.resolve({ approved: true });
      await H.flushPromises();

      // Read off the request, not off live state. Filing it under 999999999
      // would suppress that company's own check forever.
      expect(component.lastOrderIntentCompanyId).toBe("111111111");
    });
  });

  describe("the mutex is gone, not merely bypassed", () => {
    test("the shipped template holds no in-progress boolean gate", () => {
      const source = fs.readFileSync(
        path.join(H.REPO_ROOT, H.GATEWAY_METHOD_TEMPLATE),
        "utf8",
      );

      // Named explicitly: a boolean "one at a time" gate anywhere in this
      // dispatch path reintroduces the reported bug, because the request it
      // refuses is never retried.
      expect(source).not.toContain("orderIntentInProgress");
      // The replacement, pinned so a revert cannot pass this file.
      expect(source).toContain("orderIntentSeq");
    });
  });
});
