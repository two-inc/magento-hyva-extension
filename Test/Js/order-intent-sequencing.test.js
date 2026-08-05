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

    /**
     * Review round 4 (Vader). `seq` alone answers "is this the newest
     * DISPATCH", not "is this still about the company on screen" — and those
     * diverge exactly here: reverting to an already-DECIDED company costs no
     * new dispatch (the test above this one, and "re-picking the company
     * already decided costs no request"), so `orderIntentSeq` does not
     * advance for the revert. A reply for a company the buyer has since
     * moved away from must not be resolved against LIVE
     * `companyName`/`companyId` — that is what
     * `resolveOrderIntentApprovedNotice()` reads — or it paints one
     * company's verdict under another's name.
     */
    test("a reply for a company the buyer has reverted away from does not paint its verdict", async () => {
      const first = deferred();
      const second = deferred();
      let call = 0;
      component.placeOrderIntent = function () {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      };

      capture("Company A", "111111111");
      first.resolve({ approved: true });
      await H.flushPromises();
      const noticeForA = component.orderIntentApprovedNotice;
      expect(noticeForA).toBe("Approved for Company A (111111111)");

      // B is captured — a real request goes out and is left outstanding.
      capture("Company B", "222222222");

      // The buyer reverts to A — already decided, so the dedup gate skips a
      // new dispatch and `orderIntentSeq` does not advance for it.
      capture("Company A", "111111111");
      expect(call).toBe(2); // still just A's original request and B's — no third

      // B's reply lands late. It must not paint under A's live name.
      second.resolve({ approved: true });
      await H.flushPromises();

      expect(component.orderIntentApprovedNotice).toBe(noticeForA);
      expect(component.orderIntentApprovedNotice).not.toContain("Company B");
      // The dedup bookkeeping still advances to B, though — B's own gate is
      // satisfied, so re-picking B later costs no extra request either. This
      // is the SAME behaviour "the decision is filed against the company it
      // was REQUESTED for" pins for the live-edit case above.
      expect(component.lastOrderIntentCompanyId).toBe("222222222");
    });

    test("a stale reply for a reverted-away company does not clear the live company's approval via the error path either", async () => {
      const first = deferred();
      const second = deferred();
      let call = 0;
      component.placeOrderIntent = function () {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      };

      capture("Company A", "111111111");
      first.resolve({ approved: true });
      await H.flushPromises();
      const noticeForA = component.orderIntentApprovedNotice;

      capture("Company B", "222222222");
      capture("Company A", "111111111");

      second.reject(new Error("B timed out"));
      await H.flushPromises();

      // A's already-approved notice must survive a failure that was never
      // about A in the first place.
      expect(component.orderIntentApprovedNotice).toBe(noticeForA);
      expect(component.placeOrderIntentFlag).toBe(true);
    });
  });

  describe("a Magewire remount mid-flight (review round 4, Han)", () => {
    /**
     * `initialize()` reassigns the module-level `twoPaymentComponentInstance`
     * on every call, which is exactly what a Magewire re-render of this tile
     * does in production. A request dispatched against the OLD instance must
     * not write its reply to that dead instance once a new one has taken
     * over — the live instance would never learn the verdict at all.
     */
    test("a reply that arrives after a remount is not written to the dead instance, and is not lost either", async () => {
      const first = deferred();
      component.placeOrderIntent = function () {
        return first.promise;
      };

      capture("Company A", "111111111");

      // The remount: a fresh component takes over as THE instance before A's
      // reply lands. Real Alpine would tear the old element down; this
      // suite's harness only needs the module-level pointer to move, which is
      // the exact thing `initialize()` does.
      const freshRoot = document.createElement("form");
      document.body.appendChild(freshRoot);
      const fresh = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: freshRoot,
        root: freshRoot,
      });
      fresh.$watch = function () {};
      fresh.initialize(JSON.parse(H.QUOTE_JSON));
      fresh.orderIntentApprovedNoticeCopy = NOTICE_COPY;

      // Spy on BOTH instances rather than reading state afterwards: the
      // dispatcher's closure still refers to the OLD `component` object no
      // matter what the guard does, so `fresh` is never reachable through it
      // either way — a state assertion on `fresh` would pass even with the
      // liveness guard deleted. Only a call-count assertion can tell "the
      // guard dropped the reply" apart from "nothing here ever touches
      // `fresh` regardless".
      const deadWrite = jest.spyOn(component, "processOrderIntentSuccessResponse");
      const liveWrite = jest.spyOn(fresh, "processOrderIntentSuccessResponse");

      first.resolve({ approved: true });
      await H.flushPromises();

      // The dead instance's own write method is never called at all — the
      // guard drops the reply before reaching it.
      expect(deadWrite).not.toHaveBeenCalled();
      // Nor is the live one's — the reply was ABOUT company A on the OLD
      // instance, and nothing routes a reply meant for a torn-down instance
      // to whatever replaced it; that would repaint the new instance with a
      // verdict for a company it never asked about.
      expect(liveWrite).not.toHaveBeenCalled();
      expect(component.orderIntentApprovedNotice).toBe("");
      expect(fresh.orderIntentApprovedNotice).toBe("");
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
