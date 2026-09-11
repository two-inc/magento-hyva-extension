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
 * beside the NEW company's name.
 *
 * ABN-564: the identifier is never typeable, so there is no editability to
 * assert. `expectNoEditableCompanyIdControl()` reads that off the SHIPPED
 * markup rather than off component state — a suite that asserts on state alone
 * cannot fail when a required, editable box is put back into the template.
 *
 * This is the first suite to assert on `twoGatewayHyvaPaymentMethodBase`, which
 * Test/Js/README.md previously listed as out of scope. Its own file for the
 * reason the README's "known leak" section gives: the template registers an
 * anonymous top-level `dispatch-order-intent` listener that cannot be removed,
 * so a file that dispatches that event accumulates one handler per test.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/**
 * ABN-564: no surface renders an editable company identifier. `payment[company_id]`
 * still submits, from a hidden input with no lock binding — so no component
 * state can make it typeable.
 *
 * Read out of the shipped markup: reinstating a text input, a `required`
 * attribute or a `:disabled` binding fails here.
 *
 * @returns {void}
 */
function expectNoEditableCompanyIdControl() {
  const doc = new DOMParser().parseFromString(
    H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
    "text/html",
  );
  const inputs = doc.querySelectorAll('[name="payment[company_id]"]');

  expect(inputs).toHaveLength(1);
  expect(inputs[0].getAttribute("type")).toBe("hidden");
  expect(inputs[0].hasAttribute("required")).toBe(false);
  expect(inputs[0].hasAttribute("data-validate")).toBe(false);
  expect(inputs[0].hasAttribute(":disabled")).toBe(false);
  expect(inputs[0].hasAttribute(":class")).toBe(false);
  expect(doc.querySelector('label[for="company_id"]')).toBeNull();
}

/**
 * The captured-company label's own two bindings, resolved from the shipped
 * markup: `x-show` keeps the by-hand DOM mirror honest, `x-text` is the
 * label's text builder, and the label is the tile's read-only rendering of a
 * captured number.
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
    // `#company_id` is `type="hidden"`, matching the shipped template: it
    // submits the identifier and offers no way to type one (ABN-564).
    // The captured-company label (TWO-25326) starts with no rendered value —
    // that is Alpine's to apply.
    // The two `data-two-capture-*` attributes are how the shared controller
    // tells the two mount points apart; without them it mounts no popover here
    // at all.
    document.body.innerHTML = [
      '<div id="payment-root">',
      '  <div class="two-company-search" data-two-capture-host="tile">',
      '    <input type="text" id="company_name" data-two-capture-field value="" />',
      "  </div>",
      '  <input type="hidden" id="company_id" data-name="company_id" value="" />',
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
    // property changes. `syncCompanyTileLabel()` is that run, by hand.
    syncCompanyTileLabel(mounted);
    return { component: mounted, watchers: recorded, root: root };
  }

  /**
   * Apply the template's `x-show` / `x-text` bindings for TWO-25326's
   * captured-company label. These mounted components are plain object
   * literals, not Alpine proxies, so nothing re-runs the bindings on its own.
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

  /** @returns {Object} the one popover the shared controller mounted */
  function panel() {
    expect(env.companyPanels).toHaveLength(1);
    return env.companyPanels[0];
  }

  /**
   * A registry pick by the route production takes: the popover hands it to the
   * shared controller, which writes the page identity this surface mirrors.
   *
   * @param {string} name
   * @param {string} id '' where the response omitted the national identifier
   * @returns {void}
   */
  function pickThroughPopover(name, id) {
    panel().options.onSelect({
      text: name,
      companyId: id,
      lookupId: "lookup-" + name,
    });
    syncCompanyTileLabel(component);
  }

  /** @returns {HTMLElement} the TWO-25326 captured-company label */
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

  /**
   * ABN-564. The reported defect was reachable only through a state
   * transition: a billing-country change cleared the selected identity and a
   * required, typeable company-number box appeared. So the invariant is
   * driven through the lifecycle rather than asserted once at mount.
   */
  describe("the identifier is never editable", () => {
    test("the shipped tile markup offers no editable identifier", () => {
      expectNoEditableCompanyIdControl();
    });

    test.each([
      [() => {}, "at mount, after initialize() with nothing stored"],
      [
        (c) => {
          c.selectItem(pickerItem("Example Trading Ltd", "12345678"));
        },
        "after a pick that carried an identifier",
      ],
      [
        (c) => {
          c.selectItem(pickerItem("Example Trading Ltd", ""));
        },
        "after a pick whose identifier the response omitted",
      ],
      [
        (c) => {
          c.selectItem(pickerItem("Example Trading Ltd", "12345678"));
          c.selectItem(pickerItem("Other Example Ltd", ""));
        },
        "after an identifier-bearing pick is replaced by one without",
      ],
      [
        (c) => {
          c.selectItem(pickerItem("Example Trading Ltd", "12345678"));
          c.companyName = "";
          c.companyId = "";
          c.companyIdSource = "";
        },
        "after the selected identity clears",
      ],
      [
        (c) => {
          c.selectItem(pickerItem("Example Trading Ltd", "12345678"));
          c.manualMode = true;
        },
        "in manual entry after a pick",
      ],
      [
        (c) => {
          c.selectItem(pickerItem("Example Trading Ltd", "12345678"));
          c.fillCompanyData("", "", false);
        },
        "after a company is adopted with no identifier",
      ],
    ])("no unlock survives on the component: case %#", (drive, description) => {
      drive(component);

      const survivors = [
        "companyIdDisabled",
        "companyIdEntryRequired",
        "applyCompanyIdEditability",
        "companyIdHiddenClass",
        "companyNumberBlockHiddenClass",
      ].filter((member) => member in component);

      expect([description, survivors]).toEqual([description, []]);
    });

    test("no stylesheet styles a locked company-number input", () => {
      // The greyed-out look went with the field it described. A surviving
      // `input.company_id:disabled` rule is a dangling claim that one exists.
      const css = fs.readFileSync(
        path.join(H.REPO_ROOT, "view/frontend/web/css/custom.css"),
        "utf8",
      );

      expect(css).not.toContain("company_id");
    });
  });

  describe("a company that has an identifier", () => {
    test("writes name and id into the submitting inputs", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("12345678");
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(companyIdInput().value).toBe("12345678");
      expect(component.companyIdSource).toBe("registry");
    });
  });

  describe("a company whose identifier the response omitted", () => {
    test("writes the name and submits an empty identifier", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(component.companyName).toBe("Example Trading Ltd");
      expect(component.companyId).toBe("");
      expect(document.getElementById("company_name").value).toBe(
        "Example Trading Ltd",
      );
      expect(companyIdInput().value).toBe("");
      // Nothing vouched for a number, and ABN-564 offers no way to type one.
      expect(component.companyIdSource).toBe("");
      expectNoEditableCompanyIdControl();
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
      // log. Seeded through the RECORD the gate actually reads — the per-company
      // decisions map; seeding the old single-slot `lastOrderIntentCompanyId`
      // instead leaves this test seeding nothing.
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

    test("selecting an identified company afterwards supplies the number", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));
      expect(companyIdInput().value).toBe("");

      component.selectItem(pickerItem("Other Example Ltd", "12345678"));

      expect(component.companyIdSource).toBe("registry");
      expect(companyIdInput().value).toBe("12345678");
    });

    test("the component registers no manualMode watcher", () => {
      // Its only job was recomputing the number field's lock (ABN-564). A
      // surviving watcher is a writer looking for state that is gone.
      expect(watchers.manualMode).toBeUndefined();
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
    // Manual mode is the shared page identity's, mirrored onto this surface.
    // Set directly rather than through the controller's `manualEntryMode()`,
    // which clears the number itself — the point here is that the EDIT drops it.
    env.identity.captureMode("manual");
    const nameInput = document.getElementById("company_name");
    nameInput.value = text;
    const previousEl = component.$el;
    component.$el = nameInput;
    try {
      component.onNameFieldInput();
    } finally {
      component.$el = previousEl;
    }
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
   * Neither half is true any more (TWO-25326 and the 2026-08-05
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

  describe("restored from browser storage", () => {
    test("a stored name with no id comes back with no id", () => {
      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
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
      expectNoEditableCompanyIdControl();
    });

    test.each([
      ["registry", "a registry pick keeps its provenance"],
      ["manual", "a hand-typed number keeps its provenance"],
    ])("a stored id sourced %s comes back read-only (%s)", (source) => {
      // Provenance travels with the pair — both kinds land under the same
      // key, and the payment step reads `company_id_source` to tell them
      // apart. Neither is editable (ABN-564).
      env.browserStorage.setItem(
        H.BILLING_COMPANY_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Example Trading Ltd",
          company_id: "12345678",
          company_id_source: source,
          manual_mode: false,
        }),
      );

      const restored = mountPaymentComponent().component;

      expect(restored.companyId).toBe("12345678");
      expect(restored.companyIdSource).toBe(source);
      expectNoEditableCompanyIdControl();
      // The restore lands through initialize()'s synchronous derivation, so
      // the label shows the restored company on the first render — not empty,
      // not the wrong company.
      expect(restored[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain(
        "Example Trading Ltd",
      );
    });

    test("nothing stored leaves the identifier empty and read-only", () => {
      // Only `selectItem()` writes storage, so "nothing stored" is also the
      // state a buyer who typed a name and never picked one is in.
      expect(component.companyId).toBe("");
      expectNoEditableCompanyIdControl();
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
    test("restores nothing after a search run without picking", () => {
      // RENAMED from "after a name typed without picking" (TWO-25326,
      // 2026-08-05): the company-name field is `readonly` in search mode, so
      // "typed" is no longer a thing that can happen on this path. Running a
      // search and picking nothing is, and it leaves storage untouched — which is
      // the premise the assertion below actually rests on.
      typeCompanyName("Example Trading");
      expect(storedSelection().company_name).toBeUndefined();

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyId).toBe("");
      expectNoEditableCompanyIdControl();
    });

    test("does not restore an abandoned identifier after editing a picked company's name", () => {
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
      // the rebuild restored it wholesale, putting company A's registry number
      // back beside a name the buyer had typed over.
      // `commitManualCompany()` → `forgetStaleCompanyId()` drops the identifier
      // from STORAGE as well as state, so the rebuild has nothing to restore.
      pickThroughPopover("Example Trading Ltd", "12345678");
      editNameInManualMode("Other Example");
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_id_source).toBe("");

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyId).toBe("");
      expect(rebuilt.companyIdSource).toBe("");
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
      pickThroughPopover("Example Trading Ltd", "12345678");
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

    test("restores the pick that had an identifier, still read-only", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyId).toBe("12345678");
      expect(rebuilt.companyIdSource).toBe("registry");
      expectNoEditableCompanyIdControl();
    });

    test("restores the pick that had no identifier without inventing one", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      const rebuilt = mountPaymentComponent().component;

      expect(rebuilt.companyId).toBe("");
      expectNoEditableCompanyIdControl();
    });
  });

  /**
   * The captured number is shown read-only, in the tile label and nowhere
   * else (ABN-564). The label follows the order-intent notice, so these
   * assertions read its TEXT builder rather than its gate.
   */
  describe("the captured number is rendered read-only", () => {
    test("an identifier-bearing pick puts the number in the label", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toBe(
        "Example Trading Ltd (12345678)",
      );
    });

    test("a pick with no identifier shows the name alone, never empty brackets", () => {
      component.selectItem(pickerItem("Example Trading Ltd", ""));

      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toBe(
        "Example Trading Ltd",
      );
    });

    test("a later pick with no identifier drops the previous number from the label", () => {
      component.selectItem(pickerItem("Example Trading Ltd", "12345678"));

      component.selectItem(pickerItem("Other Example Ltd", ""));

      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toBe(
        "Other Example Ltd",
      );
    });

    test("a manual-mode name edit takes the abandoned number off the label", () => {
      // `companyName` has no clearing writer, so a label keyed on it alone
      // would keep reading the old company's number beside the new name.
      pickThroughPopover("Example Trading Ltd", "12345678");
      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toContain("12345678");

      editNameInManualMode("Other Example");

      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toBe("Other Example");
    });

    test("a new identified pick puts its own number back", () => {
      pickThroughPopover("Example Trading Ltd", "12345678");
      editNameInManualMode("Other Example");

      // The route back the panel offers: a pick can only arrive in search mode.
      panel().options.onExitManualEntry();
      pickThroughPopover("Other Example Ltd", "87654321");

      expect(component[COMPANY_TILE_LABEL_TEXT_BINDING]).toBe(
        "Other Example Ltd (87654321)",
      );
    });
  });

  /*
   * DELETED 2026-08-05 — the five tests covering the tile's own
   * "Enter details manually" link.
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
   * DELETED with them — four of the five tests covering the tile's own
   * min-characters hint. They drove the hint through
   * `twoGatewayHyvaOnCompanySearchFocus()` (deleted) and measured it against
   * `search`, the company-name field's text. The shared control's hint measures
   * the PANEL'S QUERY instead and, like the row, deliberately shows from ZERO
   * characters — so "stays hidden before the buyer has typed anything" is now a
   * statement of the defect rather than the fix. The behaviour is covered once,
   * on the shared getter, in company-search-min-chars.test.js.
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
      expect(component.capturePanelMinChars()).toBe(component.minSearchChars);
      // Reached through the controller's own `search` object, which is what the
      // panel reads — a surface method the panel never consults would drift.
      expect(panel().options.search.MIN_INPUT_LENGTH).toBe(
        component.minSearchChars,
      );
    });
  });

  /**
   * REWRITTEN 2026-08-05 (TWO-25326, the one-control consolidation).
   *
   * The requirement is unchanged and is the one the money rides on: an order must
   * never carry a company name and a registry number describing two different
   * companies. What changed is the MECHANISM, and every one of the eight tests
   * here drove the old one.
   *
   * Removing the "Change company" swap left the search field visible and
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
  describe("a captured company cannot be typed over (TWO-25326)", () => {
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
      expect(companyIdInput().value).toBe("12345678");

      typeCompanyName("Other Example");

      expect(component.companyId).toBe("12345678");
      expect(companyIdInput().value).toBe("12345678");
      expect(storedSelection().company_id).toBe("12345678");
    });

    test("a manual-mode name edit drops the identifier from state, storage and the submitted input", () => {
      // Manual mode is where the field genuinely IS the capture control, so this
      // is the one path on which the text can diverge from the captured company.
      pickThroughPopover("Example Trading Ltd", "12345678");
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

    test("and offers no company-number field in its place", () => {
      // ABN-564: this is the transition the reported defect went through —
      // the identifier is dropped, and nothing typeable may appear.
      pickThroughPopover("Example Trading Ltd", "12345678");

      editNameInManualMode("Other Example");

      expect(component.companyId).toBe("");
      expectNoEditableCompanyIdControl();
    });

    test("a manual-mode edit back to the SAME name keeps the pick", () => {
      // The guard rail, and the reason `forgetStaleCompanyId()` compares the text
      // against the captured name rather than clearing unconditionally. A
      // synthetic re-fire of the edit handler must not throw away a good pick.
      pickThroughPopover("Example Trading Ltd", "12345678");

      editNameInManualMode("Example Trading Ltd");

      expect(component.companyId).toBe("12345678");
      expect(component.companyName).toBe("Example Trading Ltd");
      expect(storedSelection().company_id).toBe("12345678");
    });

    test("this tile offers no route into manual entry at all", () => {
      // Manual entry captures no organisation number, and this tile hosts the
      // control only where the address-step lookup that could supply one later
      // is off — so the chip is withheld and the captured identifier has no
      // mode route that could drop it.
      expect(panel().options.isChipVisible("manual")).toBe(false);
      expect(env.captureControllers[0].config().isCompanySearchEnabled).toBe(
        false,
      );
    });

    test("the identifier survives the modes this tile does offer", () => {
      pickThroughPopover("Example Trading Ltd", "12345678");

      panel()
        .options.getChips()
        .filter((chip) => panel().options.isChipVisible(chip.mode))
        .forEach((chip) => {
          if (chip.mode !== "soletrader") chip.onActivate();
        });

      expect(component.companyId).toBe("12345678");
      expect(companyIdInput().value).toBe("12345678");
      expectNoEditableCompanyIdControl();
    });
  });
});
