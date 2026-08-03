/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25332. The component the payment `<form>` ACTUALLY MOUNTS.
 *
 * NO OTHER SUITE IN THIS DIRECTORY MOUNTS THIS COMPONENT. The others mount
 * `twoGatewayHyvaPaymentMethodBase`, `twoGatewayHyvaCompanySearchField` or
 * `twoGatewayHyvaTermChip` — all real components, none of them the one the
 * payment form paints from. The `<form>` in gateway_method.phtml mounts
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
 * tests passed, because the suites that assert on these getters assert on the
 * BASE component, where they are real. That is a HARNESS-CONTRACT gap, not a
 * coverage gap: no number of assertions against the base object can fail for a
 * defect in how the base is composed.
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
 * Every bare-identifier Alpine binding in the form component's OWN Alpine
 * scope, read out of the shipped markup rather than listed here.
 *
 * Nested `x-data` subtrees are skipped: a binding under `PaymentTermsComponent`
 * resolves against THAT component, not this one, so asserting it here would be
 * asserting the wrong contract. It would currently pass either way — that
 * factory returns `PaymentMethodBase()` unchanged — which is exactly why the
 * scope boundary is enforced rather than left to a coincidence.
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
    // The form component's own scope only — see the note above.
    if (element !== form && element.closest("[x-data]") !== form) return;
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
 * The bare property name an ANCESTOR of `selector` binds, for the two blocks
 * that carry no `data-name` themselves. Throws rather than returning nothing —
 * the value is a floor under another test, so a silent blank would raise the
 * floor's own coverage question.
 *
 * @param {string} selector the element inside the block
 * @param {string} ancestorSelector the bound ancestor
 * @param {string} attribute the Alpine binding to read off it
 * @returns {string}
 */
function ancestorBinding(selector, ancestorSelector, attribute) {
  const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const inner = doc.querySelector(selector);
  if (inner === null) {
    throw new Error("`" + selector + "` is gone from the payment tile");
  }
  const block = inner.closest(ancestorSelector);
  if (block === null) {
    throw new Error(
      "`" + selector + "` has no ancestor matching `" + ancestorSelector + "`",
    );
  }
  const expression = block.getAttribute(attribute);
  if (!expression) {
    throw new Error(
      "the block around `" + selector + "` has no `" + attribute + "` gate",
    );
  }
  return expression;
}

/**
 * The six §7 bindings whose getters the spread froze, as the SHIPPED markup
 * names them. The floor under `formSubtreeBindings()`: that walk skips nested
 * `x-data` scopes, so a nesting change could otherwise shrink its coverage
 * silently — the only thing it throws on is an empty result. These are read
 * with `readAlpineBinding()`, which throws if the element or the binding is
 * gone, and asserted to be inside the enumerated set.
 */
const FROZEN_GETTER_BINDINGS = [
  ['[data-name="company_tile_label"]', "x-show"],
  ['[data-name="company_tile_label"]', "x-text"],
  ['[data-name="company_tile_change"]', "x-show"],
  ['[data-name="order_intent_message"]', "x-show"],
]
  .map(([selector, attribute]) => ({
    what: selector + " " + attribute,
    expression: H.readAlpineBinding(
      H.GATEWAY_METHOD_MARKUP_TEMPLATE,
      selector,
      attribute,
    ),
  }))
  // The search block and the Company Number block carry no `data-name` of
  // their own — they are the ancestors of the inputs that do, which is how
  // payment-company-tile-label.test.js reads them too.
  .concat([
    {
      what: "the search block's x-show",
      expression: ancestorBinding(
        'input[data-name="company_name"]',
        "[x-show]",
        "x-show",
      ),
    },
    {
      what: "the Company Number block's :class",
      expression: ancestorBinding(
        'input[data-name="company_id"]',
        "[\\:class]",
        ":class",
      ),
    },
  ]);

/** The label's own visibility gate — the one the getter cannot answer. */
const LABEL_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="company_tile_label"]',
  "x-show",
);

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

    test("the six §7 bindings are inside that enumeration", () => {
      // THE FLOOR. The walk above skips nested `x-data` scopes, and the only
      // thing it throws on is an empty result — so wrapping one of these blocks
      // in an `x-data` would quietly drop it from the enumeration and take a
      // parameterised test with it. Proven: doing that leaves the suite green
      // without this test. These six are the ones the freeze killed, so they
      // are the ones whose coverage may not evaporate.
      const enumerated = bindings.map((b) => b.expression);
      const missing = FROZEN_GETTER_BINDINGS.filter(
        (b) => enumerated.indexOf(b.expression) === -1,
      ).map((b) => b.what + " (" + b.expression + ")");

      expect(missing).toEqual([]);
    });
  });

  describe("the behaviours the freeze had switched off", () => {
    // Each of these passed on the base component before TWO-25332 and failed
    // on the form component. They are asserted HERE, against the form, which
    // is the only place their production value is decided.

    test("the notice clears when the company changes, on THIS component", () => {
      // The watchers that clear the notice are methods, so the freeze never
      // touched them — but the notice only paints on the form component, so
      // this is where their effect on the label matters. The shared instance
      // stubs `$watch` to a no-op, so a fresh one records the registrations,
      // which also proves they happen on the composed component at all.
      const watchers = {};
      const fresh = H.mountComponent(env.alpineComponents[FORM_COMPONENT], {
        el: root,
        root: root,
        wire: { autoSaveTimeout: 1000 },
      });
      fresh.$watch = function (property, callback) {
        (watchers[property] = watchers[property] || []).push(callback);
      };
      fresh.initialize(JSON.parse(H.QUOTE_JSON));

      fresh.selectItem(pickerItem("Example Trading Ltd", "123456789"));
      fresh.orderIntentApprovedNoticeCopy = NOTICE_COPY;
      fresh.processOrderIntentSuccessResponse({ approved: true });
      expect(fresh.orderIntentMessageVisible).toBe(true);

      expect(watchers.companyName).toBeDefined();
      expect(watchers.companyId).toBeDefined();
      watchers.companyName.forEach((callback) => callback());

      expect(fresh.orderIntentMessageVisible).toBe(false);
    });

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

    test("order intent disabled: nothing is dispatched, and the label's own gate stays shut", () => {
      // NOT a defect this PR introduces, and not one it hides either: it is the
      // state the 2026-08-03 ruling implies, now reachable on screen for the
      // first time because the gates are live. With order intent disabled for
      // the merchant — or for a Dutch buyer whose company is not a BV, where
      // placeOrderIntent() resolves null — the notice never fires, so the label
      // never renders, while capture still hides the search block and the
      // Company Number block. The buyer sees no company name anywhere and a
      // bare "Change company" button.
      //
      // Two things make this a pin rather than a restatement of the test above:
      //
      //  - the flag is LOAD-BEARING here. Capture with intent enabled
      //    dispatches `dispatch-order-intent`; with it disabled nothing is
      //    dispatched, so flipping the assignment out fails this test;
      //  - "shows no label" is asserted through the label's OWN `x-show`
      //    binding, read out of the shipped markup. The getter cannot answer
      //    it — `companyTileLabelText` still returns the text, and the gate
      //    that suppresses it is the binding. Asserting the getter alone would
      //    have made this test a duplicate.
      const dispatched = [];
      const record = () => dispatched.push("dispatch-order-intent");
      window.addEventListener("dispatch-order-intent", record);

      try {
        form.isOrderIntentEnabled = false;
        form.selectItem(pickerItem("Example Trading Ltd", "123456789"));

        expect(dispatched).toEqual([]);
        expect(form[LABEL_SHOW_BINDING]).toBe(false);
        expect(form.companySearchBlockVisible).toBe(false);
        expect(form.companyNumberBlockHiddenClass).toBe("hidden");
        expect(form.companyChangeControlVisible).toBe(true);
        // The order still places: both inputs stay in the DOM with their
        // values, hidden by a class rather than removed, so
        // `payment[company_name]` and `payment[company_id]` still submit.
        // Cosmetic-but-bad, not order-blocking — which is why it is a product
        // question and not a blocker.
        expect(document.getElementById("company_name").value).toBe(
          "Example Trading Ltd",
        );
        expect(document.getElementById("company_id").value).toBe("123456789");
      } finally {
        window.removeEventListener("dispatch-order-intent", record);
      }
    });

    test("the same capture WITH intent enabled does dispatch — the flag is read", () => {
      // The other half of the pin above. Without this, "nothing is dispatched"
      // could hold because nothing ever dispatches.
      const dispatched = [];
      const record = () => dispatched.push("dispatch-order-intent");
      window.addEventListener("dispatch-order-intent", record);

      try {
        form.selectItem(pickerItem("Example Trading Ltd", "123456789"));

        expect(form.isOrderIntentEnabled).toBeTruthy();
        expect(dispatched).toEqual(["dispatch-order-intent"]);
      } finally {
        window.removeEventListener("dispatch-order-intent", record);
      }
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
