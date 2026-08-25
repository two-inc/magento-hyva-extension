/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 §7, Hyvä payment tile. Three complaints, one fix:
 *
 *   - the company name showed as an editable search control rather than a
 *     read-only label once a company had been captured;
 *   - a static "Company Number" caption sat below it;
 *   - the number itself was rendered separately below that.
 *
 * The end state is ONE line reading "<name> (<number>)", with the underlying
 * inputs still in the DOM so `payment[company_name]` and `payment[company_id]`
 * still submit.
 *
 * TWO-25326 tile bugfix batch, bug 5 (2026-08-05 ruling). This file used to
 * carry a SECOND gate alongside the label's, guarding the search block, the
 * Company Number block and a "Change company" button — all three hidden
 * together on CAPTURE, with the button as the only route back out. Doug's
 * exact words, carried over from the identical ruling on Magento (PR #324):
 * the search control "is controlled ONLY by the state of the 'enable search
 * in address' admin setting ... and search control visibility is not
 * changed for any other reason." Found in live testing to read as a
 * confusing hide-and-reshow rather than a stable control.
 *
 * The consequence for this file:
 *
 *   - there is no `SEARCH_BLOCK_SHOW_BINDING` any more, full stop — not a
 *     binding that now reads `true` always, an absent one. Doug's ruling is
 *     "controlled ONLY by the admin setting", so the block carries no
 *     `x-show` of its own in this branch at all; `searchBlockHasNoOwnGate()`
 *     pins the DOM fact instead of a component getter that does not exist;
 *   - the "Change company" button, `CHANGE_BUTTON_SHOW_BINDING`,
 *     `CHANGE_BUTTON_CLICK_BINDING` and `clearCapturedCompany()` are all
 *     REMOVED, along with every test whose only subject was that round trip;
 *   - the Company Number block's own gate (`NUMBER_BLOCK_HIDDEN_CLASS_BINDING`)
 *     is UNCHANGED — that block was never part of this bug, and still hides
 *     once a registry number is locked in, exactly as §7 shipped it;
 *   - the LABEL's gate (gate 2 below) is likewise unchanged — it still follows
 *     the order-intent notice, per the 2026-08-03 ruling, independently of
 *     both of the above.
 *
 * Every binding is read out of the SHIPPED markup by `H.readAlpineBinding()`
 * rather than named as a literal. This repo has repeatedly shipped bindings
 * that silently resolved to nothing on the component; a suite that asserts on
 * component state alone cannot fail for that.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/** The label's own two bindings. */
const LABEL_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_label"]',
  "x-show",
);
const LABEL_TEXT_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_label"]',
  "x-text",
);


/**
 * The gate on the whole Company Number block, caption included. UNCHANGED by
 * the 2026-08-05 ruling: this block still hides once a registry number is
 * locked in.
 */
const NUMBER_BLOCK_HIDDEN_CLASS_BINDING = readNumberBlockClassBinding();

/**
 * The inline order-intent notice's `x-show`. The label's gate must be this same
 * expression, so it is read out of the shipped markup rather than named as a
 * literal on either side.
 */
const INTENT_MESSAGE_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="order_intent_message"]',
  "x-show",
);

/**
 * The brand copy the notice is built from. Real SHAPE — both variants plus the
 * token — because resolveOrderIntentApprovedNotice() indexes into it. The
 * harness's PHP value table resolves `orderIntentApprovedNoticeCopy` to a bare
 * string, which is enough for the markup-emission rule it exists for but not
 * for actually resolving notice text, so the tests that need the notice set the
 * real shape themselves.
 */
const NOTICE_COPY = {
  withCompany: "Approved for {company}.",
  withoutCompany: "Approved.",
  companyNameToken: "{company}",
};

/**
 * Put `component` in the state where the inline notice is on screen, by driving a
 * WHOLE intent check — reply AND settle — through the real handlers rather than
 * by assigning the observable. A test that wrote `orderIntentApprovedNotice` by
 * hand would still pass if the production path stopped setting it.
 *
 * Both halves are needed because the reply handler only RECORDS: the box is
 * painted when the check stops being in flight, since a verdict may never share
 * the tile with a progress row. A fixture that stopped at the reply would leave
 * the row up and the box correctly empty, and every label assertion below would
 * then read as a regression when it is really a fixture that stops half way.
 *
 * @param {Object} component
 */
function approveIntent(component) {
  component.orderIntentApprovedNoticeCopy = NOTICE_COPY;
  component.processOrderIntentSuccessResponse({ approved: true });
  component.setOrderIntentChecking(false);
}

/**
 * The payment template's raw, UNRENDERED source. Needed for assertions about
 * the PHP itself: renderTemplate() drops every `<?php … ?>` block whole, so a
 * PHP guard is invisible in the rendered markup.
 *
 * @returns {string}
 */
function rawTemplateSource() {
  return fs.readFileSync(
    path.join(H.REPO_ROOT, H.GATEWAY_METHOD_MARKUP_TEMPLATE),
    "utf8",
  );
}

/**
 * @returns {Document} the shipped payment markup, parsed
 */
function parsedMarkup() {
  return new DOMParser().parseFromString(
    H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
    "text/html",
  );
}

/**
 * Doug's exact-words ruling (carried over from Magento PR #324): the search
 * control "is controlled ONLY by the state of the 'enable search in address'
 * admin setting ... and search control visibility is not changed for any
 * other reason." Pinned as the absence of any `x-show` between the
 * company-name input and the `<form>` — the input's own ancestor chain is the
 * only place a reintroduced capture- or mode-based gate could hide.
 *
 * @returns {void}
 */
function expectSearchBlockHasNoOwnVisibilityGate() {
  const input = parsedMarkup().querySelector('input[data-name="company_name"]');
  if (!input) {
    throw new Error("the search-mode company_name input is gone from the tile");
  }
  let node = input.parentElement;
  while (node && node.tagName !== "FORM") {
    expect(node.hasAttribute("x-show")).toBe(false);
    node = node.parentElement;
  }
}

/**
 * @returns {string} the bare getter name the Company Number block's `:class`
 *   binds to
 */
function readNumberBlockClassBinding() {
  const input = parsedMarkup().querySelector('input[data-name="company_id"]');
  if (!input) {
    throw new Error("the company_id input is gone from the tile");
  }
  const block = input.parentElement;
  const bound = block.getAttribute(":class");
  if (!bound) {
    throw new Error(
      "the Company Number block has no :class gate — its static caption would " +
        "survive capture on its own",
    );
  }
  return bound;
}

describe("the captured-company tile label (TWO-25326 §7)", () => {
  let env;
  let fetchStub;
  let component;

  beforeEach(() => {
    document.body.innerHTML = [
      '<div id="payment-root">',
      '  <input type="text" id="company_name" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" value="" />',
      '  <div data-name="company_tile_label"></div>',
      "</div>",
    ].join("\n");

    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();

    const root = document.getElementById("payment-root");
    component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: root,
      root: root,
    });
    component.$watch = function () {};
    component.initialize(JSON.parse(H.QUOTE_JSON));
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * A dropdown item in the shape the shared helper's mapItems() produces.
   *
   * @param {string} name
   * @param {string} id the mapped identifier — '' when the hit had none
   * @returns {Object}
   */
  function pickerItem(name, id) {
    return {
      companyName: name,
      companyDisplayName: id ? "<em>" + name + "</em> (" + id + ")" : name,
      companyId: id,
      lookupId: "lookup-" + name,
      item: {},
    };
  }

  describe("the wires between markup and component", () => {
    // The whole point of the file. Each of these fails if a getter is renamed
    // on one side only, which is how this repo has previously shipped bindings
    // that resolved to nothing at all.
    test.each([
      ["label x-show", () => LABEL_SHOW_BINDING],
      ["label x-text", () => LABEL_TEXT_BINDING],
      ["number block :class", () => NUMBER_BLOCK_HIDDEN_CLASS_BINDING],
      ["intent message x-show", () => INTENT_MESSAGE_SHOW_BINDING],
    ])("%s names a key the component actually defines", (_label, binding) => {
      expect(binding() in component).toBe(true);
    });

    test("the search block carries no visibility gate of its own (2026-08-05 ruling, bug 5)", () => {
      expectSearchBlockHasNoOwnVisibilityGate();
    });

    test("the label row is the first child of the payment fieldset", () => {
      // §7 puts it between the term chips (outside the form) and the
      // order-intent message (the element that used to be first here). The
      // label itself carries the class §7 names.
      const fieldset = parsedMarkup().querySelector("form fieldset");
      const label = fieldset.querySelector('[data-name="company_tile_label"]');

      expect(label).not.toBeNull();
      expect(label.classList.contains("two-company-tile-label")).toBe(true);
      expect(fieldset.firstElementChild).toBe(label.parentElement);
    });

    test("there is no 'Change company' control left in the markup", () => {
      // TWO-25326 tile bugfix batch, bug 5 (2026-08-05 ruling): the button
      // this used to pin is REMOVED, along with the hide-and-reshow apparatus
      // it was the only route out of. The search control stays visible
      // instead, so there is nothing left for a "change" affordance to do.
      expect(
        parsedMarkup().querySelector('[data-name="company_tile_change"]'),
      ).toBeNull();
    });

    test("the label sits inside the form's Alpine scope", () => {
      // It reads component state, so a label rendered outside `<form
      // x-data=...>` would bind against the outer tile component instead and
      // resolve to nothing.
      const label = parsedMarkup().querySelector(
        '[data-name="company_tile_label"]',
      );

      expect(label.closest("form[x-data]")).not.toBeNull();
    });

    test("the two superseded inline hints are gone from the markup", () => {
      // §7 forbids extra text labels beside the single line. Reinstating
      // either paragraph fails here.
      const doc = parsedMarkup();

      expect(doc.querySelector('[data-name="company_name_hint"]')).toBeNull();
      expect(doc.querySelector('[data-name="company_id_hint"]')).toBeNull();
    });
  });

  describe("with no company captured", () => {
    test("shows no label and leaves both controls in place", () => {
      // The order-blocking regression this fix must not cause: the tile's
      // search control is the only capture route for a buyer who never sees
      // the address-step company field.
      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("keeps the controls visible for a pick that carried no identifier", () => {
      // Captured means "a registry number is locked in", not "a name was
      // chosen". A hit with no identifier still needs the buyer to type the
      // number, so nothing may be hidden.
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("keeps the controls visible mid-initialize(), before the id arrives", () => {
      // `companyIdDisabled` is derived synchronously from storage while
      // `companyId` is only written a tick later by fillCompanyData(). The
      // controls must not vanish in between.
      component.companyIdEntryRequired = false;
      component.companyId = "";
      component.companyName = "Example Trading Ltd";
      component.applyCompanyIdEditability();

      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("a name with no number paints no label text, even if it were shown", () => {
      // Belt-and-braces on the builder rather than on its gate. Under the
      // superseded capture gate a non-empty number was guaranteed whenever the
      // label was read; the intent gate does not guarantee it, so the builder
      // must not emit "Example Ltd ()" or a bare " (123)".
      component.companyName = "Example Trading Ltd";
      component.companyId = "";
      expect(component[LABEL_TEXT_BINDING]).toBe("Example Trading Ltd");

      component.companyName = "";
      component.companyId = "123456789";
      expect(component[LABEL_TEXT_BINDING]).toBe("");
    });
  });

  describe("with a company captured", () => {
    beforeEach(() => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
    });

    test("reads exactly '<name> (<number>)' once the intent is approved", () => {
      // Capture alone no longer shows it — that is the 2026-08-03 ruling, and
      // it is asserted here as well as in its own describe below, because this
      // is the state a reader of this block would expect to show a label.
      expect(component[LABEL_SHOW_BINDING]).toBe(false);

      approveIntent(component);

      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      expect(component[LABEL_TEXT_BINDING]).toBe(
        "Example Trading Ltd (123456789)",
      );
    });

    test("keeps the editable search control visible (2026-08-05 ruling, bug 5)", () => {
      // THE fix. Before it, capture hid this block and the only way back was
      // the now-removed "Change company" button. There is no gate to flip
      // any more, which is the structural pin at the top of this file — this
      // test names the SCENARIO the fix targets.
      expectSearchBlockHasNoOwnVisibilityGate();
    });

    test("hides the whole Company Number block, caption included", () => {
      // UNCHANGED by the 2026-08-05 ruling — this block was never part of
      // bug 5, and still hides once a registry number is locked in.
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("hidden");
    });

    test("keeps both submitting inputs in the DOM", () => {
      // Hidden, never removed — the order still has to carry the company.
      const doc = parsedMarkup();

      expect(
        doc.querySelector('input[data-name="company_name"]'),
      ).not.toBeNull();
      expect(doc.querySelector('input[data-name="company_id"]')).not.toBeNull();
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(document.getElementById("company_id").value).toBe("123456789");
    });

    test("gives the Company Number block back when the buyer edits the name", () => {
      // The reverse transition. `companyName` has no clearing writer, so a gate
      // keyed on it directly would leave the block hidden for a company the
      // buyer has just typed away from.
      //
      // The name field is now the ONE input, shared between modes (TWO-25326,
      // 2026-08-05 ruling) and `readonly` while `searchModeActive` — a
      // registry pick was made in SEARCH mode above, so editing the name by
      // hand is only reachable through manual mode, exactly as the shipped
      // control gates it.
      component.enterManually();
      const nameInput = document.getElementById("company_name");
      nameInput.value = "Other Example";
      const previousEl = component.$el;
      component.$el = nameInput;
      try {
        component.getItems().catch(() => {});
      } finally {
        component.$el = previousEl;
      }

      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("gives the Company Number block back when a later pick carries no identifier", () => {
      component.selectItem(pickerItem("Other Example Ltd", ""));

      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("a different company can be captured afterwards, typed straight over the field", () => {
      // The replacement for the old clear-then-repick round trip: since the
      // search control never hides, the buyer's route to a different company
      // is simply picking one — no "Change company" step in between.
      component.selectItem(pickerItem("Other Example Ltd", "987654321"));
      approveIntent(component);

      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      expect(component[LABEL_TEXT_BINDING]).toBe(
        "Other Example Ltd (987654321)",
      );
    });
  });

  describe("the capture gate itself", () => {
    test("the Company Number block is hidden only while a number is actually locked in", () => {
      // Across every combination of the three inputs to the derivation, not
      // just the scenarios above: hiding a control the buyer still needs is
      // the order-blocking failure, so it must be unreachable by construction.
      [
        [false, false, ""],
        [false, false, "123456789"],
        [false, true, ""],
        [false, true, "123456789"],
        [true, false, ""],
        [true, false, "123456789"],
        [true, true, ""],
        [true, true, "123456789"],
      ].forEach(([manualMode, companyIdEntryRequired, companyId]) => {
        component.manualMode = manualMode;
        component.companyIdEntryRequired = companyIdEntryRequired;
        component.companyId = companyId;
        component.companyName = "Some Company Ltd";
        component.applyCompanyIdEditability();

        const captured = Boolean(component.companyIdDisabled && companyId);

        expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe(
          captured ? "hidden" : "",
        );
        // The search control's own gate no longer depends on capture OR mode
        // (2026-08-05 ruling, bug 5) — there is no gate at all, pinned
        // structurally above rather than against component state here.
      });
    });

    test("manual mode never captures, so it never hides the Company Number block", () => {
      // `applyCompanyIdEditability()` cannot lock the field while manualMode
      // is set, which is what makes the capture gate safe for the manual
      // route as well.
      component.manualMode = true;
      component.showManual = true;
      component.companyName = "Example Trading Ltd";
      component.companyId = "123456789";
      component.applyCompanyIdEditability();

      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });
  });

  describe("nothing clears the captured company automatically", () => {
    test("(review round 2) — a withdrawn Magewire bridge stays withdrawn", () => {
      // A `billing_as_shipping_address_updated` bridge was added and then
      // WITHDRAWN. Two reasons, both found in review round 2 and neither
      // resolvable without live measurement:
      //
      // 1. Clearing the captured company blanks the ONE shared selection blob,
      //    which is also the SHIPPING company's record. Re-ticking "billing
      //    same as shipping" reads that blob, finds it empty, and restores
      //    nothing — so a single untick-and-retick lost the shipping company
      //    for good.
      // 2. The event's own semantics are unverified. Its name says "address
      //    updated", not "toggle changed", so it may well re-emit on every
      //    billing-field auto-save while unticked — and each re-emission would
      //    destroy the company the buyer had just typed.
      //
      // Pinned as a test because re-adding the bridge without solving (1) is
      // the obvious next move and it is the wrong one. Unaffected by the
      // 2026-08-05 ruling: there is no clearing mechanism left to bridge to at
      // all now that "Change company" is gone, which makes this guard more
      // load-bearing, not less.
      const js = H.renderTemplateJs(H.GATEWAY_METHOD_TEMPLATE);

      expect(js).not.toContain("billing_as_shipping_address_updated");
      expect(js).not.toContain("two-billing-as-shipping-cleared");
    });
  });

  /**
   * The 2026-08-03 ruling on TWO-25326: the label is shown exactly when the
   * inline order-intent notice is shown, and hidden exactly when it is hidden.
   *
   * "Exactly when" is asserted two ways, because either alone is weak:
   *
   *  - as SOURCE: the two `x-show` bindings must be the identical expression.
   *    Two different getters that agree in the states a test happens to visit is
   *    the precise defect the ruling forbids, and no set of behavioural cases
   *    can rule it out.
   *  - as BEHAVIOUR: across every state that separates the new gate from the
   *    superseded capture one — captured-with-no-intent, declined, errored,
   *    company-edited-after-approval — the label follows the notice.
   *
   * The behavioural cases are the mutation-sensitive half: each had the label
   * VISIBLE under the old gate, so reverting the markup one-liner fails them.
   *
   * Unaffected by the 2026-08-05 ruling on bug 5 — the label's OWN gate never
   * named the search control's or the "Change company" button's, and still
   * does not.
   */
  describe("the label is shown exactly when the intent notice is", () => {
    test("both bindings are the same getter, not two that merely agree", () => {
      expect(LABEL_SHOW_BINDING).toBe(INTENT_MESSAGE_SHOW_BINDING);
      // And it is the notice's own gate that both read, not the Company
      // Number block's (the search block has no gate at all to compare).
      expect(LABEL_SHOW_BINDING).not.toBe(NUMBER_BLOCK_HIDDEN_CLASS_BINDING);
    });

    test("a captured company with no intent dispatched yet shows neither", () => {
      // THE case the ruling changes and the old gate got wrong: fully captured,
      // so the superseded gate showed the label; no intent, so no notice.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(component[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);
      expect(component[LABEL_SHOW_BINDING]).toBe(false);
    });

    test("an approved intent shows both", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      approveIntent(component);

      expect(component[INTENT_MESSAGE_SHOW_BINDING]).toBe(true);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      // Tying the VISIBILITY together does not merge the two texts.
      expect(component[LABEL_TEXT_BINDING]).toBe(
        "Example Trading Ltd (123456789)",
      );
      expect(component.orderIntentApprovedNotice).toBe(
        "Approved for Example Trading Ltd.",
      );
    });

    test("a declined intent shows neither, though the company is still captured", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(component);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);

      component.processOrderIntentSuccessResponse({ approved: false });

      expect(component[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);
      expect(component[LABEL_SHOW_BINDING]).toBe(false);
    });

    test("an errored intent shows neither", () => {
      // A separate handler from the declined branch, clearing the notice for its
      // own reason (an error says nothing about approval).
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(component);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);

      component.processOrderIntentErrorResponse({});

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);
    });

    test("a brand that suppresses the notice shows no label either", () => {
      // Two independent mechanisms agree here, and both are asserted: the PHP
      // guard emits no notice element at all, and
      // resolveOrderIntentApprovedNotice() returns '' with no copy, so the
      // shared getter is false and the label is hidden too.
      //
      // Flagged deliberately rather than worked around: it follows from "exactly
      // when". A label wanted without the notice would be a different rule.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      component.orderIntentApprovedNoticeCopy = null;

      component.processOrderIntentSuccessResponse({ approved: true });

      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component[LABEL_SHOW_BINDING]).toBe(false);

      // The markup half: the notice element is inside a PHP conditional on the
      // brand's config, so a suppressing brand ships no element. Read from the
      // RAW template — the harness strips `<?php … ?>` blocks whole, so the
      // rendered markup cannot show a PHP guard at all.
      expect(rawTemplateSource()).toMatch(
        /getOrderIntentApprovedNotice\(\)\s*!==\s*null/,
      );
    });

    test("editing the company after approval hides the label again", () => {
      // The notice is cleared by its own companyName / companyId watchers,
      // because the approval it reports was for the PREVIOUS company. This
      // suite's shared component stubs `$watch` to a no-op, so a fresh instance
      // is mounted with a recording one — which also proves the watchers are
      // actually registered rather than assuming it.
      //
      // The company is really EDITED before the watcher is fired, rather than
      // the callback being invoked over unchanged state. Alpine only calls a
      // watcher when the value changed, so invoking it over an unchanged company
      // asserts on an artefact of the simulation — and since 2026-08-05 the
      // watchers repaint a verdict that is still valid for the company on
      // screen, so an unchanged company legitimately keeps its label.
      const watchers = {};
      const root = document.getElementById("payment-root");
      const fresh = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: root,
        root: root,
      });
      fresh.$watch = function (property, callback) {
        (watchers[property] = watchers[property] || []).push(callback);
      };
      fresh.initialize(JSON.parse(H.QUOTE_JSON));

      fresh.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(fresh);
      expect(fresh[LABEL_SHOW_BINDING]).toBe(true);

      expect(watchers.companyName).toBeDefined();
      expect(watchers.companyId).toBeDefined();
      fresh.companyName = "Example Trading Limited";
      watchers.companyName.forEach(function (callback) {
        callback();
      });

      expect(fresh[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);
      expect(fresh[LABEL_SHOW_BINDING]).toBe(false);
    });

    test("returning to the same company puts its verdict back", () => {
      // The other side of the watcher, and the reason the edit above has to be
      // a real edit. A buyer who searches again — which takes the box down —
      // and then picks the SAME company gets no new decision, because the dedup
      // gate refuses to re-ask for one it already has. Without a repaint the box
      // would stay blank for the rest of the session.
      const watchers = {};
      const root = document.getElementById("payment-root");
      const fresh = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: root,
        root: root,
      });
      fresh.$watch = function (property, callback) {
        (watchers[property] = watchers[property] || []).push(callback);
      };
      fresh.initialize(JSON.parse(H.QUOTE_JSON));

      fresh.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(fresh);
      expect(fresh[LABEL_SHOW_BINDING]).toBe(true);

      // A search starting is what empties the box. The first pick left the
      // in-progress flag up (this suite runs no dispatcher to lower it), so it
      // is reset here too — otherwise it could not show that the re-pick
      // dispatches nothing.
      fresh.clearOrderIntentNotices();
      fresh.orderIntentChecking = false;
      expect(fresh[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);

      // Re-picking the same company dispatches nothing, and repaints.
      fresh.fillCompanyData("123456789", "Example Trading Ltd");

      expect(fresh.orderIntentChecking).toBe(false);
      expect(fresh[INTENT_MESSAGE_SHOW_BINDING]).toBe(true);
      expect(fresh[LABEL_SHOW_BINDING]).toBe(true);
    });
  });

  /**
   * TWO-25345, re-examined under the 2026-08-05 ruling.
   *
   * The original defect: re-picking the SAME company after "Change company"
   * left the tile showing a bare "Change company" button and nothing else —
   * no label, no notice — because two pre-existing behaviours combined:
   *
   *  - the `companyName` / `companyId` watchers blank
   *    `orderIntentApprovedNotice` on the way through, which is the deliberate
   *    fail-closed property they exist for;
   *  - `fillCompanyData()` then suppressed the intent that would have re-set
   *    it, because a decision for that same identifier was still on record.
   *
   * "Change company" is gone (bug 5), and with it the ONLY path that used to
   * reset the decision records mid-session — so the specific "repaints
   * the label instead of leaving a bare button" scenario cannot occur any
   * more: there is no button to leave bare. What survives, and is still
   * pinned below, is the dedup mechanism itself — a DIFFERENT company must
   * still cost exactly one intent, and re-selecting the SAME one without any
   * intervening step must still cost none.
   */
  describe("the order-intent dedup gate (TWO-25345)", () => {
    /**
     * Mount a tile whose `$watch` registrations actually fire.
     *
     * The watched property is replaced with an accessor pair over a captured
     * value, so an assignment anywhere in the component runs the callbacks the
     * way Alpine's proxy would — including the same-value no-op, which Alpine
     * also does not report as a change. That short-circuit is load-bearing, not
     * a detail: it is why an identical re-sync does NOT blank the notice.
     * Callbacks accumulate per property rather than replacing, so a second
     * watcher on one property cannot silently drop the first.
     *
     * ONE known divergence: these callbacks fire SYNCHRONOUSLY, where Alpine
     * queues them on a microtask.
     *
     * @returns {{component: Object, intents: string[], stop: Function}}
     *   `intents` records the company id carried by each dispatched intent
     */
    function mountLive() {
      const root = document.getElementById("payment-root");
      const fresh = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: root,
        root: root,
      });

      const callbacks = {};
      fresh.$watch = function (property, callback) {
        if (callbacks[property]) {
          callbacks[property].push(callback);
          return;
        }
        callbacks[property] = [callback];
        let current = fresh[property];
        Object.defineProperty(fresh, property, {
          configurable: true,
          enumerable: true,
          get: function () {
            return current;
          },
          set: function (next) {
            if (next === current) return;
            current = next;
            callbacks[property].forEach(function (registered) {
              registered(next);
            });
          },
        });
      };

      fresh.initialize(JSON.parse(H.QUOTE_JSON));
      // The three the component registers. A rename that drops one would
      // otherwise make every assertion below vacuous.
      expect(Object.keys(callbacks).sort()).toEqual([
        "companyId",
        "companyName",
        "manualMode",
      ]);

      fresh.orderIntentApprovedNoticeCopy = NOTICE_COPY;

      /*
       * Stand in for the template's top-level `dispatch-order-intent` listener:
       * it debounces, calls placeOrderIntent(), and hands an approval to
       * processOrderIntentSuccessResponse(). Only the last step is what the
       * notice depends on, and driving it through the REAL success handler is
       * what makes the decision record advance the way production does.
       */
      const intents = [];
      const listener = function () {
        intents.push(fresh.companyId);
        fresh.processOrderIntentSuccessResponse({ approved: true });
        // The real dispatcher's `finally` too, not just its reply handling:
        // lowering the row is what re-derives the box, so a fixture that stops at
        // the reply leaves the row up forever and a component that (correctly)
        // refuses to paint a verdict beside a progress row looks broken.
        fresh.setOrderIntentChecking(false);
      };
      window.addEventListener("dispatch-order-intent", listener);

      return {
        component: fresh,
        intents: intents,
        stop: function () {
          window.removeEventListener("dispatch-order-intent", listener);
        },
      };
    }

    /** The identical company, picked twice — the whole point of the ticket. */
    const SAME = ["Example Trading Ltd", "123456789"];

    test("a DIFFERENT company still works, and still costs one intent", () => {
      const live = mountLive();
      try {
        live.component.selectItem(pickerItem(SAME[0], SAME[1]));
        expect(live.intents).toEqual([SAME[1]]);
        expect(live.component[LABEL_SHOW_BINDING]).toBe(true);

        live.component.selectItem(pickerItem("Other Example Ltd", "987654321"));

        expect(live.intents).toEqual([SAME[1], "987654321"]);
        expect(live.component[LABEL_SHOW_BINDING]).toBe(true);
        expect(live.component[LABEL_TEXT_BINDING]).toBe(
          "Other Example Ltd (987654321)",
        );
      } finally {
        live.stop();
      }
    });

    test("re-selecting the same company from an open dropdown dispatches nothing new", () => {
      // The reason the guard exists, and the cost the fix is scoped to avoid
      // paying generally: re-picking the same company — no intervening
      // step — must still dispatch nothing the second time.
      const live = mountLive();
      try {
        live.component.selectItem(pickerItem(SAME[0], SAME[1]));
        live.component.selectItem(pickerItem(SAME[0], SAME[1]));

        expect(live.intents).toEqual([SAME[1]]);
        // And the notice is intact, because assigning the identical values
        // never fired the watchers that would have blanked it.
        expect(live.component[LABEL_SHOW_BINDING]).toBe(true);
      } finally {
        live.stop();
      }
    });

    test("toggling manual entry and back dispatches no extra intent", () => {
      // `enterManually()` / `enableSearch()` flip mode only, they never write
      // `companyName` / `companyId`, so the notice survives them and there is
      // nothing to repaint.
      const live = mountLive();
      try {
        live.component.selectItem(pickerItem(SAME[0], SAME[1]));
        expect(live.intents).toEqual([SAME[1]]);

        live.component.enterManually();
        live.component.enableSearch();

        expect(live.intents).toEqual([SAME[1]]);
        expect(live.component.orderIntentDecisions[SAME[1]]).toBeDefined();
      } finally {
        live.stop();
      }
    });

    test("the listener's own dedup gate names the same property", () => {
      // Pins the coupling fillCompanyData()'s own gate stands in for: both the
      // component's gate and the top-level listener's own "already processed"
      // check must read ONE property, or clearing it fixes half the bug. Read
      // out of the shipped JS rather than assumed.
      const js = H.renderTemplateJs(H.GATEWAY_METHOD_TEMPLATE);

      // Both gate EXPRESSIONS, deliberately not a count of the identifier.
      // A count is satisfied by a prose comment that merely mentions the
      // property by name, which stays green with a real gate deleted — the
      // opposite of what this test is for.
      //
      // Both now ask the ONE question, of the ONE set of records the box is
      // painted from (review round 7): the gate used to consult a separate
      // single-slot "last company dispatched for", which meant "already
      // decided" and "has a verdict to show" could disagree — and did, so a
      // company whose answer was known was asked about again.
      //
      // fillCompanyData()'s gate, before it dispatches:
      expect(js).toContain(
        "!this.hasOrderIntentDecisionFor(companyId, companyName)",
      );
      // and the top-level listener's own "already processed" gate — read via
      // a local alias (`component`) rather than the global directly, because
      // bug 5's local-spinner rework wrapped this in executeOrderIntent(),
      // but it is still the SAME global instance under that name:
      expect(js).toContain("const component = twoPaymentComponentInstance;");
      expect(js).toContain(
        "component.hasOrderIntentDecisionFor(currentCompanyId, component.companyName)",
      );
      // And the slot they used to read is gone, not merely unused.
      expect(js).not.toContain("lastOrderIntentCompanyId");
    });
  });

  describe("the billing/shipping key split (TWO-25326 review round 3)", () => {
    /**
     * Mount a FRESH tile against whatever is currently in storage.
     *
     * The suite's own `beforeEach` has already mounted one with empty storage,
     * and `initialize()` is what reads the records — so a restore test has to
     * build its own instance after seeding.
     *
     * @param {boolean} [billingAsShipping] renders the checkbox in that state;
     *   omit to leave it absent, which is the "no such toggle" default
     * @returns {Object} the mounted component
     */
    function remount(billingAsShipping) {
      const existing = document.getElementById("billing-as-shipping");
      if (existing) existing.remove();
      if (billingAsShipping !== undefined) {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.id = "billing-as-shipping";
        box.checked = billingAsShipping;
        document.body.appendChild(box);
      }
      const root = document.getElementById("payment-root");
      const fresh = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: root,
        root: root,
      });
      fresh.$watch = function () {};
      fresh.initialize(JSON.parse(H.QUOTE_JSON));
      return fresh;
    }

    /** @param {string} key @param {Object} data */
    function seed(key, data) {
      env.browserStorage.setItem(key, JSON.stringify(data));
    }

    const SHIPPING = {
      quote_id: "test-quote-1",
      company_name: "Shipping Company Ltd",
      company_id: "99999999",
      company_id_source: "registry",
    };
    const BILLING = {
      quote_id: "test-quote-1",
      company_name: "Billing Company Ltd",
      company_id: "11112222",
      company_id_source: "registry",
    };

    test("the BILLING record wins over the shipping one", () => {
      // The corruption this split removes: before it, one blob held both, so
      // whichever surface wrote last decided what the order carried.
      seed(H.COMPANY_SELECTION_KEY, SHIPPING);
      seed(H.BILLING_COMPANY_KEY, BILLING);

      const fresh = remount(true);

      expect(fresh.companyName).toBe("Billing Company Ltd");
      expect(fresh.companyId).toBe("11112222");
    });

    test("falls back to shipping when there is no billing record AND the box is ticked", () => {
      seed(H.COMPANY_SELECTION_KEY, SHIPPING);

      const fresh = remount(true);

      expect(fresh.companyName).toBe("Shipping Company Ltd");
      expect(fresh.companyId).toBe("99999999");
    });

    test("does NOT fall back to shipping once the buyer unticks the box", () => {
      // The bug the withdrawn Magewire bridge was trying to paper over: with
      // billing declared different from shipping, adopting the shipping company
      // shows the buyer a company they have explicitly said does not apply —
      // and, being captured, it renders as a read-only label.
      seed(H.COMPANY_SELECTION_KEY, SHIPPING);

      const fresh = remount(false);

      expect(fresh.companyName).toBe("");
      expect(fresh.companyId).toBe("");
      expect(fresh[LABEL_SHOW_BINDING]).toBe(false);
      // And the capture route is available, which is the whole point.
    });

    test("falls back when the toggle does not exist at all", () => {
      // A checkout with no such control has one address, so the shipping
      // company IS the billing company. Absent must not read as unticked.
      seed(H.COMPANY_SELECTION_KEY, SHIPPING);

      const fresh = remount();

      expect(fresh.companyName).toBe("Shipping Company Ltd");
    });

    test("isBillingAsShipping is published as a shared window helper", () => {
      // Hoisted so the tile and company-name-payment.phtml cannot answer it
      // differently — two surfaces disagreeing is how the tile adopts a company
      // the buyer has ruled out.
      expect(typeof window.twoGatewayIsBillingAsShipping).toBe("function");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.id = "billing-as-shipping";
      box.checked = false;
      document.body.appendChild(box);
      expect(window.twoGatewayIsBillingAsShipping()).toBe(false);

      box.checked = true;
      expect(window.twoGatewayIsBillingAsShipping()).toBe(true);

      box.remove();
      expect(window.twoGatewayIsBillingAsShipping()).toBe(true);
    });

    test("the two keys are separately store-scoped", () => {
      expect(window.TWO_GATEWAY_BILLING_COMPANY_KEY).toBe(H.BILLING_COMPANY_KEY);
      expect(window.TWO_GATEWAY_BILLING_COMPANY_KEY).not.toBe(
        window.TWO_GATEWAY_COMPANY_SELECTION_KEY,
      );
      // Store-less must mean "no storage", never a bucket every store shares.
      expect(H.BILLING_COMPANY_KEY).toMatch(/:1$/);
    });
  });

  describe("provenance written by the tile's own pick", () => {
    /** @returns {Object} the persisted BILLING company selection */
    function stored() {
      return JSON.parse(
        env.browserStorage.getItem(H.BILLING_COMPANY_KEY) || "{}",
      );
    }

    test("a registry pick is recorded as 'registry'", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(stored().company_id).toBe("123456789");
      expect(stored().company_id_source).toBe("registry");
    });

    test("overwrites a 'manual' left behind by an earlier address-step edit", () => {
      // The defect this pins. The write merges, so without an explicit
      // `company_id_source` the stale `'manual'` survives beside a registry
      // number; the address step's hasVouchedCompanyId() then reads false and
      // refuses to render the read-only number for a genuine registry pick.
      window.twoGatewayWriteCompanySelection({ company_id_source: "manual" });

      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(stored().company_id_source).toBe("registry");
    });

    test("a pick with no identifier records no provenance", () => {
      // Nothing vouched for a number, so nothing may claim it did.
      window.twoGatewayWriteCompanySelection({ company_id_source: "manual" });

      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(stored().company_id).toBe("");
      expect(stored().company_id_source).toBe("");
    });

    test("the write still merges — quote_id survives it", () => {
      // Guards the regression the write's own comment names: rebuilding the
      // blob from a key list drops `quote_id` and silently disarms the
      // new-order clear. `quote_id` is written by a different path, so it is
      // seeded here and only its SURVIVAL through this write is asserted.
      window.twoGatewayWriteBillingCompany({ quote_id: "test-quote-1" });

      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(stored().quote_id).toBe("test-quote-1");
    });

    test("the tile never writes the SHIPPING record", () => {
      // The whole point of the key split. The address step owns the shipping
      // company; a tile write reaching that key is the data-corruption bug the
      // split removes, and it is the regression most likely to be reintroduced
      // by copying one of the sibling write calls.
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Shipping Company Ltd",
          company_id: "99999999",
          company_id_source: "registry",
        }),
      );
      const before = env.browserStorage.getItem(H.COMPANY_SELECTION_KEY);

      component.selectItem(pickerItem("Billing Company Ltd", "11112222"));
      component.saveManualModeToStorage(true);

      // Byte-for-byte: a re-parsed comparison would hide a rewrite that
      // happened to round-trip to an equal object, and any tile write into the
      // shipping slot is the defect whether or not the value changed.
      expect(env.browserStorage.getItem(H.COMPANY_SELECTION_KEY)).toBe(before);
      expect(stored().company_name).toBe("Billing Company Ltd");
    });
  });
});
