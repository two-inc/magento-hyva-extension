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
 * Resolved once, at require time, and deliberately NOT wrapped in a try: if the
 * binding is missing or is not a CSP-legal bare identifier, every test in the
 * file fails to load. That is the intended blast radius — without the binding
 * there is no locked state to assert on in the first place.
 */
const COMPANY_ID_DISABLED_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'input[data-name="company_id"]',
  ":disabled",
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
    document.body.innerHTML = [
      '<div id="payment-root">',
      '  <input type="text" id="company_name" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" value="" />',
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
      env.browserStorage.getItem("shipping_company_selection") || "{}",
    );
  }

  describe("the company-number field's locked state", () => {
    test("is a real binding in the shipped markup, not just component state", () => {
      // The assertion the rest of this file rests on. `readAlpineBinding()`
      // throws if the attribute is absent or is not a bare identifier, so this
      // pins BOTH that the wire exists and that CSP-friendly Alpine can
      // evaluate it. Deleting `:disabled="companyIdDisabled"` from
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

    test("is locked once the component has initialized with nothing stored", () => {
      expect(companyIdInput().disabled).toBe(true);
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
      expect(companyIdInput().disabled).toBe(true);

      syncFromShipping("Other Example Ltd", "");

      expect(component.companyName).toBe("Other Example Ltd");
      expect(component.companyId).toBe("");
      expect(component.companyIdEntryRequired).toBe(true);
      expect(companyIdInput().disabled).toBe(false);
    });

    test("an identified shipping company re-locks it", () => {
      syncFromShipping("Example Trading Ltd", "");
      expect(companyIdInput().disabled).toBe(false);

      syncFromShipping("Other Example Ltd", "12345678");

      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
    });
  });

  describe("restored from browser storage", () => {
    test("a stored name with no id comes back editable", () => {
      env.browserStorage.setItem(
        "shipping_company_selection",
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
    });

    test("a stored name with an id comes back locked", () => {
      env.browserStorage.setItem(
        "shipping_company_selection",
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
    });

    test("nothing stored leaves the field locked", () => {
      expect(component.companyIdEntryRequired).toBe(false);
      expect(companyIdInput().disabled).toBe(true);
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
});
