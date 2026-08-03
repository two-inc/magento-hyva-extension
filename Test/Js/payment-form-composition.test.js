/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25332. The component the payment `<form>` ACTUALLY MOUNTS.
 *
 * Every other suite in this directory mounts `twoGatewayHyvaPaymentMethodBase`.
 * The `<form>` in gateway_method.phtml mounts
 * `twoGatewayHyvaPaymentFormWithValidation`, which composes that base with the
 * validation/autosave object — and until TWO-25332 it composed them with object
 * SPREAD. Spread copies own enumerable properties by value, so it invoked each
 * of the base's getters once, at composition time, and stored the result as a
 * plain data property. On the component the form mounted, every derived value
 * was frozen at its pre-interaction reading:
 *
 *   | binding                          | frozen at | should follow      |
 *   |----------------------------------|-----------|--------------------|
 *   | x-show orderIntentMessageVisible | false     | the intent notice  |
 *   | x-text companyTileLabelText      | ''        | name (number)      |
 *   | x-show companySearchBlockVisible | true      | capture            |
 *   | x-show companyChangeControlVisible | false   | capture            |
 *   | :class companyNumberBlockHiddenClass | ''    | capture            |
 *   | :class companyIdHiddenClass      | ''        | capture            |
 *   | (companyIdHintVisible, the shared derivation behind those three)     |
 *
 * So the whole §7 company-search apparatus was inert in production while 476
 * tests passed, because the suites asserted against the base component where
 * the getters are real. That is a HARNESS-CONTRACT gap, not a coverage gap:
 * no number of tests against the base object can see it.
 *
 * This file closes it, and it is deliberately written to cover getters nobody
 * has added yet: the accessor test ENUMERATES the base's own accessors rather
 * than listing them, so a getter added to the base literal tomorrow is checked
 * here without touching this file. Do not replace that enumeration with a
 * literal list.
 */

"use strict";

const H = require("./hyva-harness");

const BASE_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const FORM_COMPONENT = "twoGatewayHyvaPaymentFormWithValidation";

/**
 * The notice copy in the shape the PHP renders it. Anything non-empty gates the
 * notice; the token is substituted with the captured company's name.
 */
const NOTICE_COPY = {
  withCompany: "Approved for {company}.",
  withoutCompany: "Approved.",
  companyNameToken: "{company}",
};

/**
 * Every bare-identifier Alpine binding inside the `<form>` subtree of the
 * SHIPPED markup, read out of the template rather than listed here.
 *
 * @returns {Array<{attribute: string, expression: string, selector: string}>}
 */
function formSubtreeBindings() {
  const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const form = doc.querySelector("form[x-data]");
  if (form === null) {
    throw new Error(
      "no `<form x-data>` in the shipped markup — this suite would assert " +
        "against nothing",
    );
  }
  if (form.getAttribute("x-data") !== FORM_COMPONENT) {
    throw new Error(
      "the payment form mounts `" +
        form.getAttribute("x-data") +
        "`, not `" +
        FORM_COMPONENT +
        "`. This suite tests the component the form mounts, so it has to " +
        "follow the rename rather than keep testing the old one.",
    );
  }

  const bindings = [];
  const seen = {};
  const elements = [form].concat(
    Array.prototype.slice.call(form.querySelectorAll("*")),
  );
  elements.forEach(function (element) {
    Array.prototype.slice.call(element.attributes).forEach(function (attr) {
      const isBinding =
        attr.name === "x-show" ||
        attr.name === "x-text" ||
        attr.name === "x-html" ||
        attr.name === "x-model" ||
        (attr.name.charAt(0) === ":" && attr.name !== ":key");
      if (!isBinding) return;
      // Bare property names only — the same narrowing readAlpineBinding()
      // applies, for the same reason: anything else needs a different
      // resolution strategy than `component[name]`.
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(attr.value)) return;
      const key = attr.name + "=" + attr.value;
      if (seen[key]) return;
      seen[key] = true;
      bindings.push({
        attribute: attr.name,
        expression: attr.value,
        selector: element.tagName.toLowerCase(),
      });
    });
  });

  if (bindings.length === 0) {
    throw new Error("no Alpine bindings found in the form subtree");
  }
  return bindings;
}

/**
 * A dropdown item in the shape the shared helper's mapItems() produces.
 *
 * @param {string} name
 * @param {string} id
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

describe("the component the payment form mounts (TWO-25332)", () => {
  let env;
  let fetchStub;
  let form;
  let root;

  beforeEach(() => {
    document.body.innerHTML = [
      '<form id="two_payment_form">',
      '  <input type="text" id="company_name" value="" />',
      '  <input type="text" id="company_id" data-name="company_id" value="" />',
      "</form>",
    ].join("\n");

    jest.useFakeTimers();
    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadTemplate(H.GATEWAY_METHOD_TEMPLATE);
    env.fireAlpineInit();

    root = document.getElementById("two_payment_form");
    form = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
      el: root,
      root: root,
      wire: { autoSaveTimeout: 1000, store: () => Promise.resolve() },
    });
    form.$watch = function () {};
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  test("the form component is registered at all", () => {
    // The registration is what makes `x-data="…PaymentFormWithValidation"`
    // resolve; without it Alpine mounts nothing and every binding below is
    // moot.
    expect(typeof env.alpineComponents[FORM_COMPONENT]).toBe("function");
  });

  describe("composition keeps accessors live", () => {
    /**
     * The base's own accessors, enumerated from the base component.
     *
     * @returns {Array<string>}
     */
    function baseAccessorNames() {
      const base = H.mountComponent(env.alpineComponents[BASE_COMPONENT], {
        el: root,
        root: root,
      });
      const descriptors = Object.getOwnPropertyDescriptors(base);
      return Object.keys(descriptors).filter(
        (name) => typeof descriptors[name].get === "function",
      );
    }

    test("the base has accessors to lose in the first place", () => {
      // Guards the test below from passing vacuously if the base's getters
      // were ever replaced by plain properties.
      expect(baseAccessorNames().length).toBeGreaterThan(0);
    });

    test("every getter on the base is still a getter on the form", () => {
      // THE REGRESSION TEST. Under object spread each of these arrived as a
      // `value` descriptor holding a one-time reading, and nothing else in the
      // suite could tell.
      const formDescriptors = Object.getOwnPropertyDescriptors(form);
      const frozen = baseAccessorNames().filter(
        (name) =>
          formDescriptors[name] === undefined ||
          typeof formDescriptors[name].get !== "function",
      );

      expect(frozen).toEqual([]);
    });

    test("the validation members are all on the form", () => {
      // The other half of the composition. `init` is the form's validator and
      // autosave wiring and `validate` is what blocks Place Order on an
      // invalid form, so losing either to a composition change is a silent
      // checkout defect of the same family as the frozen getters.
      const validation = twoValidatePaymentForm(root, {
        autoSaveTimeout: 1000,
      });

      Object.keys(validation).forEach((key) => {
        expect(typeof form[key]).toBe(typeof validation[key]);
      });
      expect(typeof form.init).toBe("function");
      expect(typeof form.validate).toBe("function");
    });

    test("the validation object wins a name collision, as the spread did", () => {
      // There is no collision between the two objects today — the base names
      // its own entry point `initialize(quote)`, not `init` — so the ordering
      // is pinned on the composer itself rather than on a collision that
      // happens not to exist. Spread put the validation object SECOND; if a
      // future getter or method were named on both sides, the form must keep
      // taking the validation object's, not silently flip.
      const composed = twoGatewayComposeLive(
        { shared: "base", baseOnly: true },
        { shared: "validation", validationOnly: true },
      );

      expect(composed.shared).toBe("validation");
      expect(composed.baseOnly).toBe(true);
      expect(composed.validationOnly).toBe(true);
    });

    test("the composer keeps a source getter live too", () => {
      // Not only the target's. The validation object has no getter today, and
      // this is what stops one added there later from being frozen the way the
      // base's were.
      let reads = 0;
      const composed = twoGatewayComposeLive(
        {},
        {
          get counter() {
            reads += 1;
            return reads;
          },
        },
      );

      expect(composed.counter).toBe(1);
      expect(composed.counter).toBe(2);
    });
  });

  describe("every binding in the form subtree resolves on the form", () => {
    // The narrower contract the header describes: a binding that names a key
    // the form component does not define paints nothing at all.
    const bindings = formSubtreeBindings();

    test.each(
      bindings.map((b) => [b.attribute + '="' + b.expression + '"', b]),
    )("%s names a key the form component defines", (_label, binding) => {
      expect(binding.expression in form).toBe(true);
    });
  });

  describe("the behaviours the freeze had switched off", () => {
    // Each of these passed on the base component before TWO-25332 and failed
    // on the form component. They are asserted HERE, against the form, which
    // is the only place their production value is decided.

    test("nothing is captured and nothing is hidden to begin with", () => {
      expect(form.companySearchBlockVisible).toBe(true);
      expect(form.companyNumberBlockHiddenClass).toBe("");
      expect(form.companyIdHiddenClass).toBe("");
      expect(form.companyChangeControlVisible).toBe(false);
      expect(form.orderIntentMessageVisible).toBe(false);
      expect(form.companyTileLabelText).toBe("");
    });

    test("capture hides the search and number blocks, and offers the way back", () => {
      form.selectItem(pickerItem("Example Trading Ltd", "123456789"));

      expect(form.companySearchBlockVisible).toBe(false);
      expect(form.companyNumberBlockHiddenClass).toBe("hidden");
      expect(form.companyIdHiddenClass).toBe("hidden");
      expect(form.companyChangeControlVisible).toBe(true);
    });

    test("an approved intent shows the notice and the label together", () => {
      form.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      form.orderIntentApprovedNoticeCopy = NOTICE_COPY;
      form.processOrderIntentSuccessResponse({ approved: true });

      expect(form.orderIntentMessageVisible).toBe(true);
      expect(form.companyTileLabelText).toBe("Example Trading Ltd (123456789)");
    });

    test("editing the company away gives the controls back", () => {
      form.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      form.selectItem(pickerItem("Other Example Ltd", ""));

      expect(form.companySearchBlockVisible).toBe(true);
      expect(form.companyNumberBlockHiddenClass).toBe("");
      expect(form.companyChangeControlVisible).toBe(false);
    });
  });

  describe("the getters survive their first read being early", () => {
    // These getters have never been read on this component in production, so
    // the state they read has never been exercised here mid-initialisation.
    // A getter that threw, or that painted a half-restored value, would have
    // been invisible until now.
    test("a read before initialize() throws nothing and paints nothing", () => {
      const fresh = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
        el: root,
        root: root,
        wire: { autoSaveTimeout: 1000 },
      });

      expect(() => {
        expect(fresh.companyIdHintVisible).toBe(false);
        expect(fresh.companyIdHiddenClass).toBe("");
        expect(fresh.companyNumberBlockHiddenClass).toBe("");
        expect(fresh.companySearchBlockVisible).toBe(true);
        expect(fresh.companyChangeControlVisible).toBe(false);
        expect(fresh.companyTileLabelText).toBe("");
        expect(fresh.orderIntentMessageVisible).toBe(false);
      }).not.toThrow();
    });

    test("the mid-initialize() tick before the id arrives hides nothing", () => {
      // `companyIdDisabled` is derived synchronously from storage while
      // `companyId` is written a tick later by fillCompanyData(). On the base
      // component this is already pinned; it matters more here, because this
      // is the component whose bindings paint.
      form.companyIdEntryRequired = false;
      form.companyId = "";
      form.companyName = "Example Trading Ltd";
      form.applyCompanyIdEditability();

      expect(form.companySearchBlockVisible).toBe(true);
      expect(form.companyNumberBlockHiddenClass).toBe("");
      expect(form.companyIdHiddenClass).toBe("");
      expect(form.companyChangeControlVisible).toBe(false);
      expect(form.companyTileLabelText).toBe("Example Trading Ltd");
    });

    test("initialize() on the form component restores without throwing", () => {
      expect(() => form.initialize(JSON.parse(H.QUOTE_JSON))).not.toThrow();
    });
  });
});
