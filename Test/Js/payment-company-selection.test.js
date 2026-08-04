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

/**
 * TWO-25326 tile bugfix batch, bug 1. The "Enter details manually" link's own
 * `x-show`, read out of the shipped markup — nested inside the dropdown's own
 * `x-show="isOpen"`, so the effective visibility is both together.
 */
const MANUAL_ENTRY_LINK_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  "#billing_enter_company",
  "x-show",
);

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
      // attribute, which is where the element's own `x-show` writes
      // `display: none` — and the two bindings re-run on their own
      // dependencies, so a state change that re-ran only `:style` would reveal
      // the hidden mirror input.
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
      const input = new DOMParser()
        .parseFromString(markup, "text/html")
        .querySelector('input[data-name="company_id"]');

      expect(input.hasAttribute("x-show")).toBe(true);
      expect(input.hasAttribute(":style")).toBe(false);
      expect(component.companyIdBgStyle).toBeUndefined();
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
      // Reached after an intent has already succeeded for another company:
      // `lastOrderIntentCompanyId` is then non-empty, so the "id changed"
      // condition is true for an empty id and used to fire an intent for a
      // company with no identifier. The listener would discard it, but it
      // would still read as a real submission in the event log.
      component.lastOrderIntentCompanyId = "11111111";
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
      component.getItems().catch(() => {});
    } finally {
      component.$el = previousEl;
      component.abortCompanySearch();
    }
    syncCompanyIdField(component);
    syncCompanyTileLabel(component);
  }

  describe("a name typed without picking a dropdown hit", () => {
    test("leaves the company-number field enabled and fillable", () => {
      // The checkout blocker: `:disabled="companyIdDisabled"` with a declared
      // default of `true` means the field starts locked, and a buyer who types
      // a name and never picks a hit had no way out — the "Enter details
      // manually" link lives inside the dropdown's `x-show="isOpen"`, so it is
      // gone the moment they tab away. Empty AND disabled AND required.
      typeCompanyName("Example Trading");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(document.getElementById("company_id").disabled).toBe(false);

      // Fillable, not merely unlocked — the buyer can get a number in.
      companyIdInput().value = "12345678";
      expect(companyIdInput().value).toBe("12345678");
    });

    test("is enabled even below the search minimum length", () => {
      // The `search.length < 3` early return is upstream of any request but
      // downstream of the recompute, so the field must already be open while
      // the buyer is still on their first two characters.
      typeCompanyName("Ex");

      expect(document.getElementById("company_id").disabled).toBe(false);
    });

    test("re-enables it after an identified company had locked it", () => {
      // The stale-number case: the buyer picks a company, then edits the name.
      // The registry number on screen belongs to the OLD name, so it must stop
      // being locked in beside the new text.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().disabled).toBe(true);

      typeCompanyName("Other Example");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(document.getElementById("company_id").disabled).toBe(false);
    });

    test("keeps it locked while the text still matches the picked company", () => {
      // The hole the binding exists to close. Re-running the edit handler with
      // the selected company's own name unchanged must NOT hand the buyer an
      // editable registry-supplied organisation number.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      typeCompanyName("Example Trading Ltd");

      expect(component.companyIdEntryRequired).toBe(false);
      expect(document.getElementById("company_id").disabled).toBe(true);
    });

    test("keeps it enabled while the text matches an identifier-less pick", () => {
      // Same path, the other way: a pick that carried no identifier must stay
      // open even though the name still matches it.
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      typeCompanyName("Example Trading Ltd");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(document.getElementById("company_id").disabled).toBe(false);
    });

    test("does not unlock the field on the selection keystroke itself", () => {
      // `selectItem()` sets `isSelecting`, which getItems() consumes in an
      // early return ABOVE the recompute. If the recompute ran there it would
      // undo the lock the selection had just applied.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      expect(component.isSelecting).toBe(true);

      typeCompanyName("Something Else Entirely", { keepSelecting: true });

      expect(component.companyIdEntryRequired).toBe(false);
      expect(document.getElementById("company_id").disabled).toBe(true);
    });
  });

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
   * The recompute in `getItems()` writes component state only. Storage is
   * written by `selectItem()` alone, so a typed-but-unpicked name survives a
   * re-render as nothing at all — which is precisely why `initialize()` has to
   * derive the flag from the same invariant rather than from
   * `Boolean(company_name) && !company_id`.
   */
  describe("re-initialized by a Magewire re-render", () => {
    test("keeps the field open after a name typed without picking", () => {
      typeCompanyName("Example Trading");
      expect(companyIdInput().disabled).toBe(false);
      expect(storedSelection().company_name).toBeUndefined();

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });

    test("re-locks after editing a picked company's name, and restores that company", () => {
      // The one case where the re-render does NOT preserve what the recompute
      // produced, pinned deliberately rather than left to be rediscovered.
      //
      // Editing the name after a pick leaves storage holding the PICKED
      // company, name and identifier together — `getItems()` writes component
      // state only. So the rebuild restores that company wholesale: the
      // `$nextTick` in `initialize()` puts `company_name` back in the name
      // field and `company_id` back in the number field, and the number is once
      // again registry-supplied FOR THE NAME BESIDE IT. Locked is then correct,
      // and unlocking here would reopen exactly the hole the binding exists to
      // close — a registry organisation number typeable over by hand.
      //
      // What the buyer loses is the half-typed name, which is the pre-existing
      // "storage wins over a transient edit" behaviour of the restore, not this
      // binding's doing. The name/number pair never disagrees, which is the
      // property that costs money.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      typeCompanyName("Other Example");
      expect(companyIdInput().disabled).toBe(false);
      expect(storedSelection().company_id).toBe("12345678");

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
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

  describe("the dropdown's x-for key", () => {
    test("stays unique across two hits that both lack an identifier", () => {
      // `:key` is bound to this getter in gateway_method.phtml. Alpine renders
      // one row per DISTINCT key, so two hits colliding on '' would silently
      // cost the buyer one of the companies that matched.
      const first = Object.assign(Object.create(component), {
        item: pickerItem("Example Trading Ltd", ""),
        index: 0,
      });
      const second = Object.assign(Object.create(component), {
        item: pickerItem("Other Example Ltd", ""),
        index: 1,
      });

      const firstKey = first.twoGatewayHyvaGetCompanyId();
      const secondKey = second.twoGatewayHyvaGetCompanyId();

      expect(firstKey).toBeTruthy();
      expect(secondKey).toBeTruthy();
      expect(firstKey).not.toBe(secondKey);
    });

    test("is the identifier itself when there is one", () => {
      const row = Object.assign(Object.create(component), {
        item: pickerItem("Example Trading Ltd", "12345678"),
        index: 0,
      });

      expect(row.twoGatewayHyvaGetCompanyId()).toBe("12345678");
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
     * id field — same tick `getItems()` recomputes `companyIdEntryRequired`
     * for text that no longer matches the locked pick.
     */
    test("goes stale-safe: drops when the buyer types after a pick, before any new pick exists", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      syncCompanyTileLabel(component);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("hidden");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Example Trading Ltd",
      );

      typeCompanyName("Other Example");

      // The field is open again (companyIdEntryRequired recomputed true), and
      // the name hint — still reading `this.companyName`, which typing alone
      // never clears — must have gone with it rather than keep showing
      // "Example Trading Ltd" beside a field the buyer can now edit freely.
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
      expect(component[COMPANY_CAPTURE_GATE_BINDING]).toBe("");
    });

    test("re-trips once the buyer picks a new identified company", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      typeCompanyName("Other Example");
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

  describe("the 'Enter details manually' link (TWO-25326 tile bugfix batch, bug 1)", () => {
    test("is a real binding, not just component state", () => {
      // Pins the wire: a rename on one side only must fail here, not silently
      // paint nothing.
      expect(MANUAL_ENTRY_LINK_SHOW_BINDING).toBe("manualEntryLinkVisible");
      expect(MANUAL_ENTRY_LINK_SHOW_BINDING in component).toBe(true);
    });

    test("stays hidden on mere focus, before the buyer has typed anything", () => {
      // OnCompanySearchFocus opens the dropdown (isOpen = true) on FOCUS
      // ALONE, before any search has run — at which point `items` is empty
      // and there is nothing to have "not found a match" for yet. Without the
      // fix this link (nested inside `x-show="isOpen"`) painted the instant
      // the field was focused, reading as a link sitting permanently below
      // the field rather than a genuine dropdown/results-area affordance.
      component.twoGatewayHyvaOnCompanySearchFocus();

      expect(component.isOpen).toBe(true);
      expect(component.search).toBe("");
      expect(component[MANUAL_ENTRY_LINK_SHOW_BINDING]).toBe(false);
    });

    test("appears once the buyer has actually typed something", () => {
      component.twoGatewayHyvaOnCompanySearchFocus();
      typeCompanyName("E");

      expect(component.isOpen).toBe(true);
      expect(component[MANUAL_ENTRY_LINK_SHOW_BINDING]).toBe(true);
    });

    test("goes back to hidden once the buyer clears the field again", () => {
      typeCompanyName("Example");
      expect(component[MANUAL_ENTRY_LINK_SHOW_BINDING]).toBe(true);

      typeCompanyName("");

      expect(component[MANUAL_ENTRY_LINK_SHOW_BINDING]).toBe(false);
    });

    test("does not affect the dropdown opening on real results — isOpen is separate", () => {
      // The fix adds a SECOND gate; it must not change when the dropdown
      // itself opens.
      component.items = [{ companyName: "Example Trading Ltd", companyId: "" }];
      component.isOpen = true;

      expect(component[MANUAL_ENTRY_LINK_SHOW_BINDING]).toBe(false);
      component.search = "Example";
      expect(component[MANUAL_ENTRY_LINK_SHOW_BINDING]).toBe(true);
    });
  });
});
