/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288. The company-NUMBER field on the address step.
 *
 * The address step is becoming the checkout's single company field, so it has
 * to be able to supply the thing placement credit-checks: a company
 * identifier. That is a field pair, not a field — a name with no number is not
 * placeable — and the number has to be typeable on every path where nothing has
 * vouched for one: a registry hit that arrived without a national identifier, a
 * name typed without picking a hit, manual entry (the only route on this
 * surface for a company the registry has no identifier for at all), and a store
 * with the lookup switched off.
 *
 * Two failure shapes this file exists to catch, both of which have shipped in
 * this repo before:
 *
 *  - a number field that is empty AND locked AND needed, which is a dead end
 *    with no other company-number input left in the checkout to fall back on;
 *  - state that is bound to nothing. The indicator lives in companyName.phtml
 *    and the state in companyName-csp-js.phtml, so a getter can be perfect and
 *    the page still inert. Every binding under test is therefore read out of
 *    the SHIPPED markup and then looked up on the real component.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";
const ID_FIELD = "input[data-two-company-id]";

describe("address-step company number", () => {
  let env;
  let fetchStub;
  let component;
  let nameField;
  let idField;
  let root;
  let selectedEvents;

  /** Record every cross-step announcement the surface makes. */
  function onSelected(event) {
    selectedEvents.push(event.detail);
  }

  beforeEach(() => {
    // Nesting depth is load-bearing: setAddressData() walks four levels up
    // from $root to find the address container.
    document.body.innerHTML = [
      '<div id="address-container">',
      '  <input name="city" value="" />',
      "  <div><div><div>",
      '    <div id="company-root">',
      '      <input type="text" id="company-field" value="" />',
      '      <input type="text" data-two-company-id="true" value="" />',
      "    </div>",
      "  </div></div></div>",
      "</div>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    nameField = document.getElementById("company-field");
    idField = document.querySelector(ID_FIELD);
    root = document.getElementById("company-root");

    selectedEvents = [];
    window.addEventListener("shipping-company-selected", onSelected);
  });

  afterEach(() => {
    window.removeEventListener("shipping-company-selected", onSelected);
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * Mount the picker. `el` is the NAME field, because that is the element the
   * component's `x-data` node contains and the one `getItems` reads.
   *
   * @param {Object} [stored] a selection blob to seed storage with
   * @returns {Object} the mounted, initialised component
   */
  function mount(stored) {
    if (stored !== undefined) {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify(stored),
      );
    }
    const mounted = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: nameField,
      root: root,
    });
    mounted.init();
    return mounted;
  }

  /** The stored blob, as the accessors left it. */
  function storedSelection() {
    const raw = env.browserStorage.getItem(H.COMPANY_SELECTION_KEY);
    return raw === null ? null : JSON.parse(raw);
  }

  /**
   * Type into the company-name field, the way the debounced binding does.
   *
   * Any search this starts is settled before returning. An unsettled one leaves
   * the helper's live 30s timeout armed behind the test, which shows up as a
   * five-second test rather than as a failure.
   */
  async function typeName(text) {
    nameField.value = text;
    const pending = component.getItems();
    await H.flushPromises();
    const call = fetchStub.last();
    if (call !== undefined && !call.settled) {
      call.respond({ items: [] });
    }
    await pending;
  }

  /**
   * Pick a search hit, INCLUDING the echo the pick causes.
   *
   * selectItem() writes the chosen name back into the field via `$root`'s
   * querySelector, which fires the field's own `input` binding — the
   * UNDEBOUNCED one first, in the real DOM. `noteCompanyQuery()` is what
   * actually swallows that echo (via the one-shot `awaitingSelectionEcho`
   * flag, consumed by exactly this call), so it is simulated here directly,
   * in the same order the browser fires it, rather than only through the
   * debounced `getItems()` tick behind it. `isSelecting` is a second flag
   * `getItems()` still checks for its own reason — skipping the request that
   * would otherwise re-search the name just picked — and it stays armed until
   * that tick runs, which `typeName()` below supplies.
   *
   * Tests that skip this helper's echo call and drive `selectItem()` directly
   * leave BOTH flags set, and the next keystroke they simulate through
   * `noteCompanyQuery()` is swallowed instead of processed — which silently
   * turns an assertion about an edited name into an assertion about nothing.
   *
   * @param {Object} item
   * @returns {Promise<void>}
   */
  async function pick(item) {
    component.selectItem(item);
    // The synthetic echo, simulated in real DOM order: selectItem() already
    // wrote `item.companyName` into the field, so this reads that value
    // through `$el` and is swallowed rather than processed.
    component.noteCompanyQuery();
    await typeName(item.companyName);
  }

  /** Type into the company-number field, the way its binding does. */
  function typeNumber(text) {
    idField.value = text;
    // `$el` is the bound element for THIS handler — the number field.
    const previousEl = component.$el;
    component.$el = idField;
    try {
      component.onCompanyIdInput();
    } finally {
      component.$el = previousEl;
    }
  }

  /**
   * A search hit, as the shared mapper produces it.
   *
   * @param {string} name
   * @param {string} id '' for a company the registry gave no identifier for
   * @returns {Object}
   */
  function hit(name, id) {
    return { companyName: name, companyId: id, lookupId: "" };
  }

  describe("the markup actually binds the state", () => {
    // A getter nothing binds has no effect on the page. These read the
    // binding out of the shipped template and then look the name up on the
    // real component, so severing either half reddens.
    test.each([
      [":disabled", "companyIdDisabled"],
      [":value", "companyId"],
      ["@input.debounce.300ms", "onCompanyIdInput"],
    ])("the number field's %s resolves to %s", (attribute, expected) => {
      const bound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        ID_FIELD,
        attribute,
      );

      expect(bound).toBe(expected);
      expect(bound in mount()).toBe(true);
    });

    test("the number field carries the shared locked-state class", () => {
      // The greyed look for the locked state is `input.company_id:disabled` in
      // custom.css. Without the class the field locks invisibly, which reads
      // to the buyer as an ordinary empty field that will not accept input.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector(ID_FIELD).className).toContain("company_id");
    });

    test("the number field is labelled, with an id the payment tile does not use", () => {
      // A label with no `for` names nothing to a screen reader, and the field
      // carries no `name` either, so there is nothing else to fall back on.
      // The id must also not be the tile's `company_id` / `manual_company_id`:
      // its bridge resolves that field by getElementById, and a duplicate in
      // document order would make the tile write into this field instead.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const field = doc.querySelector(ID_FIELD);
      const id = field.getAttribute("id");

      expect(id).toBeTruthy();
      expect(["company_id", "manual_company_id"]).not.toContain(id);
      expect(doc.querySelector(`label[for="${id}"]`)).not.toBeNull();
    });

    test("the number field submits nothing of its own", () => {
      // It carries no `name`, so the address entity's own submission is
      // untouched — the value reaches placement through the selection blob and
      // the payment step, as the company NAME chosen here already does. A
      // `name` here would post an unknown field into the address form.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector(ID_FIELD).hasAttribute("name")).toBe(false);
    });

    test("the persistent manual-entry link is gated on search mode, a closed dropdown AND no selection", () => {
      // RETARGETED by TWO-25288 element 5, not relaxed. The original gate was a
      // bare `searchModeActive`, which was right while the dropdown needed at
      // least one result to open: the only route into manual entry would
      // otherwise have vanished exactly when the search found nothing, which is
      // the case a company with no registry identifier is in.
      //
      // The dropdown now opens on typed length alone and carries a manual-entry
      // row of its own with identical wording, so this link additionally has to
      // disappear while the panel is open — two identical links on screen at
      // once is a defect. What it still owns is the states in which the panel is
      // shut: an untouched field, a query too short to search, and a full-length
      // query whose panel a click outside dismissed.
      //
      // And a third term, because the identical wording is a factual claim about
      // the current state: a chosen company must not be told it is not on the
      // list. That one is asserted here at the gate and exercised through the
      // real selectItem() path by the element-5 suite.
      //
      // Both of the original halves are still pinned — outside the panel, and
      // named by a property the component actually defines — plus the new terms.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const link = doc.querySelector(".two-company-manual-entry");
      const gate = link.closest("[x-show]");
      const bound = gate.getAttribute("x-show");

      expect(gate.closest("[x-show='showDropdown']")).toBeNull();
      expect(bound).toBeTruthy();

      component = mount();
      expect(bound in component).toBe(true);

      // The search-mode half, unchanged: nothing to switch between with no
      // lookup, and nothing for "manual" to be the opposite of once it is on.
      component.isCompanySearchEnabled = "";
      expect(component[bound]).toBe(false);
      component.isCompanySearchEnabled = "1";
      component.manualMode = true;
      expect(component[bound]).toBe(false);

      // The new half. Deliberately asserted in BOTH directions: a gate stuck
      // false would hide the link from the empty field it is the only
      // affordance for, and a gate stuck true would put it beside the panel's
      // own copy.
      component.manualMode = false;
      component.isOpen = false;
      expect(component[bound]).toBe(true);
      component.isOpen = true;
      expect(component[bound]).toBe(false);

      // The selection half, also in both directions from the same starting
      // point: panel shut and search mode on, so the only thing deciding the
      // gate here is whether a company has been chosen.
      component.isOpen = false;
      component.isCompanySelected = true;
      expect(component[bound]).toBe(false);
      component.isCompanySelected = false;
      expect(component[bound]).toBe(true);
    });

    test("the mode links resolve both ways round the search flag", () => {
      component = mount();

      expect(component.searchModeActive).toBe(true);
      expect(component.manualModeActive).toBe(false);

      component.manualMode = true;
      expect(component.searchModeActive).toBe(false);
      expect(component.manualModeActive).toBe(true);

      // Nothing to switch between with no lookup: neither link renders.
      component.isCompanySearchEnabled = "";
      expect(component.searchModeActive).toBe(false);
      expect(component.manualModeActive).toBe(false);
    });
  });

  describe("the field is locked exactly when a number has been vouched for", () => {
    test("it starts locked, before init has read anything", () => {
      // The declared default must be locked or the field flashes open on
      // first paint for a buyer whose company already has an identifier.
      const raw = env.alpineComponents[COMPONENT_NAME]();

      expect(raw.companyIdDisabled).toBe(true);
    });

    test("a restored REGISTRY pick stays locked", () => {
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });

      expect(component.companyId).toBe("111");
      expect(component.companyIdDisabled).toBe(true);
    });

    test("a restored HAND-TYPED number stays typeable", () => {
      // This assertion used to be the other way round — the restore path asked
      // only "is there a number", so the first Magewire re-render after the
      // buyer typed one locked the field over their own value. A typo was then
      // uncorrectable: this is the only company-number input on the address
      // step, so there is nowhere else to fix it.
      component = mount({
        company_name: "Jo Smith Trading",
        company_id: "1234567",
        company_id_source: "manual",
      });

      expect(component.companyId).toBe("1234567");
      expect(component.companyIdDisabled).toBe(false);
    });

    test("a restored number of unknown provenance stays typeable", () => {
      // A blob written before provenance existed, or by anything else sharing
      // the key. Nothing has vouched for that number, and this direction of
      // error is recoverable while locking it is a dead end.
      component = mount({ company_name: "Acme Ltd", company_id: "111" });

      expect(component.companyIdDisabled).toBe(false);
    });

    test("a number the buyer typed survives a re-render as typeable", () => {
      // The whole round trip, over the real accessors: type, then remount the
      // way a Magewire re-render does.
      component = mount({ quote_id: "test-quote-1" });
      typeNumber("1234567");
      expect(storedSelection().company_id).toBe("1234567");

      component = mount();

      expect(component.companyId).toBe("1234567");
      expect(component.companyIdDisabled).toBe(false);
    });

    test("a restored selection with no identifier is typeable", () => {
      component = mount({ company_name: "Acme Ltd", company_id: "" });

      expect(component.companyIdDisabled).toBe(false);
    });

    test("empty storage leaves the field typeable", () => {
      component = mount({});

      expect(component.companyIdDisabled).toBe(false);
    });

    test("a pick WITH an identifier fills and locks the field", () => {
      component = mount({ quote_id: "test-quote-1" });

      component.selectItem(hit("Acme Ltd", "111"));

      expect(component.companyId).toBe("111");
      expect(component.companyName).toBe("Acme Ltd");
      expect(component.companyIdDisabled).toBe(true);
      expect(storedSelection().company_id).toBe("111");
    });

    test("a pick WITHOUT an identifier leaves the field empty and typeable", () => {
      component = mount({ company_id: "999" });

      component.selectItem(hit("Example Trading Ltd", ""));

      // The previous pick's number must not survive beside a new company's
      // name — that submits company A while the buyer selected company B.
      expect(component.companyId).toBe("");
      expect(component.companyIdDisabled).toBe(false);
      expect(storedSelection().company_id).toBe("");
    });

    test("editing the name after a pick unlocks the field again", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      expect(component.companyIdDisabled).toBe(true);

      await typeName("Acme Limited");

      expect(component.companyIdDisabled).toBe(false);
    });

    test("it stays unlocked while the buyer keeps typing", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      await typeName("Acme Limite");
      await typeName("Acme Limited");
      await typeName("Acme Limited T");

      expect(component.companyIdDisabled).toBe(false);
    });

    test("it stays unlocked when the handler re-fires on unchanged text", async () => {
      // The handler fires more than once for the same text — a second debounce
      // window, a blur, a Magewire echo. If recording the typed name also
      // re-pointed `companyName` at it, the comparison would match on that
      // second run and re-lock the field, leaving the buyer holding an edited
      // name beside the PREVIOUS company's number, uneditable.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      await typeName("Different Company Ltd");
      await typeName("Different Company Ltd");

      expect(component.companyIdDisabled).toBe(false);
    });

    test("a name still matching its pick keeps the number locked", async () => {
      // The point of the lock: a registry-supplied number must not be typeable
      // over while the field still names the company it belongs to.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      await typeName("Acme Ltd");

      expect(component.companyIdDisabled).toBe(true);
    });

    test("bouncing through manual mode does not re-lock an unvouched number", async () => {
      // The sole-trader route is enterManually(), and a buyer who takes it and
      // then returns to search must not find the number field locked — nothing
      // has vouched for a number for the name they are holding.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Example Trading Ltd", ""));
      expect(component.companyIdDisabled).toBe(false);

      component.enterManually();
      expect(component.companyIdDisabled).toBe(false);

      component.enableSearch();
      expect(component.companyIdDisabled).toBe(false);
    });

    test("manual mode unlocks a number a registry pick had vouched for", () => {
      // And returning to search re-locks it, because the pick is still intact:
      // same single writer, no second piece of state saying otherwise.
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });
      expect(component.companyIdDisabled).toBe(true);

      component.enterManually();
      expect(component.companyIdDisabled).toBe(false);

      component.enableSearch();
      expect(component.companyIdDisabled).toBe(true);
    });
  });

  describe("init restores the completed-selection flag (TWO-25288 element 5 round 2)", () => {
    // `isCompanySelected` gates `persistentManualEntryVisible` — the
    // manual-entry link below the field. init() restores `companyName` and
    // `companyId` from storage but, pre-fix, left `isCompanySelected` at its
    // `false` default: a page reload after a completed pick showed the
    // "my company is not on the list" link beside a field that already held a
    // valid, restored answer.
    test("a restored pick with a valid id marks the selection complete", () => {
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });

      expect(component.isCompanySelected).toBe(true);
    });

    test("a restored HAND-TYPED identifier counts as a completed selection too", () => {
      // Not narrowed to `hasVouchedCompanyId()` (registry-only): a manually
      // entered identifier is just as complete a pick as a registry one, and
      // the link's copy — "my company is not on the list" — is equally wrong
      // beside either.
      component = mount({
        company_name: "Jo Smith Trading",
        company_id: "1234567",
        company_id_source: "manual",
      });

      expect(component.isCompanySelected).toBe(true);
    });

    test("a restored selection with no identifier is not marked complete", () => {
      component = mount({ company_name: "Acme Ltd", company_id: "" });

      expect(component.isCompanySelected).toBe(false);
    });

    test("empty storage leaves the selection incomplete", () => {
      component = mount({});

      expect(component.isCompanySelected).toBe(false);
    });

    test("a real edit after a restored selection flips it back (TWO-25288 element 5 round 2)", () => {
      // The two fixes chained, not just proven in isolation: init() marks a
      // restored pick complete, and a real keystroke through
      // noteCompanyQuery() — exactly like a buyer correcting a name they
      // reloaded the page onto — must still be able to end that state.
      // Without noteCompanyQuery()'s own unconditional
      // `this.isCompanySelected = false`, a restored selection could look
      // identical to one made this page load but never be editable.
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });
      expect(component.isCompanySelected).toBe(true);

      nameField.value = "Acme Limited";
      component.noteCompanyQuery();

      expect(component.isCompanySelected).toBe(false);
    });
  });

  describe("a typed number reaches the rest of the checkout", () => {
    test("it is written through the store-view-keyed accessor", () => {
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });

      typeNumber("12345678");

      // Merged, not rebuilt: dropping `quote_id` is what disarmed the
      // new-order clear, and the name has to travel with the number.
      // `company_id_source` travels with the value: both surfaces read one key,
      // so the restore path can only tell a typed number from a picked one if
      // the writer says which it was.
      expect(storedSelection()).toEqual({
        quote_id: "test-quote-1",
        company_name: "Acme Ltd",
        company_id: "12345678",
        company_id_source: "manual",
      });
      expect(component.companyId).toBe("12345678");
    });

    test("it is announced on the same event a registry pick uses", () => {
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });

      typeNumber("12345678");

      expect(selectedEvents).toHaveLength(1);
      expect(selectedEvents[0].company_id).toBe("12345678");
      expect(selectedEvents[0].company_name).toBe("Acme Ltd");
    });

    test("re-firing with an unchanged value announces nothing", () => {
      component = mount({ quote_id: "test-quote-1", company_id: "12345678" });

      typeNumber("12345678");

      expect(selectedEvents).toEqual([]);
    });

    test("the number reaches the payment step's submitted field", async () => {
      // End to end over the real bridge template: the address step is the only
      // company input, so its number has to land on the field the payment form
      // submits. `data-name` is what the bridge writes through.
      document.body.innerHTML += [
        '<input type="checkbox" id="billing-as-shipping" checked />',
        '<input name="payment-method-option" value="two_payment" checked />',
        '<div id="tile"><form>',
        '  <input type="text" name="payment[company_name]" data-name="company_name" value="" />',
        '  <input type="text" name="payment[company_id]" data-name="company_id" value="" />',
        "</form></div>",
      ].join("\n");
      H.loadTemplate(H.PAYMENT_FIELDS_TEMPLATE);
      window.document.dispatchEvent(new Event("DOMContentLoaded"));

      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });
      typeNumber("12345678");
      await H.flushPromises();

      expect(document.querySelector('[name="payment[company_id]"]').value).toBe(
        "12345678",
      );
      expect(
        document.querySelector('[name="payment[company_name]"]').value,
      ).toBe("Acme Ltd");
    });
  });

  describe("the typed company NAME is captured on every path", () => {
    test("manual entry records the name the buyer types", async () => {
      // The manual-mode guard used to return before the field was read, so
      // nothing recorded the name — and placement needs a name beside the
      // number. This is the sole-trader path on this surface.
      component = mount({ quote_id: "test-quote-1" });
      component.enterManually();

      await typeName("Jo Smith Trading");

      expect(storedSelection().company_name).toBe("Jo Smith Trading");
      expect(fetchStub.calls).toHaveLength(0);
    });

    test("a name edit records itself but announces nothing", async () => {
      // Announcing a name edit would push the new name beside the PREVIOUS
      // number to the payment step, and arm an order intent for that
      // mismatched pair. The number handler announces instead, by which point
      // the name in the blob is already the current one.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      selectedEvents.length = 0;

      await typeName("Different Company Ltd");

      expect(storedSelection().company_name).toBe("Different Company Ltd");
      expect(selectedEvents).toEqual([]);
    });

    test("an intact pick is never overwritten by its own field", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      await typeName("Acme Ltd");

      expect(storedSelection().company_name).toBe("Acme Ltd");
      expect(storedSelection().company_id).toBe("111");
    });
  });

  describe("a name edit never leaves the previous company's number behind", () => {
    test("editing the name clears the picked number from state AND storage", async () => {
      // The blob is what the payment step reads, and it derives its own locked
      // state from `company_id` being present there. Leaving the old number
      // beside the new name gave a payment step showing company B's name with
      // company A's number, LOCKED, with nothing forcing the buyer to touch it —
      // and sent company A's organisation number onward.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      expect(storedSelection().company_id).toBe("111");

      await typeName("Different Company Ltd");

      expect(component.companyId).toBe("");
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_name).toBe("Different Company Ltd");
    });

    test("the payment step's own gate reopens on the cleared pair", async () => {
      // The exact expression the tile derives its editability from. With the old
      // number still stored it read as "vouched for", which is the lock.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      await typeName("Different Company Ltd");

      expect(Boolean(storedSelection().company_id)).toBe(false);
    });

    test("switching to manual entry and renaming clears it too", async () => {
      // Same mismatch by the other route: enterManually() does not recompute the
      // pair, so the picked number used to travel with a hand-typed name.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      component.enterManually();
      await typeName("Jo Smith Trading");

      expect(component.companyId).toBe("");
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_name).toBe("Jo Smith Trading");
    });

    test("returning to search after that clear leaves the field typeable", async () => {
      // Empty AND locked AND required is the dead end this file exists to catch,
      // and dropping the number is exactly what can create it.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      component.enterManually();
      await typeName("Jo Smith Trading");

      component.enableSearch();

      expect(component.companyIdDisabled).toBe(false);
    });

    test("a number the BUYER typed is never cleared by a name edit", async () => {
      // Only a registry number belongs to a name. Clearing a hand-typed one here
      // would delete the buyer's own entry every time they adjusted the name.
      component = mount({ quote_id: "test-quote-1" });
      await typeName("Jo Smith Trading");
      typeNumber("1234567");

      await typeName("Jo Smith Trading Ltd");

      expect(component.companyId).toBe("1234567");
      expect(storedSelection().company_id).toBe("1234567");
    });

    test("an intact pick keeps its number through a re-fired handler", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      await typeName("Acme Ltd");
      await typeName("Acme Ltd");

      expect(component.companyId).toBe("111");
      expect(storedSelection().company_id).toBe("111");
    });
  });

  describe("only a settled name is published", () => {
    test("a fragment too short to search is not stored as the company name", async () => {
      // The payment step reads this key. Committing above the length guard
      // published every keystroke fragment as the company name.
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });

      await typeName("Ac");

      expect(storedSelection().company_name).toBe("Acme Ltd");
    });

    test("clearing the field does not blank the stored company name", async () => {
      // The worst fragment is the empty one: it left the payment step showing no
      // company at all.
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });

      await typeName("");

      expect(storedSelection().company_name).toBe("Acme Ltd");
    });

    test("a name long enough to search is still recorded", async () => {
      component = mount({ quote_id: "test-quote-1" });

      await typeName("Acme Widgets Limited");

      expect(storedSelection().company_name).toBe("Acme Widgets Limited");
    });
  });

  describe("a store with the lookup switched off", () => {
    beforeEach(() => {
      component = mount({ quote_id: "test-quote-1" });
      component.isCompanySearchEnabled = "";
    });

    test("never searches, whatever is typed", async () => {
      await typeName("Acme Widgets Limited");

      expect(fetchStub.calls).toHaveLength(0);
      expect(component.isSearching).toBe(false);
      expect(component.items).toEqual([]);
    });

    test("still records the name and leaves the number typeable", async () => {
      await typeName("Acme Widgets Limited");

      expect(storedSelection().company_name).toBe("Acme Widgets Limited");
      expect(component.companyIdDisabled).toBe(false);
    });

    test("still carries a typed number to the rest of the checkout", async () => {
      await typeName("Acme Widgets Limited");
      typeNumber("87654321");

      expect(storedSelection().company_id).toBe("87654321");
      expect(selectedEvents).toHaveLength(1);
    });
  });

  describe("per-surface isolation", () => {
    test("the payment tile's own number field is untouched by this change", () => {
      // PR1 is additive: the tile still renders its own dual-input pair and
      // still swaps the canonical id/name onto whichever mode is visible.
      // Severing that is PR2's business, and until then this surface gaining a
      // field must not have altered it.
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);

      expect(markup).toContain('data-name="company_id"');
      // The lock is bound as `:readonly` and never `:disabled` (TWO-25288) —
      // this input carries the submitted `payment[company_id]`, and a disabled
      // control is omitted from a form submission. The state property keeps its
      // historical name. See payment-company-selection.test.js for the payload
      // assertion that makes the distinction fail loudly.
      expect(
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_id"]',
          ":readonly",
        ),
      ).toBe("companyIdDisabled");
    });
  });
});
