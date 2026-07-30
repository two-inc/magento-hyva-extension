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
 * Every editability assertion here lands on `#company_id`.readOnly, through the
 * REAL `:readonly` expression read out of `gateway_method.phtml` by
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
 * `:readonly`, read from the shipped template.
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
const COMPANY_ID_READONLY_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'input[data-name="company_id"]',
  ":readonly",
);

/**
 * The company-number input must be locked with `readonly` and NEVER `disabled`
 * (TWO-25288): it is the element the place-order path reads the submitted
 * `payment[company_id]` off, and a `disabled` input is omitted from a native
 * form submission entirely.
 *
 * `readAlpineBinding()` throws on a binding that is not there, so this is the
 * assertion — resolved at require time, like the one above, so a template that
 * has gone back to `:disabled` cannot load this file at all.
 */
const COMPANY_ID_DISABLED_BINDING_IS_ABSENT = (() => {
  try {
    H.readAlpineBinding(
      H.GATEWAY_METHOD_MARKUP_TEMPLATE,
      'input[data-name="company_id"]',
      ":disabled",
    );
  } catch (error) {
    return /has no `:disabled` binding/.test(String(error.message));
  }
  return false;
})();

/**
 * The bindings the read-only company-NAME display adds (TWO-25288). Resolved
 * the same way and for the same reason as `COMPANY_ID_READONLY_BINDING` above:
 * a test asserting on component state alone cannot fail when the markup binding
 * is missing or renamed on one side only.
 */
const COMPANY_NAME_DISPLAY_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'p[data-name="company_name_display"]',
  "x-show",
);
const COMPANY_NAME_DISPLAY_TEXT_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'p[data-name="company_name_display"]',
  "x-text",
);

describe("payment component company selection", () => {
  let env;
  let fetchStub;
  let component;
  let watchers;

  beforeEach(() => {
    // fillCompanyData() and the order-intent guard both read these by id.
    //
    // `#company_id` starts WITHOUT a `readonly` attribute: its locked state is
    // Alpine's to apply, and hardcoding it here is how the earlier version of
    // this fixture let the suite pass with the field permanently locked.
    //
    // It carries the real `name="payment[company_id]"` and sits inside a real
    // `<form>`, because the payload assertions below serialize that form the way
    // a browser would — the whole reason the lock is `readonly` and not
    // `disabled` (TWO-25288).
    document.body.innerHTML = [
      '<form id="payment-form">',
      '<div id="payment-root">',
      '  <input type="text" id="company_name" name="payment[company_name]" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" name="payment[company_id]" value="" />',
      '  <p data-name="company_name_display"></p>',
      "</div>",
      "</form>",
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
    return { component: mounted, watchers: recorded, root: root };
  }

  /**
   * Apply the template's `:readonly` binding to `#company_id`, the way
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
    if (!(COMPANY_ID_READONLY_BINDING in instance)) {
      throw new Error(
        "the template binds :readonly to `" +
          COMPANY_ID_READONLY_BINDING +
          "`, which the component does not define",
      );
    }
    companyIdInput().readOnly = Boolean(instance[COMPANY_ID_READONLY_BINDING]);
  }

  /**
   * Apply the template's `x-show` / `x-text` bindings for the read-only
   * company-name display (TWO-25288), the same by-hand way
   * `syncCompanyIdField()` applies `:readonly`.
   *
   * @param {Object} instance the mounted component
   * @returns {void}
   */
  function syncCompanyNameDisplay(instance) {
    [COMPANY_NAME_DISPLAY_SHOW_BINDING, COMPANY_NAME_DISPLAY_TEXT_BINDING]
      .filter((name) => !(name in instance))
      .forEach((name) => {
        throw new Error(
          "the template binds the company-name display to `" +
            name +
            "`, which the component does not define",
        );
      });
    const display = companyNameDisplay();
    display.hidden = !instance[COMPANY_NAME_DISPLAY_SHOW_BINDING];
    display.textContent = String(
      instance[COMPANY_NAME_DISPLAY_TEXT_BINDING] || "",
    );
  }

  /** @returns {HTMLElement} the read-only company-name display (TWO-25288) */
  function companyNameDisplay() {
    return document.querySelector('p[data-name="company_name_display"]');
  }

  /**
   * Serialize the payment form the way a browser submitting it would.
   *
   * This is the assertion that matters for TWO-25288: `FormData` omits a
   * DISABLED control and includes a READONLY one, so this is what tells a
   * `readonly` lock apart from a `disabled` one — component state cannot, and
   * neither can a `querySelector(...).value` read, which sees both.
   *
   * @returns {Object<string, string>} submitted name -> value
   */
  function submittedPayload() {
    return Object.fromEntries(
      new FormData(document.getElementById("payment-form")).entries(),
    );
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

  /** @returns {HTMLInputElement} */
  function companyIdInput() {
    return document.getElementById("company_id");
  }

  /** @returns {Object} the persisted shipping-company selection */
  function storedSelection() {
    return JSON.parse(
      env.browserStorage.getItem(H.COMPANY_SELECTION_KEY) || "{}",
    );
  }

  describe("the company-number field's locked state", () => {
    test("is a real binding in the shipped markup, not just component state", () => {
      // The assertion the rest of this file rests on. `readAlpineBinding()`
      // throws if the attribute is absent or is not a bare property name, so
      // this pins BOTH that the wire exists and that the rest of the file can
      // resolve it off the component. Deleting `:readonly="companyIdDisabled"` from
      // gateway_method.phtml fails every test in this file at load.
      expect(COMPANY_ID_READONLY_BINDING).toBe("companyIdDisabled");
    });

    test("is the only Alpine binding carrying it — no second :style copy", () => {
      // The greyed-out look derives from `input.company_id[readonly]` in
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

      expect(fresh[COMPANY_ID_READONLY_BINDING]).toBe(true);
    });

    test("is open once the component has initialized with nothing stored", () => {
      // Was pinned the other way until the re-render defect below was found.
      // `initialize()` derives the flag from the same invariant getItems()
      // uses, and with nothing stored there is no registry-supplied identifier
      // for whatever is in the name field — so the number field is fillable.
      // Nothing is at risk: locking exists to stop a registry number being
      // typed over, and empty storage has no registry number to protect.
      expect(companyIdInput().readOnly).toBe(false);
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
      expect(companyIdInput().readOnly).toBe(true);
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
      expect(companyIdInput().readOnly).toBe(false);
    });

    test("stays editable after an identifier-bearing company locked it", () => {
      // The blocker this round was about: the field had already been disabled
      // (here by the previous selection, in production by every shipping sync),
      // so an identifier-less pick afterwards left it empty AND uneditable.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().readOnly).toBe(true);

      component.selectItem(pickerItem("Other Example Ltd", ""));
      syncCompanyIdField(component);

      expect(companyIdInput().value).toBe("");
      expect(companyIdInput().readOnly).toBe(false);
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
      expect(companyIdInput().readOnly).toBe(false);

      component.selectItem(pickerItem("Other Example Ltd", "12345678"));
      syncCompanyIdField(component);

      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().readOnly).toBe(true);
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

      expect(companyIdInput().readOnly).toBe(false);
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
  }

  describe("a name typed without picking a dropdown hit", () => {
    test("leaves the company-number field enabled and fillable", () => {
      // The checkout blocker: `:readonly="companyIdDisabled"` with a declared
      // default of `true` means the field starts locked, and a buyer who types
      // a name and never picks a hit had no way out — the "Enter details
      // manually" link lives inside the dropdown's `x-show="isOpen"`, so it is
      // gone the moment they tab away. Empty AND disabled AND required.
      typeCompanyName("Example Trading");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(document.getElementById("company_id").readOnly).toBe(false);

      // Fillable, not merely unlocked — the buyer can get a number in.
      companyIdInput().value = "12345678";
      expect(companyIdInput().value).toBe("12345678");
    });

    test("is enabled even below the search minimum length", () => {
      // The `search.length < 3` early return is upstream of any request but
      // downstream of the recompute, so the field must already be open while
      // the buyer is still on their first two characters.
      typeCompanyName("Ex");

      expect(document.getElementById("company_id").readOnly).toBe(false);
    });

    test("re-enables it after an identified company had locked it", () => {
      // The stale-number case: the buyer picks a company, then edits the name.
      // The registry number on screen belongs to the OLD name, so it must stop
      // being locked in beside the new text.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().readOnly).toBe(true);

      typeCompanyName("Other Example");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(document.getElementById("company_id").readOnly).toBe(false);
    });

    test("keeps it locked while the text still matches the picked company", () => {
      // The hole the binding exists to close. Re-running the edit handler with
      // the selected company's own name unchanged must NOT hand the buyer an
      // editable registry-supplied organisation number.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      typeCompanyName("Example Trading Ltd");

      expect(component.companyIdEntryRequired).toBe(false);
      expect(document.getElementById("company_id").readOnly).toBe(true);
    });

    test("keeps it enabled while the text matches an identifier-less pick", () => {
      // Same path, the other way: a pick that carried no identifier must stay
      // open even though the name still matches it.
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      typeCompanyName("Example Trading Ltd");

      expect(component.companyIdEntryRequired).toBe(true);
      expect(document.getElementById("company_id").readOnly).toBe(false);
    });

    test("does not unlock the field on the selection keystroke itself", () => {
      // `selectItem()` sets `isSelecting`, which getItems() consumes in an
      // early return ABOVE the recompute. If the recompute ran there it would
      // undo the lock the selection had just applied.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      expect(component.isSelecting).toBe(true);

      typeCompanyName("Something Else Entirely", { keepSelecting: true });

      expect(component.companyIdEntryRequired).toBe(false);
      expect(document.getElementById("company_id").readOnly).toBe(true);
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
    }

    test("an identifier-less shipping company unlocks the field", () => {
      // The shipping step can now hand over an empty identifier for the same
      // reason selectItem() can. Without recomputing the editability from what
      // arrived, the buyer's pick lands in a field still locked from the
      // previous one.
      syncFromShipping("Example Trading Ltd", "12345678");
      expect(companyIdInput().readOnly).toBe(true);

      syncFromShipping("Other Example Ltd", "");

      expect(component.companyName).toBe("Other Example Ltd");
      expect(component.companyId).toBe("");
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().readOnly).toBe(false);
    });

    test("an identified shipping company re-locks it", () => {
      syncFromShipping("Example Trading Ltd", "");
      expect(companyIdInput().readOnly).toBe(false);

      syncFromShipping("Other Example Ltd", "12345678");

      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().readOnly).toBe(true);
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
      expect(companyIdInput().readOnly).toBe(false);
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
      expect(companyIdInput().readOnly).toBe(true);
    });

    test("nothing stored leaves the field open", () => {
      // Companion to the assertion above, on the flag rather than the field.
      // Pinned as `false` / locked before the re-render defect was found; only
      // `selectItem()` writes storage, so "nothing stored" is also the state a
      // buyer who typed a name and never picked one is in.
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().readOnly).toBe(false);
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
      expect(companyIdInput().readOnly).toBe(false);
      expect(storedSelection().company_name).toBeUndefined();

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().readOnly).toBe(false);
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
      expect(companyIdInput().readOnly).toBe(false);
      expect(storedSelection().company_id).toBe("12345678");

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().readOnly).toBe(true);
    });

    test("keeps the field locked after a pick that had an identifier", () => {
      // The other half of the invariant, and the reason this is not a blanket
      // unlock: the registry answered, so the number stays untypeable.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      expect(companyIdInput().readOnly).toBe(true);

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().readOnly).toBe(true);
    });

    test("keeps the field open after a pick that had no identifier", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      expect(companyIdInput().readOnly).toBe(false);

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().readOnly).toBe(false);
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

  describe("the locked company-number field is readonly, never disabled (TWO-25288)", () => {
    test("the template binds `:readonly` and does not bind `:disabled` at all", () => {
      // Both halves matter. Binding `:readonly` while ALSO still binding
      // `:disabled` would submit nothing and look identical on the page, so the
      // absence is the load-bearing half.
      expect(COMPANY_ID_READONLY_BINDING).toBe("companyIdDisabled");
      expect(COMPANY_ID_DISABLED_BINDING_IS_ABSENT).toBe(true);
    });

    test("a locked field still submits the captured `payment[company_id]`", () => {
      // THE regression this change exists to make impossible. Swap `:readonly`
      // for `:disabled` in gateway_method.phtml and this is the assertion that
      // goes red — every state assertion in this file keeps passing, because
      // component state and `querySelector(...).value` both see a disabled
      // input's value perfectly well. Only serialization does not.
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);

      expect(companyIdInput().readOnly).toBe(true);
      expect(companyIdInput().value).toBe("12345678");
      expect(submittedPayload()["payment[company_id]"]).toBe("12345678");
    });

    test("locking the field never removes the key from the payload", () => {
      // Pins the property rather than one scenario: whatever combination of
      // manualMode / companyIdEntryRequired / companyId the component ends up
      // in, a locked field must still carry its key. `disabled` would drop the
      // key entirely for every row where the lock came out true.
      [
        [false, false, "12345678"],
        [false, true, "12345678"],
        [true, false, "12345678"],
        [true, true, "12345678"],
        [false, false, ""],
        [true, true, ""],
      ].forEach(([manualMode, companyIdEntryRequired, companyId]) => {
        component.manualMode = manualMode;
        component.companyIdEntryRequired = companyIdEntryRequired;
        component.companyId = companyId;
        component.applyCompanyIdEditability();
        syncCompanyIdField(component);
        companyIdInput().value = companyId;

        // `Object.keys(...)).toContain(...)` and not `toHaveProperty`: jest
        // reads `[...]` in a `toHaveProperty` path as an index accessor, so
        // `payment[company_id]` resolves to the empty path and the assertion
        // passes vacuously.
        expect(Object.keys(submittedPayload())).toContain(
          "payment[company_id]",
        );
        expect(submittedPayload()["payment[company_id]"]).toBe(companyId);
      });
    });

    test("the unlocked field is editable and still submits", () => {
      // The other direction, so the test cannot pass by pinning the field
      // permanently locked — the failure mode this suite's own header warns
      // about.
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      companyIdInput().value = "87654321";

      expect(companyIdInput().readOnly).toBe(false);
      expect(submittedPayload()["payment[company_id]"]).toBe("87654321");
    });
  });

  describe("the read-only company-name display (TWO-25288)", () => {
    test("stays hidden before any company is picked", () => {
      syncCompanyNameDisplay(component);

      expect(component[COMPANY_NAME_DISPLAY_SHOW_BINDING]).toBe(false);
      expect(companyNameDisplay().hidden).toBe(true);
    });

    test("shows the selected company's name in search mode", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyIdField(component);
      syncCompanyNameDisplay(component);

      expect(component[COMPANY_NAME_DISPLAY_SHOW_BINDING]).toBe(true);
      expect(companyNameDisplay().hidden).toBe(false);
      expect(companyNameDisplay().textContent).toContain("Example Trading Ltd");
      // Name AND number are both visible and both read-only: the name here, the
      // number in the field above it.
      expect(companyIdInput().readOnly).toBe(true);
      expect(companyIdInput().value).toBe("12345678");
    });

    test("shows the name with a blank number when the hit has no identifier", () => {
      // Manual / no-identifier mode. The name display is gated on the NAME, not
      // on the lock, so it still appears — and the number field stays editable,
      // because the buyer is the only one who can fill it (see the
      // `companyIdEntryRequired` tests above; that guard is untouched here).
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      syncCompanyIdField(component);
      syncCompanyNameDisplay(component);

      expect(companyNameDisplay().hidden).toBe(false);
      expect(companyNameDisplay().textContent).toContain("Example Trading Ltd");
      expect(companyIdInput().value).toBe("");
      expect(submittedPayload()["payment[company_id]"]).toBe("");
    });

    test("is display only — it contributes nothing to the payload", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyNameDisplay(component);

      expect(companyNameDisplay().getAttribute("name")).toBeNull();
      expect(Object.keys(submittedPayload())).toEqual([
        "payment[company_name]",
        "payment[company_id]",
      ]);
    });

    test("follows the name on a later pick", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));
      syncCompanyNameDisplay(component);
      expect(companyNameDisplay().textContent).toContain("Example Trading Ltd");

      component.selectItem(pickerItem("Other Example Ltd", "87654321"));
      syncCompanyNameDisplay(component);

      expect(companyNameDisplay().textContent).toContain("Other Example Ltd");
      expect(companyNameDisplay().textContent).not.toContain(
        "Example Trading Ltd",
      );
    });
  });
});
