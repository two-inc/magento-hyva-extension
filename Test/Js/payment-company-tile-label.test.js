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
 * The end state is ONE line reading "<name> (<number>)" and no controls, with
 * the underlying inputs still in the DOM so `payment[company_name]` and
 * `payment[company_id]` still submit.
 *
 * The hiding is gated on CAPTURED, never on mode, and that is the property this
 * file exists to hold. On Magento the tile's search control is a
 * company-capture route in its own right for buyers who never see the
 * address-step company field — a logged-in buyer picking a saved address, or a
 * virtual cart with no shipping step. Hiding it while nothing is captured is an
 * order-blocking regression, not a cosmetic one, so every "hidden" assertion
 * here has a matching "still visible while uncaptured" one.
 *
 * Every binding is read out of the SHIPPED markup by `H.readAlpineBinding()`
 * rather than named as a literal. This repo has repeatedly shipped bindings
 * that silently resolved to nothing on the component; a suite that asserts on
 * component state alone cannot fail for that.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/** The label's own two bindings. */
const LABEL_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'div[data-name="company_tile_label"]',
  "x-show",
);
const LABEL_TEXT_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  'div[data-name="company_tile_label"]',
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
 * @returns {Document} the shipped payment markup, parsed
 */
function parsedMarkup() {
  return new DOMParser().parseFromString(
    H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
    "text/html",
  );
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
    ])("%s names a key the component actually defines", (_label, binding) => {
      expect(binding() in component).toBe(true);
    });

    test("the label is the first child of the payment fieldset", () => {
      // §7 puts it between the term chips (outside the form) and the
      // order-intent message (the element that used to be first here).
      const fieldset = parsedMarkup().querySelector("form fieldset");
      const label = fieldset.querySelector(
        'div[data-name="company_tile_label"]',
      );

      expect(label).not.toBeNull();
      expect(fieldset.firstElementChild).toBe(label);
      expect(label.classList.contains("two-company-tile-label")).toBe(true);
    });

    test("the label sits inside the form's Alpine scope", () => {
      // It reads component state, so a label rendered outside `<form
      // x-data=...>` would bind against the outer tile component instead and
      // resolve to nothing.
      const label = parsedMarkup().querySelector(
        'div[data-name="company_tile_label"]',
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
    });

    test("keeps the controls visible for a pick that carried no identifier", () => {
      // Captured means "a registry number is locked in", not "a name was
      // chosen". A hit with no identifier still needs the buyer to type the
      // number, so nothing may be hidden.
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("keeps the controls visible mid-initialize(), before the id arrives", () => {
      // `companyIdDisabled` is derived synchronously from storage while
      // `companyId` is only written a tick later by fillCompanyData(). The
      // label must not paint "Example Ltd ()" in between.
      component.companyIdEntryRequired = false;
      component.companyId = "";
      component.companyName = "Example Trading Ltd";
      component.applyCompanyIdEditability();

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });
  });

  describe("with a company captured", () => {
    beforeEach(() => {
      component.selectItem(pickerItem("Example Trading Ltd", "123456789"));
    });

    test("reads exactly '<name> (<number>)'", () => {
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
      // The reverse transition. `companyName` has no clearing writer, so a
      // label keyed on it directly would strand the buyer looking at a
      // read-only line for a company they have just typed away from.
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

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[SEARCH_BLOCK_SHOW_BINDING]).toBe(true);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });

    test("gives them back when a later pick carries no identifier", () => {
      component.selectItem(pickerItem("Other Example Ltd", ""));

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
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

        expect(component[LABEL_SHOW_BINDING]).toBe(captured);
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

      expect(component[LABEL_SHOW_BINDING]).toBe(false);
      expect(component[NUMBER_BLOCK_HIDDEN_CLASS_BINDING]).toBe("");
    });
  });
});
