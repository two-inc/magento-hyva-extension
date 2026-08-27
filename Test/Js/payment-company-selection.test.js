/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25253. What the payment component does with a selected company whose
 * national identifier the search response omitted.
 *
 * The guard in the shared search helper stops the throw, and in doing so makes
 * an empty `companyId` reachable for the first time. This file covers the
 * consequence, which is the part that actually costs money if it is wrong: the
 * company-id field must never end up holding the PREVIOUS company's identifier
 * beside the NEW company's name, and it must not be left empty and disabled —
 * an unfillable required field is a dead end at checkout.
 *
 * Every editability assertion here lands on `#company_id`.disabled, through the
 * REAL `:disabled` expression read out of `gateway_method.phtml` by
 * `H.readAlpineBinding()`. Asserting on `companyIdDisabled` alone was the defect
 * a review round found in the first version of this suite: the state was bound
 * to nothing, so the whole apparatus had no effect on the page and the suite
 * passed with the field permanently disabled. A test that cannot fail for the
 * reason the fix exists is not a test of the fix.
 *
 * This is the first suite to assert on `twoGatewayHyvaPaymentMethodBase`, which
 * Test/Js/README.md previously listed as out of scope. Its own file for the
 * reason the README's "known leak" section gives: the template registers an
 * anonymous top-level `dispatch-order-intent` listener that cannot be removed,
 * so a file that dispatches that event accumulates one handler per test.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/**
 * The property `gateway_method.phtml` binds to the company-number input's
 * `:disabled`, read from the shipped template.
 *
 * Resolved once, at require time, and deliberately NOT wrapped in a try. Two
 * blast radii, both total, and they differ in WHEN they land:
 *
 * - the binding **missing** (or not a bare property name) throws out of
 *   `readAlpineBinding()` at require time, so the file never loads and no test
 *   in it runs at all;
 * - the binding **present but naming a property the component does not have** —
 *   a rename on one side only — loads fine, then fails every test that touches
 *   the field, because `syncCompanyIdField()` checks membership at runtime and
 *   throws.
 *
 * Either way there is no locked state to assert on, which is the point: this
 * file must not be able to pass while the wire between markup and component is
 * broken at either end.
 */
const COMPANY_ID_DISABLED_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'input[data-name="company_id"]',
  ":disabled",
);

/**
 * The bindings TWO-25288's inline hint adds. Resolved the same way and for
 * the same reason as `COMPANY_ID_DISABLED_BINDING` above: a test asserting on
 * component state alone cannot fail when the markup binding is missing or
 * renamed on one side only.
 */
const COMPANY_ID_HIDDEN_CLASS_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'input[data-name="company_id"]',
  ":class",
);
/**
 * TWO-25326 §7 replaced TWO-25288's two inline hint paragraphs
 * (`company_name_hint` / `company_id_hint`) with ONE captured-company label at
 * the top of the payment fieldset, and this file's hint assertions moved onto it
 * wholesale.
 *
 * They have since moved OFF its `x-show` again. Since the 2026-08-03 ruling on
 * TWO-25326 the label's visibility follows the order-intent notice, not capture
 * — so it is no longer the observable consequence of the derivation this file
 * tests. `COMPANY_CAPTURE_GATE_BINDING` below is: the Company Number block's
 * `:class` gate, which is still exactly "a registry number is locked in", and
 * is what the capture assertions here now read.
 *
 * TWO-25326 tile bugfix batch, bug 5 (2026-08-05 ruling): the "Change
 * company" button this bound to before is REMOVED — the search control no
 * longer hides on capture, so there is nothing left for it to reveal. The
 * Company Number block's own capture gate is UNCHANGED by that ruling (it was
 * never part of the bug), so it remains this file's read on "is captured" —
 * a string ("hidden"/"") rather than the button's own boolean `x-show`.
 *
 * The label's own two bindings are still resolved, and still from the shipped
 * markup for the same reason as the bindings above (state alone cannot fail when
 * the wire is missing on one side): `x-show` keeps the by-hand DOM mirror
 * honest, and `x-text` is still the label's text builder.
 */
const COMPANY_TILE_LABEL_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_label"]',
  "x-show",
);
const COMPANY_TILE_LABEL_TEXT_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_label"]',
  "x-text",
);
const COMPANY_CAPTURE_GATE_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'input[data-name="company_id"]',
  ":class",
);

/*
 * DELETED 2026-08-05 (TWO-25326, the one-control consolidation):
 *
 *  - `MANUAL_ENTRY_LINK_SHOW_BINDING`, read off `#billing_enter_company`. That
 *    element was the TILE'S OWN "Enter details manually" link, part of the
 *    second, divergent control this surface used to carry. The tile now includes
 *    the one shared control, whose single manual-entry route is the in-panel
 *    `.two-company-manual-entry-row`; there is no `#billing_enter_company` in the
 *    shipped markup for a binding to be read off, which is why this file could
 *    not even LOAD until the constant went.
 *  - `COMPANY_SEARCH_BLUR_BINDING`, read off the search field's `@blur`. The
 *    handler behind it (`OnCompanySearchBlur`) is deleted with the rest of the
 *    tile-local control. See the note where its describe used to be for why the
 *    guarantee it protected is now structural rather than behavioural.
 */

/**
 * The min-characters hint's own `x-show`, read out of the shipped markup.
 *
 * Survives the consolidation because the hint does: it is emitted by the shared
 * control on both surfaces, and this is still the only place the TILE'S wire —
 * that this component defines what the tile's copy of that markup names — is
 * checked. Its BEHAVIOUR is the shared control's and is covered once, in
 * company-search-min-chars.test.js.
 */

describe("payment component company selection", () => {
  let env;
  let fetchStub;
  let component;
  let watchers;

  beforeEach(() => {
    // fillCompanyData() and the order-intent guard both read these by id.
    //
    // `#company_id` starts WITHOUT a `disabled` attribute: its locked state is
    // Alpine's to apply, and hardcoding it here is how the earlier version of
    // this fixture let the suite pass with the field permanently disabled.
    // The captured-company label (TWO-25326 §7) starts with neither `hidden`
    // (on the input) nor a rendered value, for the same reason `#company_id`
    // starts without `disabled`: locked state is Alpine's to apply.
    document.body.innerHTML = [
      '<div id="payment-root">',
      '  <input type="text" id="company_name" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" value="" />',
      '  <div data-name="company_tile_label"></div>',
      "</div>",
    ].join("\n");

    // The template arms a 500ms debounce whenever `dispatch-order-intent`
    // fires. Fake timers keep that off the real clock instead of leaving a
    // timer armed behind the test.
    jest.useFakeTimers();

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();

    ({ component, watchers } = mountPaymentComponent());
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * Mount the payment component and run `initialize()`.
   *
   * `$watch` is not something `mountComponent()` supplies, because the
   * components are plain object literals rather than Alpine proxies — so it is
   * recorded here and fired by hand. That is the honest shape of the assertion
   * anyway: what matters is what the REGISTERED callback does, which is
   * exactly what the earlier inline `companyIdDisabled = !value` got wrong.
   *
   * @returns {{component: Object, watchers: Object, root: HTMLElement}}
   */
  function mountPaymentComponent() {
    const root = document.getElementById("payment-root");
    const mounted = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: root,
      root: root,
    });
    const recorded = {};
    mounted.$watch = function (name, callback) {
      recorded[name] = callback;
    };
    mounted.initialize(JSON.parse(H.QUOTE_JSON));
    // Alpine applies a binding once on init and re-runs it whenever the bound
    // property changes. `syncCompanyIdField()` is that run, by hand.
    syncCompanyIdField(mounted);
    syncCompanyIdHint(mounted);
    syncCompanyTileLabel(mounted);
    return { component: mounted, watchers: recorded, root: root };
  }

  /**
   * Apply the template's `:disabled` binding to `#company_id`, the way
   * CSP-friendly Alpine does: resolve the bare property off the component and
   * write it to the element.
   *
   * Called after each state change rather than reactively, for the same reason
   * the `$watch` callbacks are fired by hand — the mounted components are plain
   * object literals, not Alpine proxies, so nothing observes them.
   *
   * @param {Object} instance the mounted component
   * @returns {void}
   */
  function syncCompanyIdField(instance) {
    if (!(COMPANY_ID_DISABLED_BINDING in instance)) {
      throw new Error(
        "the template binds :disabled to `" +
          COMPANY_ID_DISABLED_BINDING +
          "`, which the component does not define",
      );
    }
    companyIdInput().disabled = Boolean(instance[COMPANY_ID_DISABLED_BINDING]);
  }

  /**
   * Apply the template's `:class` binding for TWO-25288's hidden company-id
   * input, the same by-hand way `syncCompanyIdField()` applies `:disabled` —
   * these mounted components are plain object literals, not Alpine proxies, so
   * nothing re-runs the bindings on its own.
   *
   * @param {Object} instance the mounted component
   * @returns {void}
   */
  function syncCompanyIdHint(instance) {
    const input = companyIdInput();
    const hiddenClass = String(instance[COMPANY_ID_HIDDEN_CLASS_BINDING] || "");
    input.className = ["company_id", hiddenClass].filter(Boolean).join(" ");
  }

  /**
   * Apply the template's `x-show` / `x-text` bindings for TWO-25326 §7's
   * captured-company label, the same by-hand way `syncCompanyIdHint()` applies
   * the input's `:class`.
   *
   * @param {Object} instance the mounted component
   * @returns {void}
   */
  function syncCompanyTileLabel(instance) {
    const label = companyTileLabel();
    label.hidden = !instance[COMPANY_TILE_LABEL_SHOW_BINDING];
    label.textContent = String(instance[COMPANY_TILE_LABEL_TEXT_BINDING] || "");
  }

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

  /** @returns {HTMLElement} the TWO-25326 §7 captured-company label */
  function companyTileLabel() {
    return document.querySelector('[data-name="company_tile_label"]');
  }

  /** @returns {HTMLInputElement} */
  function companyIdInput() {
    return document.getElementById("company_id");
  }

  /**
   * The record this component actually writes.
   *
   * The BILLING key since TWO-25326: the payment tile captures the billing
   * company and the address step captures the shipping one, into two separately
   * scoped records, because a checkout with "billing same as shipping" unticked
   * legitimately holds two different companies and one blob cannot describe
   * both.
   *
   * @returns {Object} the persisted billing-company selection
   */
  function storedSelection() {
    return JSON.parse(
      env.browserStorage.getItem(H.BILLING_COMPANY_KEY) || "{}",
    );
  }

  describe("the company-number field's locked state", () => {
    test("is a real binding in the shipped markup, not just component state", () => {
      // The assertion the rest of this file rests on. `readAlpineBinding()`
      // throws if the attribute is absent or is not a bare property name, so
      // this pins BOTH that the wire exists and that the rest of the file can
      // resolve it off the component. Deleting `:disabled="companyIdDisabled"` from
      // gateway_method.phtml fails every test in this file at load.
      expect(COMPANY_ID_DISABLED_BINDING).toBe("companyIdDisabled");
    });

    test("is the only Alpine binding carrying it — no second :style copy", () => {
      // The greyed-out look derives from `input.company_id:disabled` in
      // custom.css. A `:style` string binding here would set the whole style
      // attribute — which is where `x-show` writes `display: none` — and the two
      // bindings re-run on their own dependencies, so a state change that re-ran
      // only `:style` would reveal an element something else had hidden.
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
      const input = new DOMParser()
        .parseFromString(markup, "text/html")
        .querySelector('input[data-name="company_id"]');

      expect(input.hasAttribute(":style")).toBe(false);
      expect(component.companyIdBgStyle).toBeUndefined();

      // REWRITTEN 2026-08-05 (TWO-25326). This used to require an `x-show` on
      // this input, because the tile carried a visible/hidden MIRROR PAIR of
      // company-number inputs and `x-show` was what chose between them. There is
      // one input now, and hiding it once its value is carried by the tile label
      // is a CLASS (`companyIdHiddenClass`) rather than an inline style — so the
      // two mechanisms cannot be confused for one another, which is the whole
      // reason the production comment gives for the choice.
      expect(input.hasAttribute("x-show")).toBe(false);
      expect(input.getAttribute(":class")).toBe("companyIdHiddenClass");
      expect(typeof component.companyIdHiddenClass).toBe("string");
    });

    test("defaults to locked before initialize() runs", () => {
      // Pins the DECLARED default, not the derived one. `initialize()` calls
      // applyCompanyIdEditability() unconditionally, so every assertion made
      // after mounting holds whatever the literal says — flipping
      // `companyIdDisabled: true` to `false` left this whole file green until
      // this test existed. The literal is the state Alpine binds on first
      // paint, before initialize() has run; wrong, and the field flashes open.
      const fresh = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {});

      expect(fresh[COMPANY_ID_DISABLED_BINDING]).toBe(true);
    });

    test("is open once the component has initialized with nothing stored", () => {
      // Was pinned the other way until the re-render defect below was found.
      // `initialize()` derives the flag from the same invariant getItems()
      // uses, and with nothing stored there is no registry-supplied identifier
      // for whatever is in the name field — so the number field is fillable.
      // Nothing is at risk: locking exists to stop a registry number being
      // typed over, and empty storage has no registry number to protect.
      expect(companyIdInput().disabled).toBe(false);
    });
  });

  describe("a company that has an identifier", () => {
    test("writes name and id, and leaves the id field locked", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("12345678");
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(companyIdInput().value).toBe("12345678");
      // Locked because the buyer has nothing to add: the registry answered.
      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
    });
  });

  describe("a company whose identifier the response omitted", () => {
    test("writes the name and leaves the id field empty but editable", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("");
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(companyIdInput().value).toBe("");
      // Empty AND disabled would be an unfillable required field — the buyer
      // has to be able to type the organisation number in themselves.
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });

    test("stays editable after an identifier-bearing company locked it", () => {
      // The blocker this round was about: the field had already been disabled
      // (here by the previous selection, in production by every shipping sync),
      // so an identifier-less pick afterwards left it empty AND uneditable.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().disabled).toBe(true);

      component.selectItem(pickerItem("Other Example Ltd", ""));
      syncCompanyIdField(component);

      expect(companyIdInput().value).toBe("");
      expect(companyIdInput().disabled).toBe(false);
    });

    test("does not leave the previous company's id beside the new name", () => {
      // The wrong-data path the guard newly makes reachable, and the reason
      // fillCompanyData() no longer bails on an empty id: the buyer would have
      // seen one company's name against another company's organisation
      // number, in a field they could not correct, and the checkout would have
      // submitted the stale number.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      component.selectItem(pickerItem("Other Example Ltd", ""));

      expect(component.companyName).toBe("Other Example Ltd");
      expect(component.companyId).toBe("");
      expect(companyIdInput().value).toBe("");
      expect(storedSelection().company_name).toBe("Other Example Ltd");
      expect(storedSelection().company_id).toBe("");
    });

    test("dispatches no order intent, where an identified company does", () => {
      // Reached after an intent has already succeeded for another company, so
      // the dedup gate has a decision on record and the "not already decided"
      // half of the condition is true for an empty id — which used to fire an
      // intent for a company with no identifier at all. The listener would
      // discard it, but it would still read as a real submission in the event
      // log. Seeded through the RECORD the gate actually reads (review round 7
      // replaced a single-slot `lastOrderIntentCompanyId` with per-company
      // records); assigning the old field here left this test seeding nothing.
      component.orderIntentDecisions["11111111"] = {
        name: "Earlier Example Ltd",
        approved: true,
      };
      const dispatched = [];
      const listener = () => dispatched.push("intent");
      window.addEventListener("dispatch-order-intent", listener);

      try {
        component.selectItem(pickerItem("Example Trading Ltd", ""));
        expect(dispatched).toEqual([]);

        component.selectItem(pickerItem("Other Example Ltd", "12345678"));
        expect(dispatched).toEqual(["intent"]);
      } finally {
        window.removeEventListener("dispatch-order-intent", listener);
      }
    });

    test("selecting an identified company afterwards re-locks the field", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      expect(companyIdInput().disabled).toBe(false);

      component.selectItem(pickerItem("Other Example Ltd", "12345678"));
      syncCompanyIdField(component);

      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
      expect(companyIdInput().value).toBe("12345678");
    });

    test("leaving manual mode does not re-lock a field still to be filled", () => {
      // `companyIdEntryRequired` and `manualMode` are independent reasons the
      // field is editable. The manualMode watcher used to assign `!value`
      // outright, so entering and leaving manual entry would have locked an
      // empty required field.
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      component.manualMode = true;
      watchers.manualMode(true);
      component.manualMode = false;
      watchers.manualMode(false);
      syncCompanyIdField(component);

      expect(companyIdInput().disabled).toBe(false);
    });
  });

  /**
   * Type into the company-name field and run its real edit handler.
   *
   * `getItems` is what `@input.debounce.300ms` binds in gateway_method.phtml,
   * and it reads `this.$el.value`, so `$el` is swapped to the name input for
   * the call exactly as Alpine would bind it. The search that follows is left
   * on the wire and aborted — the subject here is the field's editability, not
   * the request.
   *
   * `isSelecting` is cleared first unless `keepSelecting` is set. That flag is
   * armed by `selectItem()` and consumed by an early return at the TOP of
   * getItems(), so the debounce tick straight after a selection is swallowed
   * whole; these tests are about the edit that follows it. The one test that
   * cares about the swallowed tick passes `keepSelecting`.
   *
   * Deliberately NOT awaited. Past the recompute, getItems() awaits a `fetch`
   * that `stubFetch()` only ever settles by hand, so awaiting it here would just
   * hang the test out to its 5s timeout. The recompute is synchronous and sits
   * above that await, so the state under test is already written by the time
   * this returns; the request is then aborted and its rejection swallowed.
   *
   * @param {string} text what the buyer typed
   * @param {{keepSelecting?: boolean}} [options]
   * @returns {void}
   */
  function typeCompanyName(text, options) {
    if (!(options && options.keepSelecting)) {
      component.isSelecting = false;
    }
    const nameInput = document.getElementById("company_name");
    nameInput.value = text;
    const previousEl = component.$el;
    component.$el = nameInput;
    try {
      // `runCompanySearch()` is the engine's own entry point and the one the
      // popover's search API drives; the deleted control's `getItems()` was a
      // wrapper around it.
      component.runCompanySearch(text).catch(() => {});
    } finally {
      component.$el = previousEl;
      component.abortCompanySearch();
    }
    syncCompanyIdField(component);
    syncCompanyTileLabel(component);
  }

  /**
   * Edit the company-name field IN MANUAL MODE, the way the shipped
   * `@input.debounce.300ms="onNameFieldInput"` binding does.
   *
   * Added 2026-08-05 (TWO-25326). This is now the ONLY path on which the field's
   * text can diverge from the captured company, so it is the path every
   * stale-company assertion in this file has to take. In search mode the field is
   * `readonly` and every editing key is prevented, and `getItems()` deliberately
   * touches neither the captured pair nor its editability — see the note above
   * describe("a captured company cannot be typed over").
   *
   * `$el` is pointed at the input because `onNameFieldInput()` resolves the field
   * through `companyNameField()`, which reads `$el` first: that is how one method
   * can be reached from the field's own binding and from a mode button and mean
   * the right element in both cases.
   *
   * @param {string} text what the buyer has left in the field
   * @returns {void}
   */
  function editNameInManualMode(text) {
    if (!component.manualMode) component.enterManually();
    const nameInput = document.getElementById("company_name");
    nameInput.value = text;
    const previousEl = component.$el;
    component.$el = nameInput;
    try {
      component.onNameFieldInput();
    } finally {
      component.$el = previousEl;
    }
    syncCompanyIdField(component);
    syncCompanyTileLabel(component);
  }

  /*
   * DELETED 2026-08-05 — describe("a name typed without picking a dropdown hit"),
   * all six tests.
   *
   * Every one of them drove `typeCompanyName()`, which writes into the
   * company-name field and calls `getItems()`, and then asserted on the
   * company-number field's editability. That worked because the name field WAS
   * the search box and `getItems()` recomputed editability from its text on every
   * keystroke.
   *
   * Neither half is true any more (TWO-25326 §1 and the 2026-08-05
   * consolidation). The search term lives in the panel's own query field, and
   * `getItems()` deliberately touches neither the captured pair nor its
   * editability in search mode — running a search is not evidence the buyer
   * edited anything, and since the name field is `readonly` there it cannot be
   * edited at all. So these tests did not merely fail; the four that still passed
   * passed VACUOUSLY, asserting a state `selectItem()` had already set and that
   * `typeCompanyName()` no longer had any way to disturb.
   *
   * The guarantees they were written for all survive, driven by the paths that
   * actually reach them:
   *
   *  - a buyer who has picked nothing gets an editable, fillable number field —
   *    describe("the company-number field's locked state") above, "is open once
   *    the component has initialized with nothing stored".
   *  - a pick with no identifier leaves it open, one with an identifier locks it —
   *    same describe, "writes the name and leaves the id field empty but
   *    editable" / "writes name and id, and leaves the id field locked".
   *  - editing the name away from a captured company re-opens it — describe("a
   *    captured company cannot be typed over") below, "and re-opens the
   *    company-number field, so the buyer can supply one", on the manual-mode path
   *    that is now the only one where the text can diverge.
   *
   * Also gone with them: "does not unlock the field on the selection keystroke
   * itself". It pinned `isSelecting`, a flag whose entire job was an early return
   * in `getItems()` ABOVE the editability recompute. There is no recompute in
   * `getItems()` for it to guard, and the flag is deleted.
   */

  describe("synced from the shipping step", () => {
    /**
     * Fire the event company-name-payment.phtml's updatePaymentFields()
     * dispatches at the component root.
     *
     * @param {string} companyName
     * @param {string} companyId
     * @returns {void}
     */
    function syncFromShipping(companyName, companyId) {
      document.getElementById("payment-root").dispatchEvent(
        new CustomEvent("update-company-data", {
          detail: { companyName: companyName, companyId: companyId },
        }),
      );
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);
    }

    test("an identifier-less shipping company unlocks the field", () => {
      // The shipping step can now hand over an empty identifier for the same
      // reason selectItem() can. Without recomputing the editability from what
      // arrived, the buyer's pick lands in a field still locked from the
      // previous one.
      syncFromShipping("Example Trading Ltd", "12345678");
      expect(companyIdInput().disabled).toBe(true);

      syncFromShipping("Other Example Ltd", "");

      expect(component.companyName).toBe("Other Example Ltd");
      expect(component.companyId).toBe("");
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
      // The exact case companyNameHintText's own doc comment calls out: a
      // shipping sync can hand over a company with no identifier, and the
      // name hint must drop with the number hint rather than keep showing
      // the PREVIOUS locked company's name.
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("an identified shipping company re-locks it", () => {
      syncFromShipping("Example Trading Ltd", "");
      expect(companyIdInput().disabled).toBe(false);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");

      syncFromShipping("Other Example Ltd", "12345678");

      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Other Example Ltd",
      );
    });
  });

  describe("restored from browser storage", () => {
    test("a stored name with no id comes back editable", () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "",
          manual_mode: false,
        }),
      );

      const restored = mountPaymentComponent().component;

      expect(restored.companyName).toBe("Example Trading Ltd");
      expect(restored.companyId).toBe("");
      expect(restored.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
      // No registry number to lock, so no read-only name to show either.
      expect(restored[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("a stored name with an id comes back locked", () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "12345678",
          manual_mode: false,
        }),
      );

      const restored = mountPaymentComponent().component;

      expect(restored.companyId).toBe("12345678");
      expect(restored.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
      // The other path companyNameHintText's doc comment calls out: the
      // restore happens through initialize()'s pre-$nextTick synchronous
      // derivation, same as the id hint, so the name hint must land already
      // showing the restored company -- not empty, not the wrong company.
      expect(restored[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(restored[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Example Trading Ltd",
      );
    });

    test("nothing stored leaves the field open", () => {
      // Companion to the assertion above, on the flag rather than the field.
      // Pinned as `false` / locked before the re-render defect was found; only
      // `selectItem()` writes storage, so "nothing stored" is also the state a
      // buyer who typed a name and never picked one is in.
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });
  });

  /**
   * Magewire re-renders destroy and rebuild this component, so `initialize()`
   * runs again on state the buyer has already produced — it is a re-entry
   * point, not just first paint. `mountPaymentComponent()` is exactly that
   * rebuild: a fresh instance over the same DOM and the same browser storage.
   *
   * In search mode `getItems()` writes NOTHING — not state, not storage.
   * Storage is written by `selectItem()` and by the manual-entry commit alone, so
   * a search run without a pick survives a re-render as nothing at all — which is
   * precisely why `initialize()` has to derive the flag from the same invariant
   * rather than from `Boolean(company_name) && !company_id`.
   */
  describe("re-initialized by a Magewire re-render", () => {
    test("keeps the field open after a search run without picking", () => {
      // RENAMED from "after a name typed without picking" (TWO-25326,
      // 2026-08-05): the company-name field is `readonly` in search mode, so
      // "typed" is no longer a thing that can happen on this path. Running a
      // search and picking nothing is, and it leaves storage untouched — which is
      // the premise the assertion below actually rests on.
      typeCompanyName("Example Trading");
      expect(companyIdInput().disabled).toBe(false);
      expect(storedSelection().company_name).toBeUndefined();

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });

    test("stays open across a re-render after editing a picked company's name", () => {
      // REWRITTEN 2026-08-05 (TWO-25326) — driven through the MANUAL-mode edit
      // path instead of `typeCompanyName()`. The guarantee is unchanged and is the
      // one that costs money: a rebuild must never restore a name/number pair
      // describing two different companies. What changed is that a search-mode
      // keystroke is no longer a way to reach the divergence — the field is
      // `readonly` there — so the only path that can is the manual one, and that
      // is what this now drives.
      //
      // The original defect this replaced: the recompute in `getItems()` wrote
      // component state only, so storage kept the picked company's identifier and
      // the rebuild restored it wholesale, re-locking the field and putting
      // company A's registry number back beside a name the buyer had typed over.
      // `commitManualCompany()` → `forgetStaleCompanyId()` drops the identifier
      // from STORAGE as well as state, so the rebuild has nothing to re-lock with.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      editNameInManualMode("Other Example");
      expect(companyIdInput().disabled).toBe(false);
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_id_source).toBe("");

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });

    test("does not revert the typed name to the abandoned company's", () => {
      // The gap the first version of the stale-company clear left: it dropped
      // `company_id` / `company_id_source` from the billing record but left
      // `company_name` holding company A. `initialize()` restores `search`
      // from that key on every re-render, and the field it restores into IS
      // `payment[company_name]` — so a term change, an address change or a
      // totals refresh silently put company A's name back over the text the
      // buyer had typed, and the order would have been placed for A.
      //
      // REWRITTEN 2026-08-05 (TWO-25326), for the same reason as the test above,
      // and with one assertion corrected rather than merely re-routed. It used to
      // require the record's `company_name` to be BLANKED. `commitManualCompany()`
      // writes the buyer's own text there instead, which is strictly better: the
      // name the order carries is the one in the field, so the rebuild restores
      // that rather than restoring nothing and depending on the DOM value
      // surviving. What must not happen — company A's name coming back — is
      // asserted directly.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      expect(storedSelection().company_name).toBe("Example Trading Ltd");

      editNameInManualMode("Other Example");

      expect(storedSelection().company_name).toBe("Other Example");
      expect(storedSelection().company_id).toBe("");

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.search).toBe("Other Example");
      expect(rebuilt.search).not.toBe("Example Trading Ltd");
      expect(rebuilt.companyName).not.toBe("Example Trading Ltd");
      expect(document.getElementById("company_name").value).toBe(
        "Other Example",
      );
    });

    test("keeps the field locked after a pick that had an identifier", () => {
      // The other half of the invariant, and the reason this is not a blanket
      // unlock: the registry answered, so the number stays untypeable.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().disabled).toBe(true);

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
    });

    test("keeps the field open after a pick that had no identifier", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      expect(companyIdInput().disabled).toBe(false);

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });
  });

  describe("the capture gate (TWO-25326 §7) and the hidden number input", () => {
    test("stays hidden with an empty class before any company is picked", () => {
      // `companyIdDisabled` defaults locked, but with nothing stored
      // `initialize()` derives it open (see the earlier "is open once the
      // component has initialized" test) — so on first paint there is
      // neither a locked field nor a hint to show.
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("");
      expect(companyIdInput().disabled).toBe(false);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("shows the id and hides the redundant input once a company locks it", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      syncCompanyIdHint(component);

      // Same invariant `companyIdDisabled` already asserts on above: locked
      // exactly when the registry answered.
      expect(companyIdInput().disabled).toBe(true);
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("hidden");
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain("12345678");
    });

    test("never hides the input while it is still empty and editable", () => {
      // The failure mode the scoped fix was explicitly told not to risk: a
      // company found via search but with no registry identifier still needs
      // the buyer to be able to see and type into the field.
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      syncCompanyIdHint(component);

      expect(companyIdInput().disabled).toBe(false);
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("");
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("re-reveals the input if a later pick has no identifier", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      syncCompanyIdHint(component);
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("hidden");

      component.selectItem(pickerItem("Other Example Ltd", ""));
      syncCompanyIdField(component);
      syncCompanyIdHint(component);

      expect(companyIdInput().disabled).toBe(false);
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("");
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("`companyIdHiddenClass` can never fire unless `companyIdDisabled` is also true", () => {
      // Pins the derivation itself, not just today's scenarios: the hidden
      // class must never be able to go true while the disabled binding is
      // false, whatever manualMode, companyIdEntryRequired or companyId end
      // up being — companyIdDisabled=false is exactly the "buyer still needs
      // this field" state the brief said must never be hidden. This is a
      // one-way implication, not an iff: see the next test for the case
      // where companyIdDisabled is true but the hidden class must STILL not
      // fire yet.
      [
        [false, false, ""],
        [false, false, "12345678"],
        [false, true, ""],
        [false, true, "12345678"],
        [true, false, ""],
        [true, false, "12345678"],
        [true, true, ""],
        [true, true, "12345678"],
      ].forEach(([manualMode, companyIdEntryRequired, companyId]) => {
        component.manualMode = manualMode;
        component.companyIdEntryRequired = companyIdEntryRequired;
        component.companyId = companyId;
        component.applyCompanyIdEditability();

        if (component[COMPANY_ID_HIDDEN_CLASS_BINDING] === "hidden") {
          expect(component[COMPANY_ID_DISABLED_BINDING]).toBe(true);
        }
      });
    });

    test("stays visible mid-initialize(), before fillCompanyData()'s $nextTick has run", () => {
      // The review-round regression (TWO-25288): a restored selection derives
      // `companyIdEntryRequired` — and so `companyIdDisabled` — synchronously
      // in initialize(), straight from storage, while `this.companyId`
      // itself is only written by the `$nextTick(() => fillCompanyData(...))`
      // scheduled at the end of that same method. Between those two points
      // `companyIdDisabled` can be true with `companyId` still empty; the
      // hint and the hidden class must both wait for the real value rather
      // than flashing "Company number: " with nothing after it.
      component.companyIdEntryRequired = false;
      component.companyId = "";
      component.applyCompanyIdEditability();
      syncCompanyIdHint(component);
      syncCompanyIdField(component);

      expect(component[COMPANY_ID_DISABLED_BINDING]).toBe(true);
      expect(companyIdInput().disabled).toBe(true);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("");

      // The tick after: fillCompanyData() (or the $nextTick callback in
      // initialize()) writes the real id, and only then does the hint take
      // over from the (still-locked, still-visible) input.
      component.companyId = "12345678";
      syncCompanyIdHint(component);
      syncCompanyIdField(component);

      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_ID_HIDDEN_CLASS_BINDING]).toBe("hidden");
    });
  });

  describe("the capture gate — stale safety", () => {
    test("stays hidden before any company is picked", () => {
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("the capture gate trips once a company locks the id field", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);

      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Example Trading Ltd",
      );
    });

    test("stays hidden for a pick with no identifier — nothing is locked", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);

      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    /**
     * The stale-safety property the brief exists to prove: a name hint keyed
     * on `companyName` directly would still show the OLD company here, because
     * `companyName` has no clearing writer. Gated on `companyIdHintVisible`
     * instead, it must disappear the instant the buyer's edit reopens the
     * id field.
     *
     * REWRITTEN 2026-08-05 (TWO-25326): driven through the manual-mode edit path
     * rather than `typeCompanyName()`. In search mode the name field is `readonly`
     * and `getItems()` deliberately recomputes nothing, so a keystroke there can
     * no longer reach this state at all — the assertion would have held vacuously
     * off `selectItem()` alone.
     */
    test("goes stale-safe: drops when the buyer edits the name after a pick, before any new pick exists", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Example Trading Ltd",
      );

      editNameInManualMode("Other Example");

      // The field is open again (companyIdEntryRequired recomputed true), and
      // the capture gate — which would otherwise keep the whole Company Number
      // block hidden beside a field the buyer can now edit freely — has gone
      // with it.
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("re-trips once the buyer picks a new identified company", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      // Manual-mode edit, for the same reason as the test above.
      editNameInManualMode("Other Example");
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");

      component.selectItem(pickerItem("Other Example Ltd", "87654321"));
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);

      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Other Example Ltd",
      );
    });

    test("the capture gate never trips while the company-number field is still editable", () => {
      // The one-way implication that matters: capture hides the Company
      // Number block, so it must never be able to trip while the buyer still
      // needs to fill that field in. Pins the derivation across every
      // editability combination rather than today's scenarios.
      //
      // Read off the Company Number block's own gate, not the label's — the
      // label follows the order-intent notice since the 2026-08-03 ruling and
      // would make this pass vacuously.
      [
        [false, false, ""],
        [false, false, "12345678"],
        [false, true, ""],
        [false, true, "12345678"],
        [true, false, ""],
        [true, false, "12345678"],
        [true, true, ""],
        [true, true, "12345678"],
      ].forEach(([manualMode, companyIdEntryRequired, companyId]) => {
        component.manualMode = manualMode;
        component.companyIdEntryRequired = companyIdEntryRequired;
        component.companyId = companyId;
        component.companyName = "Some Company Ltd";
        component.applyCompanyIdEditability();

        if (component[COMPANY_CAPTURE_GATE_BINDING]) {
          expect(component[COMPANY_ID_DISABLED_BINDING]).toBe(true);
          expect(component.companyId).toBeTruthy();
        }
      });
    });
  });

  /*
   * DELETED 2026-08-05 — describe("the 'Enter details manually' link (TWO-25326
   * tile bugfix batch, bug 1)"), all five tests.
   *
   * Every one of them asserted that the tile's own manual-entry link stayed
   * HIDDEN until the buyer had typed something, on the reasoning that the link
   * sat inside a dropdown which opened on mere FOCUS, so an unguarded link
   * painted the instant the field was focused and read as permanent furniture.
   *
   * All three premises are gone, and the requirement is now the OPPOSITE of what
   * these tests pinned:
   *
   *  - there is no tile-local link. The tile includes the one shared control,
   *    whose single manual-entry route is the in-panel
   *    `.two-company-manual-entry-row`.
   *  - the panel no longer opens on focus. `onCompanyNameClick` opens it on CLICK
   *    or keypress, deliberately not on focus, so merely tabbing through leaves it
   *    shut — which is what removed the "paints on focus" artefact structurally.
   *  - the row is now REQUIRED to be on offer from zero typed characters. It has
   *    to be reachable exactly when the buyer cannot find their company, which
   *    includes before they have typed and when a search matched nothing; gating
   *    it on a typed length made it unreachable in the cases it exists for.
   *
   * Not rewritten here because the replacement guarantee is not tile-specific:
   * `company-search-one-control.test.js` pins it once for both surfaces — "there
   * is exactly one manual-entry control, and it is inside the panel", "the
   * below-the-field copy and its gate are gone", and "the panel is still
   * reachable, and the row with it, before anything is typed".
   *
   * DELETED with them — describe("the min-characters hint (TWO-25326 tile bugfix
   * batch, bug 1)"), four of its five tests. They drove the hint through
   * `twoGatewayHyvaOnCompanySearchFocus()` (deleted) and measured it against
   * `search`, the company-name field's text. The shared control's hint measures
   * the PANEL'S QUERY instead and, like the row, deliberately shows from ZERO
   * characters — so "stays hidden before the buyer has typed anything" is now a
   * statement of the defect rather than the fix. The behaviour is covered once, on
   * the shared getter, in company-search-min-chars.test.js.
   *
   * The WIRE test is kept below, because that part is genuinely per-surface: it is
   * the tile's copy of the markup and the tile's component that have to agree.
   */
  describe("the min-characters threshold reaches the popover", () => {
    test("the search API hands the panel this component's own threshold", () => {
      // The hint's markup is the shared panel's now, but the NUMBER is still
      // this checkout's — emitted from PHP, never a literal — and it has to
      // reach the panel or the count the buyer is told drifts from the one
      // enforced.
      // Asserted on the number, not the message: the harness resolves every
      // `__()` to one placeholder, so an assertion on the rendered hint could
      // not tell the threshold from any other string.
      expect(component.companyPopoverSearchApi().MIN_INPUT_LENGTH).toBe(
        component.minSearchChars,
      );
    });
  });

  /**
   * REWRITTEN 2026-08-05 (TWO-25326, the one-control consolidation) — was
   * describe("typing over a captured company (TWO-25326 bug 5 follow-up)").
   *
   * The requirement is unchanged and is the one the money rides on: an order must
   * never carry a company name and a registry number describing two different
   * companies. What changed is the MECHANISM, and every one of the eight tests
   * here drove the old one.
   *
   * Bug 5 removed the "Change company" swap, leaving the search field visible and
   * apparently editable after a capture. The tile's answer was a pair of
   * tile-local handlers — `@blur` → `OnCompanySearchBlur` and
   * `ForgetCompanyIfNameDiverged` — that watched for the field's text diverging
   * from the captured name and dropped `companyId`/`companyName` when it did.
   * Both are deleted with the rest of the tile-local control, and the harness
   * cannot even read a `@blur` binding off the shipped markup any more.
   *
   * The replacement is structural, and strictly stronger than a handler that has
   * to notice divergence after the fact: in SEARCH mode the name field is
   * `:readonly="searchModeActive"` AND `onCompanyNameKeydown` prevents every
   * editing key, so the text cannot diverge at all. `readonly` is what covers the
   * routes a keydown guard cannot see — paste, text drag-drop, browser autofill —
   * which were live holes in the old handler-based approach: it only ran on blur,
   * so a buyer who pasted a name and hit Place Order inside the same interaction
   * submitted the mismatched pair the old tests were written to prevent.
   *
   * Divergence remains possible in MANUAL mode, where the field IS the capture
   * control, and there `onNameFieldInput()` → the engine's
   * `commitManualCompany()` → `forgetStaleCompanyId()` is the one writer. That is
   * what the tests below drive.
   */
  describe("a captured company cannot be typed over (TWO-25326 bug 5 follow-up)", () => {
    test("in search mode the field publishes nothing the buyer types", () => {
      /*
       * The field is deliberately NOT `readonly` any more. The shared popover
       * binds `input` on it and moves whatever arrives — typed, pasted or
       * composed through an IME — into its own query box, which a readonly
       * field cannot receive at all; seeding off `input` rather than `keydown`
       * is the only thing that makes paste and IME work.
       *
       * So the guarantee is no longer "it cannot be typed into". It is that
       * typing there publishes nothing: the commit path returns early outside
       * manual mode, and the popover restores the captured name.
       */
      component.manualMode = false;
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      const nameInput = document.getElementById("company_name");
      nameInput.value = "Other Exampl";
      const previousEl = component.$el;
      component.$el = nameInput;
      try {
        component.onNameFieldInput();
      } finally {
        component.$el = previousEl;
      }

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("12345678");

      // And no `@blur` handler is left behind claiming to do this job. A second,
      // stale mechanism alongside it is how the two disagreed.
      expect(() =>
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_name"]',
          "@blur",
        ),
      ).toThrow(/has no `@blur` binding/);
    });

    test("running a search does NOT drop the captured pair", () => {
      // The inverse of what the deleted tests asserted, and deliberate: reopening
      // the panel to look at alternatives is not evidence the buyer edited
      // anything, and `getItems()` used to recompute editability off the name
      // field's text. Since the name field cannot be edited in search mode, a
      // stale-identifier clear here could only ever throw away a good pick.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().value).toBe("12345678");

      typeCompanyName("Other Example");

      expect(component.companyId).toBe("12345678");
      expect(companyIdInput().value).toBe("12345678");
      expect(storedSelection().company_id).toBe("12345678");
    });

    test("a manual-mode name edit drops the identifier from state, storage and the submitted input", () => {
      // Manual mode is where the field genuinely IS the capture control, so this
      // is the one path on which the text can diverge from the captured company.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().value).toBe("12345678");
      expect(storedSelection().company_id).toBe("12345678");

      editNameInManualMode("Other Example");

      expect(component.companyId).toBe("");
      expect(component.companyIdSource).toBe("");
      expect(component.isCompanySelected).toBe(false);
      // The one the money rides on: the submitted registry number.
      expect(companyIdInput().value).toBe("");
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_id_source).toBe("");
      // And the typed name is what the order will carry, published under the
      // buyer's own text rather than the abandoned company's.
      expect(storedSelection().company_name).toBe("Other Example");
    });

    test("and re-opens the company-number field, so the buyer can supply one", () => {
      // Dropping the identifier without unlocking the field leaves a required
      // input that is empty AND uneditable — the checkout blocker this ticket's
      // editability rule exists for.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().disabled).toBe(true);

      editNameInManualMode("Other Example");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });

    test("a manual-mode edit back to the SAME name keeps the pick", () => {
      // The guard rail, and the reason `forgetStaleCompanyId()` compares the text
      // against the captured name rather than clearing unconditionally. A
      // synthetic re-fire of the edit handler must not throw away a good pick.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      component.enterManually();

      editNameInManualMode("Example Trading Ltd");

      expect(component.companyId).toBe("12345678");
      expect(component.companyName).toBe("Example Trading Ltd");
      expect(storedSelection().company_id).toBe("12345678");
    });

    test("the identifier the buyer never touched survives a mode bounce", () => {
      // enterManually() deliberately does not clear a previous pick, so entering
      // and leaving manual mode without typing must leave everything as it was.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);

      component.enterManually();
      component.enableSearch();
      syncCompanyIdField(component);

      expect(component.companyId).toBe("12345678");
      expect(companyIdInput().value).toBe("12345678");
      expect(companyIdInput().disabled).toBe(true);
    });
  });
});
