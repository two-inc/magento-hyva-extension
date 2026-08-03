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
 * TWO GATES, and keeping them apart is what this file is for.
 *
 * 1. The CONTROLS — the search block, the Company Number block, and the
 *    "Change company" button that is the route back out — are gated on
 *    CAPTURED, never on mode. On Magento the tile's search control is a
 *    company-capture route in its own right for buyers who never see the
 *    address-step company field: a logged-in buyer picking a saved address, or
 *    a virtual cart with no shipping step. Hiding it while nothing is captured
 *    is an order-blocking regression, not a cosmetic one, so every "hidden"
 *    assertion here has a matching "still visible while uncaptured" one. This
 *    gate is UNCHANGED.
 *
 * 2. The LABEL is gated on the order-intent notice, per the 2026-08-03 ruling
 *    on TWO-25326: shown exactly when that notice is shown, hidden exactly when
 *    it is hidden. Both bindings read the identical getter. This SUPERSEDES the
 *    label's earlier capture gate.
 *
 * The consequence is deliberate and pinned below: a captured company with no
 * approved intent on screen hides the search and number blocks, shows no label,
 * and shows the "Change company" button — which is why that button must keep
 * gate 1. Following the label would leave that buyer with no control at all and
 * an unchangeable company.
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
 * The gate on the editable search control, read from the block that wraps the
 * search input. Selected via that input's `data-name`, then walked up to the
 * `x-show` ancestor, so a markup reshuffle that moves the gate off this block
 * fails here rather than passing silently.
 */
const SEARCH_BLOCK_SHOW_BINDING = readSearchBlockShowBinding();

/** The gate on the whole Company Number block, caption included. */
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
 * Put `component` in the state where the inline notice is on screen, through
 * the REAL success handler rather than by assigning the observable. A test that
 * wrote `orderIntentApprovedNotice` by hand would still pass if
 * processOrderIntentSuccessResponse() stopped setting it.
 *
 * @param {Object} component
 */
function approveIntent(component) {
  component.orderIntentApprovedNoticeCopy = NOTICE_COPY;
  component.processOrderIntentSuccessResponse({ approved: true });
}

/**
 * The "Change company" control's bindings. Capture hides both company controls
 * and the only "Enter details manually" link lives inside the hidden search
 * block, so this button is the ONLY way back out — a binding that resolves to
 * nothing here is an unchangeable company, not a cosmetic defect.
 *
 * Its `x-show` is the CAPTURE gate, and is asserted below to be different from
 * the label's.
 */
const CHANGE_BUTTON_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_change"]',
  "x-show",
);
const CHANGE_BUTTON_CLICK_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_change"]',
  "@click",
);

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

/** @returns {HTMLElement} the "Change company" control, from the shipped markup */
function changeButton() {
  const button = parsedMarkup().querySelector(
    '[data-name="company_tile_change"]',
  );
  if (!button) {
    throw new Error(
      "the tile has no 'Change company' control — a captured company would " +
        "then be unchangeable from the payment step",
    );
  }
  return button;
}

/**
 * @returns {string} the bare getter name the search-control block's `x-show`
 *   binds to
 */
function readSearchBlockShowBinding() {
  const input = parsedMarkup().querySelector('input[data-name="company_name"]');
  if (!input) {
    throw new Error("the search-mode company_name input is gone from the tile");
  }
  const block = input.closest("[x-show]");
  if (!block) {
    throw new Error("the company search control has no x-show gate");
  }
  return block.getAttribute("x-show");
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
      ["search block x-show", () => SEARCH_BLOCK_SHOW_BINDING],
      ["number block :class", () => NUMBER_BLOCK_HIDDEN_CLASS_BINDING],
      ["change button x-show", () => CHANGE_BUTTON_SHOW_BINDING],
      ["change button @click", () => CHANGE_BUTTON_CLICK_BINDING],
      ["intent message x-show", () => INTENT_MESSAGE_SHOW_BINDING],
    ])("%s names a key the component actually defines", (_label, binding) => {
      expect(binding() in component).toBe(true);
    });

    test("the label row is the first child of the payment fieldset", () => {
      // §7 puts it between the term chips (outside the form) and the
      // order-intent message (the element that used to be first here). The row
      // wraps the label and its "Change company" button so the two stay
      // adjacent; the label itself carries the class §7 names.
      const fieldset = parsedMarkup().querySelector("form fieldset");
      const label = fieldset.querySelector('[data-name="company_tile_label"]');
      const button = fieldset.querySelector(
        '[data-name="company_tile_change"]',
      );

      expect(label).not.toBeNull();
      expect(button).not.toBeNull();
      expect(label.classList.contains("two-company-tile-label")).toBe(true);
      expect(fieldset.firstElementChild).toBe(label.parentElement);
      expect(button.parentElement).toBe(label.parentElement);
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
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
      // And no way back is offered, because there is nothing to go back from.
      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
    });

    test("keeps the controls visible for a pick that carried no identifier", () => {
      // Captured means "a registry number is locked in", not "a name was
      // chosen". A hit with no identifier still needs the buyer to type the
      // number, so nothing may be hidden.
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
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

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
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
      expect(component[LABEL_TEXT_BINDING]).toBe("Example Trading Ltd (123456789)");
    });

    test("hides the editable search control block", () => {
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(false);
    });

    test("hides the whole Company Number block, caption included", () => {
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

    test("gives the controls back when the buyer edits the name", () => {
      // The reverse transition. `companyName` has no clearing writer, so a gate
      // keyed on it directly would leave the controls hidden for a company the
      // buyer has just typed away from.
      component.isSelecting = false;
      const nameInput = document.getElementById("company_name");
      nameInput.value = "Other Example";
      const previousEl = component.$el;
      component.$el = nameInput;
      try {
        component.getItems().catch(() => {});
      } finally {
        component.$el = previousEl;
        component.abortCompanySearch();
      }

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("gives them back when a later pick carries no identifier", () => {
      component.selectItem(pickerItem("Other Example Ltd", ""));

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });
  });

  describe("the capture gate itself", () => {
    test("nothing is hidden unless a number is actually locked in", () => {
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

        expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(captured);
        expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe(
          captured ? "hidden" : "",
        );
        if (!captured) {
          // Manual mode has its own separate `showManual` gate, so only the
          // uncaptured-and-not-manual case is asserted visible here.
          expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(
            !component.showManual,
          );
        }
      });
    });

    test("manual mode never captures, so it never hides the controls", () => {
      // `applyCompanyIdEditability()` cannot lock the field while manualMode
      // is set, which is what makes the capture gate safe for the manual
      // route as well.
      component.manualMode = true;
      component.showManual = true;
      component.companyName = "Example Trading Ltd";
      component.companyId = "123456789";
      component.applyCompanyIdEditability();

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });
  });

  /**
   * The way back out. Without it a captured company is unchangeable from the
   * tile: the search block is hidden, the only "Enter details manually" link
   * lives inside it, nothing outside it can set `showManual`, and neither of
   * the two things that recompute `companyIdEntryRequired` (the tile's own
   * `getItems()`, which needs the hidden search input, and an inbound shipping
   * sync) can be reached from the payment step.
   */
  describe("the 'Change company' control", () => {
    test("is a real button, not a clickable div or an anchor", () => {
      // §2's rule on this ticket. `type="button"` additionally keeps it from
      // submitting the checkout form it sits inside.
      const button = changeButton();

      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
    });

    test("is gated on capture, NOT on the label's intent-message gate", () => {
      // Load-bearing, and the trap this change introduces if the two are left
      // wired together. Capture is what hides the search block; the label now
      // follows the order-intent notice. A button following the LABEL would
      // vanish for a buyer with a captured company and no approved intent on
      // screen, leaving no search block, no "Enter details manually" link (it
      // lives inside the hidden block) and no way back — an unchangeable
      // company, which is order-blocking rather than cosmetic.
      expect(CHANGE_BUTTON_SHOW_BINDING).not.toBe(LABEL_SHOW_BINDING);

      // Asserted as behaviour too, in exactly that state: captured, no intent.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(false);
      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(true);
    });

    test("is never visible at the same time as the search block", () => {
      // The property the old shared gate gave for free and which must survive
      // the split: the control and its replacement are exact opposites.
      [
        [false, ""],
        [false, "123456789"],
        [true, ""],
        [true, "123456789"],
      ].forEach(([companyIdEntryRequired, companyId]) => {
        component.manualMode = false;
        component.showManual = false;
        component.companyIdEntryRequired = companyIdEntryRequired;
        component.companyId = companyId;
        component.companyName = "Some Company Ltd";
        component.applyCompanyIdEditability();

        expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(
          !component[SEARCH_BLOCK_SHOW_BINDING],
        );
      });
    });

    test("takes a captured company all the way back to a usable search control", () => {
      // The round trip, end to end. Every assertion below fails if
      // clearCapturedCompany() is reduced to a no-op.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(component);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(false);

      component[CHANGE_BUTTON_CLICK_BINDING]();

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
      expect(component.companyName).toBe("");
      expect(component.companyId).toBe("");
      expect(component.search).toBe("");
      expect(document.getElementById("company_name").value).toBe("");
      expect(document.getElementById("company_id").value).toBe("");
      // The number field has to be typeable again, not merely visible.
      expect(component.companyIdDisabled).toBe(false);
    });

    test("lets a different company be captured afterwards", () => {
      // The half of the round trip that proves the control is usable and not
      // just present: clear, then capture again, and the tile must show the
      // NEW company.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      component[CHANGE_BUTTON_CLICK_BINDING]();

      component.selectItem(pickerItem("Other Example Ltd", "987654321"));
      approveIntent(component);

      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      expect(component[LABEL_TEXT_BINDING]).toBe("Other Example Ltd (987654321)");
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(false);
    });

    test("clears the BILLING record only, leaving the shipping company intact", () => {
      // `initialize()` restores from storage on every re-render. Leaving the
      // captured pair there would put the company — and the hidden controls —
      // straight back, which is the same dead end with an extra step.
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Shipping Company Ltd",
          company_id: "99999999",
          company_id_source: "registry",
        }),
      );
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      component[CHANGE_BUTTON_CLICK_BINDING]();

      // The BILLING record is REMOVED, not blanked. `initialize()` restores
      // from storage on every re-render, so leaving the pair there would put
      // the company — and the hidden controls — straight back.
      //
      // Removal rather than empty strings is load-bearing: the tile falls back
      // to the shipping company only when there is NO billing record, so a
      // blank one would suppress that fallback for the rest of the checkout.
      expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).toBeNull();

      // And the SHIPPING record is untouched. Before the key split this cleared
      // one shared blob, so "Change company" also destroyed the shipping
      // company's identifier and the address step's read-only number label went
      // with it.
      const shipping = JSON.parse(
        env.browserStorage.getItem(H.COMPANY_SELECTION_KEY) || "{}",
      );
      expect(shipping.company_name).toBe("Shipping Company Ltd");
      expect(shipping.company_id).toBe("99999999");
    });

    test("puts focus in the control it reveals, and the focus actually lands", () => {
      // Asserted on `document.activeElement`, not on a spy: a `.focus()` call
      // that reaches an element still carrying `display: none` is a silent
      // no-op, which is exactly the failure a spy would report as success.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      document.getElementById("company_id").focus();

      component[CHANGE_BUTTON_CLICK_BINDING]();

      expect(document.activeElement).toBe(
        document.getElementById("company_name"),
      );
    });

    test("retries the focus once when the first attempt does not take", () => {
      // The real-browser case the plain `$nextTick` cannot cover: Alpine's
      // transition can leave the revealed input unfocusable for a further
      // frame. Simulated by making the first `focus()` a no-op.
      const input = document.getElementById("company_name");
      const realFocus = input.focus.bind(input);
      let attempts = 0;
      input.focus = function () {
        attempts += 1;
        if (attempts === 1) return;
        realFocus();
      };

      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      component[CHANGE_BUTTON_CLICK_BINDING]();
      expect(document.activeElement).not.toBe(input);

      jest.runOnlyPendingTimers();

      expect(attempts).toBeGreaterThan(1);
      expect(document.activeElement).toBe(input);
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
   */
  describe("the label is shown exactly when the intent notice is", () => {
    test("both bindings are the same getter, not two that merely agree", () => {
      expect(LABEL_SHOW_BINDING).toBe(INTENT_MESSAGE_SHOW_BINDING);
      // And it is the notice's own gate that both read, not a capture check
      // both were rewired to.
      expect(LABEL_SHOW_BINDING).not.toBe(CHANGE_BUTTON_SHOW_BINDING);
      expect(LABEL_SHOW_BINDING).not.toBe(SEARCH_BLOCK_SHOW_BINDING);
    });

    test("a captured company with no intent dispatched yet shows neither", () => {
      // THE case the ruling changes and the old gate got wrong: fully captured,
      // so the superseded gate showed the label; no intent, so no notice.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(true);
      expect(component[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);
      expect(component[LABEL_SHOW_BINDING]).toBe(false);
    });

    test("an approved intent shows both", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      approveIntent(component);

      expect(component[INTENT_MESSAGE_SHOW_BINDING]).toBe(true);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      // Tying the VISIBILITY together does not merge the two texts.
      expect(component[LABEL_TEXT_BINDING]).toBe("Example Trading Ltd (123456789)");
      expect(component.orderIntentApprovedNotice).toBe(
        "Approved for Example Trading Ltd.",
      );
    });

    test("a declined intent shows neither, though the company is still captured", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(component);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);

      component.processOrderIntentSuccessResponse({ approved: false });

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(true);
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

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(true);
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
      watchers.companyName.forEach(function (callback) {
        callback();
      });

      expect(fresh[INTENT_MESSAGE_SHOW_BINDING]).toBe(false);
      expect(fresh[LABEL_SHOW_BINDING]).toBe(false);
    });
  });

  describe("getting back to an editable company", () => {
    test("the Change company button hands the search control back", () => {
      // Without a route back, a captured company is a read-only label with no
      // control beside it: a buyer who picked the wrong company, or who needs a
      // different BILLING company from their shipping one, is stuck.
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      approveIntent(component);
      expect(component[LABEL_SHOW_BINDING]).toBe(true);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(false);

      component[CHANGE_BUTTON_CLICK_BINDING]();

      expect(component[CHANGE_BUTTON_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component.companyName).toBe("");
      expect(component.companyId).toBe("");
    });

    test("nothing clears the captured company automatically (review round 2)", () => {
      // A `billing_as_shipping_address_updated` bridge was added and then
      // WITHDRAWN. Two reasons, both found in review round 2 and neither
      // resolvable without live measurement:
      //
      // 1. `clearCapturedCompany()` blanks the ONE shared selection blob, which
      //    is also the SHIPPING company's record. Re-ticking "billing same as
      //    shipping" reads that blob, finds it empty, and restores nothing — so
      //    a single untick-and-retick lost the shipping company for good.
      // 2. The event's own semantics are unverified. Its name says "address
      //    updated", not "toggle changed", so it may well re-emit on every
      //    billing-field auto-save while unticked — and each re-emission would
      //    destroy the company the buyer had just typed.
      //
      // Clearing is therefore only ever reached from the explicit "Change
      // company" button, where wiping the single shared record is what the
      // buyer asked for. Pinned as a test because re-adding the bridge without
      // solving (1) is the obvious next move and it is the wrong one.
      const js = H.renderTemplateJs(H.GATEWAY_METHOD_TEMPLATE);

      expect(js).not.toContain("billing_as_shipping_address_updated");
      expect(js).not.toContain("two-billing-as-shipping-cleared");
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
      expect(fresh[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
    });

    test("falls back when the toggle does not exist at all", () => {
      // A checkout with no such control has one address, so the shipping
      // company IS the billing company. Absent must not read as unticked.
      seed(H.COMPANY_SELECTION_KEY, SHIPPING);

      const fresh = remount();

      expect(fresh.companyName).toBe("Shipping Company Ltd");
    });

    test("an emptied billing record is a REMOVAL, so the fallback stays live", () => {
      // Blanking instead of removing would leave a record present-but-empty,
      // which the fallback reads as "the buyer named a billing company" and
      // suppresses for the rest of the checkout.
      seed(H.COMPANY_SELECTION_KEY, SHIPPING);
      const captured = remount(true);
      captured.selectItem(pickerItem("Billing Company Ltd", "11112222"));
      expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).not.toBeNull();

      captured[CHANGE_BUTTON_CLICK_BINDING]();
      expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).toBeNull();

      const afterClear = remount(true);
      expect(afterClear.companyName).toBe("Shipping Company Ltd");
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
