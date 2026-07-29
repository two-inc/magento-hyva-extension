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
 * This is the first suite to assert on `twoGatewayHyvaPaymentMethodBase`, which
 * Test/Js/README.md previously listed as out of scope. Its own file for the
 * reason the README's "known leak" section gives: the template registers an
 * anonymous top-level `dispatch-order-intent` listener that cannot be removed,
 * so a file that dispatches that event accumulates one handler per test.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

describe("payment component company selection", () => {
  let env;
  let fetchStub;
  let component;
  let watchers;

  beforeEach(() => {
    // fillCompanyData() and the order-intent guard both read these by id.
    document.body.innerHTML = [
      '<div id="payment-root">',
      '  <input type="text" id="company_name" value="" />',
      '  <input type="text" id="company_id" value="" disabled />',
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
   * @returns {{component: Object, watchers: Object}}
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
    return { component: mounted, watchers: recorded };
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

  describe("a company that has an identifier", () => {
    test("writes name and id, and leaves the id field locked", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("12345678");
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(companyIdInput().value).toBe("12345678");
      // Locked because the buyer has nothing to add: the registry answered.
      expect(component.companyIdEntryRequired).toBe(false);
      expect(component.companyIdDisabled).toBe(true);
      expect(component.companyIdBgStyle).toBe("background-color: #D3D3D3");
    });
  });

  describe("a company whose identifier the response omitted", () => {
    test("writes the name and leaves the id field empty but editable", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("");
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(companyIdInput().value).toBe("");
      // Empty AND disabled would be an unfillable required field — the buyer
      // has to be able to type the organisation number in themselves.
      expect(component.companyIdEntryRequired).toBe(true);
      expect(component.companyIdDisabled).toBe(false);
      expect(component.companyIdBgStyle).toBe("");
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

      component.selectItem(pickerItem("Other Example Ltd", "12345678"));

      expect(component.companyIdEntryRequired).toBe(false);
      expect(component.companyIdDisabled).toBe(true);
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

      expect(component.companyIdDisabled).toBe(false);
      expect(component.companyIdBgStyle).toBe("");
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
      expect(restored.companyIdDisabled).toBe(false);
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
      expect(restored.companyIdDisabled).toBe(true);
    });

    test("nothing stored leaves the field locked", () => {
      expect(component.companyIdEntryRequired).toBe(false);
      expect(component.companyIdDisabled).toBe(true);
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
