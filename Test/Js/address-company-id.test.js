/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288 / TWO-25326. The company-NUMBER provenance behind the address step.
 *
 * TWO-25326 §5/§7 removed the editable company-number INPUT from this surface
 * entirely. The ticket records the permanently-visible "Company Number" field
 * as a defect in its own right: it must not exist before a result is selected,
 * nor in manual-entry mode, nor be editable at any point. What remains here is
 * the read-only `.two-company-id-display` text, shown only for a
 * registry-supplied number — search mode captures name + identifier, manual
 * mode captures a NAME ONLY, and a buyer who has to supply a number the
 * registry did not give does so on the PAYMENT step, which keeps its own
 * separately-gated inputs.
 *
 * So this file no longer tests an address-step input. It tests the state
 * machine that outlived it: `companyId` / `companyIdSource` /
 * `companyIdDisabled` / `companyIdEntryRequired` are still maintained by this
 * component, still written into the shared selection blob, and the payment step
 * still reads the provenance out of that blob to decide whether ITS number
 * field is typeable. Get the provenance wrong here and the payment step locks a
 * field over the buyer's own value, which is the dead end this file exists to
 * catch — there is now no second company-number input on the address step to
 * fall back on, because there is no first one either.
 *
 * Two failure shapes, both of which have shipped in this repo before:
 *
 *  - a number that is empty AND locked AND needed on the surface that still
 *    renders one;
 *  - state that is bound to nothing. The display lives in companyName.phtml and
 *    the state in companyName-csp-js.phtml, so a getter can be perfect and the
 *    page still inert. Every binding under test is therefore read out of the
 *    SHIPPED markup and then looked up on the real component.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

/**
 * Every selector the removed address-step company-number input ever answered
 * to. Asserted ABSENT from the shipped markup — the removal is the fix, so a
 * test that only stopped mentioning the field would let it come back.
 */
const REMOVED_ID_INPUT_SELECTORS = [
  "input[data-two-company-id]",
  "input.company_id",
  "#two_address_company_id",
];

/**
 * The fixture stand-in for the element `onCompanyIdInput()` reads through
 * `$el`. It is deliberately NOT a shipped selector: the address step renders no
 * such input any more, and the handler survives only to maintain the
 * provenance the payment step consumes. Naming it something the markup cannot
 * contain is what stops this fixture being mistaken for the real thing.
 */
const ID_DRIVER = "input[data-test-company-id-driver]";

describe("address-step company number", () => {
  let env;
  let fetchStub;
  let component;
  let nameField;
  let idField;
  let root;
  let recordedPairs;

  beforeEach(() => {
    // Nesting depth is load-bearing: setAddressData() walks four levels up
    // from $root to find the address container.
    //
    // Two inputs: the company NAME field, and the number driver described at
    // ID_DRIVER — a test stand-in for the payment step's input, since this
    // surface renders none. Only the name field carries
    // `data-two-capture-field`, and the driver sits FIRST, so document order is
    // not what makes `companyNameField()` right.
    document.body.innerHTML = [
      '<div id="address-container">',
      '  <input name="city" value="" />',
      "  <div><div><div>",
      '    <div id="company-root" class="two-company-search" data-two-capture-host="address">',
      '      <input type="text" class="company_id" data-test-company-id-driver="true" value="" />',
      '      <input type="text" id="company-field" data-two-capture-field value="" />',
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
    idField = document.querySelector(ID_DRIVER);
    root = document.getElementById("company-root");

    // Every pair this role's identity notified — the one channel by which a
    // capture on this surface reaches anything else on the page.
    recordedPairs = [];
    env.identityFor("shipping").subscribe(function (identity) {
      recordedPairs.push({
        company_name: identity.companyName(),
        company_id: identity.companyId(),
        company_id_source: identity.companyIdSource(),
      });
    });
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.useRealTimers();
  });

  /**
   * Mount the picker. `el` is the NAME field, because that is the element the
   * component's `x-data` node contains and the one `companyNameField()` resolves.
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
    // The mount's own restore has a test of its own below.
    recordedPairs.length = 0;
    return mounted;
  }

  /** @returns {Object} the one popover the shared controller mounted */
  function panel() {
    expect(env.companyPanels).toHaveLength(1);
    return env.companyPanels[0];
  }

  /** @returns {Object} the page-level capture controller */
  function capture() {
    expect(env.captureControllers).toHaveLength(1);
    return env.captureControllers[0];
  }

  /** The "Enter manually" chip. Abandons the number in play and blanks the field. */
  function enterManual() {
    capture().manualEntryMode();
  }

  /** The "Registered company" chip — the way back out. */
  function leaveManual() {
    capture().registeredMode();
  }

  /** The stored blob, as the accessors left it. */
  function storedSelection() {
    const raw = env.browserStorage.getItem(H.COMPANY_SELECTION_KEY);
    return raw === null ? null : JSON.parse(raw);
  }

  /**
   * Type into the company-name field, the way its binding does.
   *
   * The binding is `@input.debounce.300ms="onNameFieldInput"`. In search mode
   * this handler only keeps `search` in step, because the panel owns the field
   * there; in manual mode, and on a store with the lookup off, it is the commit
   * path. Both are exercised below, in the mode that owns them.
   *
   * @param {string} text
   * @returns {Promise<void>}
   */
  async function typeName(text) {
    nameField.value = text;
    component.onNameFieldInput();
    await H.flushPromises();
  }

  /**
   * Run a search the way the panel does — through the six-member search API,
   * which is the only route from the popover's query box to this engine.
   *
   * Any search this starts is settled before returning. An unsettled one leaves
   * the helper's live 30s timeout armed behind the test, which shows up as a
   * five-second test rather than as a failure.
   *
   * @param {string} text
   * @returns {Promise<void>}
   */
  async function typeQuery(text) {
    const pending = component.capturePanelSearch({ term: text });
    await H.flushPromises();
    const call = fetchStub.lastSearch();
    if (call !== undefined && !call.settled) {
      call.respond({ items: [] });
    }
    await pending;
  }

  /**
   * Pick a search hit, through the popover — the one route a registry pick
   * takes. It lands on the shared identity, which is what this surface mirrors.
   *
   * @param {Object} item
   * @returns {Promise<void>}
   */
  async function pick(item) {
    panel().options.onSelect({
      text: item.companyName,
      companyId: item.companyId,
      lookupId: item.lookupId,
    });
    await H.flushPromises();
  }

  /**
   * Drive `onCompanyIdInput()` the way the PAYMENT step's binding does.
   *
   * The address step has no such input since §5/§7; the handler survives
   * because it is what stamps `company_id_source: 'manual'` into the shared
   * blob, and the payment step derives its own field's editability from that.
   */
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

  describe("the address step renders no company-number input at all (TWO-25326 §5/§7)", () => {
    // REPLACES the four tests that read this input's `:disabled` / `:value` /
    // `@input.debounce.300ms` bindings, its `company_id` class, its label and
    // its absent `name`. The field itself is what the ticket removes, so the
    // assertions are now about its absence and about the state surviving it.
    test.each(REMOVED_ID_INPUT_SELECTORS)(
      "the shipped markup contains no `%s`",
      (selector) => {
        const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
        const doc = new DOMParser().parseFromString(markup, "text/html");

        expect(doc.querySelector(selector)).toBeNull();
      },
    );

    test("nothing on this surface submits or labels a company number", () => {
      // The label went with the input. A "Company Number" label pointing at
      // nothing is worse than none — it announces a control that is not there
      // — and a `name` would post an unknown field into the address form.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector('[name*="company_id"]')).toBeNull();
      expect(doc.querySelector('label[for*="company_id"]')).toBeNull();
      // The tile's bridge resolves ITS fields by getElementById, so an element
      // here carrying either id would capture the tile's writes.
      expect(doc.querySelector("#company_id")).toBeNull();
      expect(doc.querySelector("#manual_company_id")).toBeNull();
    });

    test("the only company-number surface left is the read-only display", () => {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const display = doc.querySelector(".two-company-id-display");

      expect(display).not.toBeNull();
      expect(display.tagName).not.toBe("INPUT");
      // Every text input the shipped markup owns, enumerated: the company NAME
      // field and nothing else. The panel's query box is built at runtime.
      const textInputs = Array.from(doc.querySelectorAll('input[type="text"]'));
      expect(textInputs).toHaveLength(1);
      expect(textInputs[0].className).toContain("company_name");
    });

    test("the provenance state survives the removal, because the payment step reads it", () => {
      // `companyIdDisabled` / `applyCompanyIdEditability()` /
      // `onCompanyIdInput()` / `companyIdEntryRequired` are deliberately kept:
      // they maintain `company_id_source` in the shared selection blob, which
      // is the payment step's only way to tell a registry number from one the
      // buyer typed. Deleting them along with the input would silently re-lock
      // the tile's field over the buyer's own value.
      const mounted = mount();

      expect(typeof mounted.applyCompanyIdEditability).toBe("function");
      expect(typeof mounted.onCompanyIdInput).toBe("function");
      expect(typeof mounted.companyIdDisabled).toBe("boolean");
      expect(typeof mounted.companyIdEntryRequired).toBe("boolean");
      // And the tile still binds the state that mirrors it, so the two ends of
      // that contract are asserted together rather than assumed.
      expect(
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_id"]',
          ":disabled",
        ),
      ).toBe("companyIdDisabled");
    });

    test("the below-the-field manual-entry link stays gone (2026-08-05 ruling, superseding bug 4.2 round 2)", () => {
      // 2026-07-28 first pass deleted this link outright: its old gate showed
      // it whenever the panel was shut, which included an untouched field and
      // a completed selection — both states its wording ("My company is not
      // on the list") is false in. That much was right, but deleting it with
      // no replacement left an untouched/sub-threshold field with NO route
      // into manual entry at all, so 2026-08-01 (adversarial review round 2)
      // restored it, gated on `belowFieldManualEntryVisible`.
      //
      // 2026-08-05 (TWO-25326 tile bugfix batch, bug 2) removed it again for
      // good instead: the panel now opens on click/keypress from zero typed
      // characters, so the in-dropdown row is reachable immediately and there
      // is no state left for a persistent second copy to cover. See
      // company-manual-entry.test.js for the full behavioural proof.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");

      expect(doc.querySelector(".two-company-manual-entry")).toBeNull();
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

    test("a pick WITH an identifier fills and locks the field", async () => {
      component = mount({ quote_id: "test-quote-1" });

      await pick(hit("Acme Ltd", "111"));

      expect(component.companyId).toBe("111");
      expect(component.companyName).toBe("Acme Ltd");
      expect(component.companyIdDisabled).toBe(true);
      expect(storedSelection().company_id).toBe("111");
    });

    test("a pick WITHOUT an identifier leaves the field empty and typeable", async () => {
      component = mount({ company_id: "999" });

      await pick(hit("Example Trading Ltd", ""));

      // The previous pick's number must not survive beside a new company's
      // name — that submits company A while the buyer selected company B.
      expect(component.companyId).toBe("");
      expect(component.companyIdDisabled).toBe(false);
      expect(storedSelection().company_id).toBe("");
    });

    test("a pick stays locked in SEARCH mode, because the name cannot be edited there", async () => {
      // REPLACES "editing the name after a pick unlocks the field again".
      // TWO-25326 §1 makes that edit impossible on this surface: the panel owns
      // the name field in search mode and moves anything typed into its own
      // query box, so `onNameFieldInput` returns before it can invalidate a
      // registry pick. The unlock still exists — see the manual-mode tests
      // below, where the field IS the capture field.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      expect(component.companyIdDisabled).toBe(true);

      await typeName("Acme Limited");

      expect(component.companyIdDisabled).toBe(true);
      expect(component.companyId).toBe("111");
    });

    test("editing the name in MANUAL mode after a pick unlocks the number", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      expect(component.companyIdDisabled).toBe(true);

      enterManual();
      await typeName("Acme Limited");

      expect(component.companyIdDisabled).toBe(false);
    });

    test("it stays unlocked while the buyer keeps typing", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      enterManual();

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
      enterManual();

      await typeName("Different Company Ltd");
      await typeName("Different Company Ltd");

      expect(component.companyIdDisabled).toBe(false);
    });

    test.each([
      ["Acme Ltd", "re-typing the captured name"],
      ["Acme Limited", "typing a different one"],
    ])(
      "manual entry abandons a vouched number and %s does not bring it back (%s)",
      async (typed) => {
        // The chip means "the company in play is not the one I want", so the
        // number goes with the mode switch, before anything is typed.
        component = mount({ quote_id: "test-quote-1" });
        await pick(hit("Acme Ltd", "111"));
        expect(component.companyIdDisabled).toBe(true);

        enterManual();
        expect(component.companyId).toBe("");

        await typeName(typed);

        expect(component.companyId).toBe("");
        expect(component.companyIdDisabled).toBe(false);
        expect(storedSelection().company_id).toBe("");
        expect(storedSelection().company_name).toBe(typed);
      },
    );

    test("bouncing through manual mode does not re-lock an unvouched number", async () => {
      // A buyer who takes the manual-entry chip and returns to search must not
      // find the number field locked — nothing has vouched for a number for the
      // name they are holding.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Example Trading Ltd", ""));
      expect(component.companyIdDisabled).toBe(false);

      enterManual();
      expect(component.companyIdDisabled).toBe(false);

      leaveManual();
      expect(component.companyIdDisabled).toBe(false);
    });

    test("manual mode unlocks the number a registry pick vouched for, by abandoning it", () => {
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });
      expect(component.companyIdDisabled).toBe(true);

      enterManual();
      expect(component.companyIdDisabled).toBe(false);
      expect(component.companyId).toBe("");

      leaveManual();

      // Nothing vouches for a number for the name now held, so the way back out
      // leaves the field typeable rather than re-locking it.
      expect(component.companyIdDisabled).toBe(false);
      expect(component.companyIdSource).toBe("");
    });
  });

  describe("init restores the completed-selection flag (TWO-25288 element 5 round 2)", () => {
    // `isCompanySelected` says a company has actually been captured, and the
    // mount has to restore it: a page reload after a completed pick otherwise
    // reads as an untouched field.
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

    test("a real edit after a restored selection flips it back (TWO-25288 element 5 round 2)", async () => {
      // The two fixes chained, not just proven in isolation: init() marks a
      // restored pick complete, and a real edit must still be able to end that
      // state, or a restored selection looks identical to one made this page
      // load but is never editable.
      //
      // Driven through `onNameFieldInput()` in MANUAL mode, which is where the
      // clear lives: in search mode the panel holds the name field, so nothing
      // typed there can end the selection.
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });
      expect(component.isCompanySelected).toBe(true);

      enterManual();
      await typeName("Acme Limited");

      expect(component.isCompanySelected).toBe(false);
    });

    test("a query run in the panel does not touch the restored selection", async () => {
      // The complement of the test above, and the reason the clear had to move.
      // Looking for alternatives is not the same act as abandoning the company
      // already captured, and conflating them is what published half-typed
      // queries as the order's company name.
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });

      await typeQuery("Something Else");

      expect(component.isCompanySelected).toBe(true);
      expect(component.companyId).toBe("111");
      expect(storedSelection().company_name).toBe("Acme Ltd");
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
        manual_mode: false,
      });
      expect(component.companyId).toBe("12345678");
    });

    test("the mount restores the company into THIS role's identity", () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Acme Ltd",
          company_id: "111",
          company_id_source: "registry",
        }),
      );

      H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: nameField,
        root: root,
      }).init();

      expect(recordedPairs[recordedPairs.length - 1]).toEqual({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });
    });

    test("the restore reaches no other role", () => {
      env.browserStorage.setItem(
        H.COMPANY_SELECTION_KEY,
        JSON.stringify({
          quote_id: "test-quote-1",
          company_name: "Acme Ltd",
          company_id: "111",
          company_id_source: "registry",
        }),
      );

      H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: nameField,
        root: root,
      }).init();

      expect(env.identityFor("billing").companyName()).toBe("");
      expect(env.browserStorage.getItem(H.BILLING_COMPANY_KEY)).toBeNull();
    });

    test("re-firing with an unchanged value writes nothing", () => {
      // The handler fires more than once for the same text — a second debounce
      // window, a blur, a Magewire echo — and only a real change may write.
      component = mount({ quote_id: "test-quote-1", company_id: "12345678" });

      typeNumber("12345678");

      expect(storedSelection().company_id_source).toBe("");
    });
  });

  describe("the typed company NAME is captured on every path", () => {
    test("manual entry records the name the buyer types", async () => {
      // The manual-mode guard used to return before the field was read, so
      // nothing recorded the name — and placement needs a name beside the
      // number. This is the sole-trader path on this surface.
      component = mount({ quote_id: "test-quote-1" });
      enterManual();

      await typeName("Jo Smith Trading");

      expect(storedSelection().company_name).toBe("Jo Smith Trading");
      expect(fetchStub.searchCalls()).toHaveLength(0);
    });

    test("a name edit in MANUAL mode records the pair it leaves behind", async () => {
      // A buyer who reached payment, came back and changed the company must not
      // submit the previous one — and `forgetStaleCompanyId()` runs first, so
      // the previous registry number never rides along with the new name.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      recordedPairs.length = 0;

      enterManual();
      await typeName("Different Company Ltd");

      expect(storedSelection().company_name).toBe("Different Company Ltd");
      // The number is abandoned before the new name lands, so no notification
      // ever pairs the new name with the other company's identifier.
      expect(
        recordedPairs.filter(
          (pair) =>
            pair.company_name === "Different Company Ltd" && pair.company_id,
        ),
      ).toEqual([]);
      expect(recordedPairs[recordedPairs.length - 1]).toEqual({
        company_name: "Different Company Ltd",
        company_id: "",
        company_id_source: "",
      });
    });

    test("a name edit in SEARCH mode records nothing", async () => {
      // In search mode the registry pick is the single writer and records the
      // complete pair itself; the name field cannot be edited by hand there at
      // all, so anything from this path could only ever carry a partial pair.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      recordedPairs.length = 0;

      await typeName("Different Company Ltd");

      expect(recordedPairs).toEqual([]);
    });

    test("re-typing the captured name in manual entry keeps the name", async () => {
      // The mode switch abandons the number; it must not take the name with it,
      // because that is all manual entry captures.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      enterManual();
      await typeName("Acme Ltd");

      expect(storedSelection().company_name).toBe("Acme Ltd");
      expect(component.companyName).toBe("Acme Ltd");
    });
  });

  describe("a name edit never leaves the previous company's number behind", () => {
    /*
     * TWO-25326 §1 narrowed WHERE a name edit can happen at all. In search mode
     * the company-name field is not editable, so there is no name edit to
     * mishandle — the search path deliberately no longer runs the
     * stale-identifier
     * clear there, because reopening the panel to look at alternatives is not
     * evidence that the captured company changed, and clearing on it dropped a
     * perfectly good registry number. Every edit below therefore goes through
     * manual mode or a store with the lookup off, which are the two
     * configurations where the field really is the capture field — and where
     * the clear is unchanged.
     */
    test("editing the name clears the picked number from state AND storage", async () => {
      // The blob is what the payment step reads, and it derives its own locked
      // state from `company_id` being present there. Leaving the old number
      // beside the new name gave a payment step showing company B's name with
      // company A's number, LOCKED, with nothing forcing the buyer to touch it —
      // and sent company A's organisation number onward.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      expect(storedSelection().company_id).toBe("111");

      enterManual();
      await typeName("Different Company Ltd");

      expect(component.companyId).toBe("");
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_name).toBe("Different Company Ltd");
    });

    test("a search that reopens the panel does NOT drop a RESTORED registry pick", async () => {
      // The regression the narrowing exists to prevent, and the one a
      // manual-mode-only suite would miss: the search path used to run
      // forgetStaleCompanyId() on every search, and that clear fires whenever
      // `search` differs from the name the number was written for.
      //
      // On a RESTORED pick those two are guaranteed to differ: init() restores
      // `companyName` and `companyId` from storage but leaves `search` at '',
      // because nothing has read the field this page load. So the first time
      // the buyer reopened the panel after a reload, the identifier they had
      // already captured was silently dropped — and there is no editable
      // number field left on this surface to retype it into.
      //
      // Driven from a restored blob rather than a fresh pick on purpose: after
      // a fresh pick `search === companyName`, forgetStaleCompanyId() returns
      // at its own guard, and the scenario cannot tell the two versions apart.
      component = mount({
        quote_id: "test-quote-1",
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });
      expect(component.companyName).toBe("Acme Ltd");

      await typeQuery("Different Company Ltd");

      expect(component.companyId).toBe("111");
      expect(component.companyIdSource).toBe("registry");
      expect(component.companyIdDisabled).toBe(true);
      expect(storedSelection().company_id).toBe("111");
      expect(storedSelection().company_name).toBe("Acme Ltd");
    });

    test("the payment step's own gate reopens on the cleared pair", async () => {
      // The exact expression the tile derives its editability from. With the old
      // number still stored it read as "vouched for", which is the lock.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      enterManual();
      await typeName("Different Company Ltd");

      expect(Boolean(storedSelection().company_id)).toBe(false);
    });

    test("switching to manual entry and renaming clears it too", async () => {
      // The same mismatch by the other route: a hand-typed name must not travel
      // with the picked number.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      enterManual();
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
      enterManual();
      await typeName("Jo Smith Trading");

      leaveManual();

      expect(component.companyIdDisabled).toBe(false);
    });

    test("a name edit drops ANY identifier that no longer describes the name", async () => {
      // §5 removed this surface's company-number input, so nothing here can
      // write a `manual` identifier and nothing can correct one either —
      // sparing it lets an identifier left in storage by an earlier session
      // travel with a name it never belonged to.
      component = mount({ quote_id: "test-quote-1" });
      enterManual();
      await typeName("Jo Smith Trading");
      typeNumber("1234567");

      await typeName("Jo Smith Trading Ltd");

      expect(component.companyId).toBe("");
      expect(storedSelection().company_id).toBe("");
      expect(storedSelection().company_id_source).toBe("");
      // The NAME is still captured — dropping the identifier must not drop the
      // company with it.
      expect(storedSelection().company_name).toBe("Jo Smith Trading Ltd");
    });

    test("a re-fired handler on unchanged text records nothing further", async () => {
      // The handler fires more than once for the same text — a second debounce
      // window, a blur, a Magewire echo — and only a real change may record.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      enterManual();
      await typeName("Jo Smith Trading");
      recordedPairs.length = 0;

      await typeName("Jo Smith Trading");

      expect(recordedPairs).toEqual([]);
      expect(storedSelection().company_name).toBe("Jo Smith Trading");
      expect(storedSelection().company_id).toBe("");
    });
  });

  describe("in SEARCH mode the company-name field publishes nothing at all", () => {
    /*
     * REPLACES "only a settled name is published", which pinned a length guard
     * on the search path's commit. TWO-25326 §1 removed that commit outright:
     * in search mode the name field is not a query box and not a capture field
     * — only a registry pick writes the company name. That is strictly stronger
     * than the old guard, which still published every fragment at or above the
     * threshold, so the assertions are now "nothing is written", at every
     * length, including one long enough to search.
     */
    test.each([
      ["a fragment too short to search", "Ac"],
      ["an emptied field", ""],
      ["a name long enough to search", "Acme Widgets Limited"],
    ])("%s does not reach the stored company name", async (_label, text) => {
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });

      await typeName(text);

      expect(storedSelection().company_name).toBe("Acme Ltd");
      // `search` still tracks the field, because manual mode shares it — the
      // point is that nothing is PUBLISHED, not that nothing is observed.
      expect(component.search).toBe(text);
    });

    test("a pick is the only writer of the company name in search mode", async () => {
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });

      await pick(hit("Acme Widgets Limited", "222"));

      expect(storedSelection().company_name).toBe("Acme Widgets Limited");
      expect(storedSelection().company_id).toBe("222");
    });

    test("manual mode still records every name the buyer types", async () => {
      // The path that is deliberately unchanged: with no registry hit to
      // supply one, the typed name is the only name the order will ever carry.
      component = mount({ quote_id: "test-quote-1", company_name: "Acme Ltd" });
      enterManual();

      await typeName("Jo Smith Trading");

      expect(storedSelection().company_name).toBe("Jo Smith Trading");
    });
  });

  describe("a store with the lookup switched off", () => {
    beforeEach(() => {
      component = mount({ quote_id: "test-quote-1" });
      component.isCompanySearchEnabled = "";
    });

    test("never searches, whatever is typed", async () => {
      await typeName("Acme Widgets Limited");
      // Driven through the panel's search API, not `onNameFieldInput()`: the
      // latter never requests anything in any mode, so asserting on it would be
      // an assertion that cannot fail. This surface is reachable with the
      // lookup off — `enable_company_search` on but the API key unverified —
      // and the popover is mounted unconditionally there.
      await typeQuery("Acme Widgets Limited");

      expect(fetchStub.searchCalls()).toHaveLength(0);
      expect(component.isSearching).toBe(false);
      expect(component.items).toEqual([]);
    });

    test("still records the name and leaves the number typeable", async () => {
      await typeName("Acme Widgets Limited");

      expect(storedSelection().company_name).toBe("Acme Widgets Limited");
      expect(component.companyIdDisabled).toBe(false);
    });

    test("still carries a typed number into the stored record", async () => {
      await typeName("Acme Widgets Limited");
      typeNumber("87654321");

      expect(storedSelection()).toMatchObject({
        company_name: "Acme Widgets Limited",
        company_id: "87654321",
        company_id_source: "manual",
      });
      // The name edit is the identity's, and never pairs the typed name with a
      // stale number.
      expect(recordedPairs).toEqual([
        {
          company_name: "Acme Widgets Limited",
          company_id: "",
          company_id_source: "",
        },
      ]);
    });
  });

  describe("the company-number display (bug 4.3)", () => {
    /**
     * The `x-show`/`x-text` bindings read out of the shipped markup, so a
     * renamed getter that forgets to repoint either binding fails here
     * instead of silently passing.
     *
     * The `inputVisible` half is gone with the input (TWO-25326 §5/§7). It
     * used to resolve `.field.two-company-id`'s `!companyIdDisplayVisible`
     * gate through the negation getter; there is no longer any element on this
     * surface carrying that binding, and the presence of the getter alone
     * would be an assertion about dead code. What replaces it is the absence
     * assertions at the top of this file, plus `displayIsTheOnlySurface()`
     * below — the display showing is only meaningful if it is the whole story.
     *
     * @returns {{ displayVisible: boolean, displayText: string }}
     */
    function readDisplayState() {
      const DISPLAY_SELECTOR = ".two-company-id-display";
      const showBound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        DISPLAY_SELECTOR,
        "x-show",
      );
      const textBound = H.readAlpineBinding(
        H.COMPANY_NAME_MARKUP_TEMPLATE,
        DISPLAY_SELECTOR,
        "x-text",
      );

      expect(showBound in component).toBe(true);
      expect(textBound in component).toBe(true);

      return {
        displayVisible: Boolean(component[showBound]),
        displayText: component[textBound],
      };
    }

    test("nothing is shown before a company is chosen", () => {
      // REPLACES "the display element and the input are never both visible,
      // and never both hidden" — there is no input left for it to alternate
      // with. Both hidden IS the correct state here now: manual mode captures
      // a name only, so an unchosen company simply has no number on this
      // surface, and the buyer supplies one on the payment step if placement
      // needs it.
      component = mount({ quote_id: "test-quote-1" });

      const state = readDisplayState();
      expect(state.displayVisible).toBe(false);
      expect(state.displayText).toBe("");
    });

    test("a registry-vouched pick shows the plain-text display", async () => {
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));

      const state = readDisplayState();
      expect(state.displayVisible).toBe(true);
      expect(state.displayText).toBe("111");
    });

    test("a pick with no registry identifier shows no number at all", async () => {
      // Nothing was "selected" in the sense this design turns on — the
      // registry gave no number, so there is nothing to read out as text, and
      // nothing on this surface for the buyer to type one into either.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Example Trading Ltd", ""));

      const state = readDisplayState();
      expect(state.displayVisible).toBe(false);
      expect(component.companyIdEntryRequired).toBe(true);
    });

    test("a hand-typed number is never read out as a registry one", () => {
      // Manual entry has no "selected result" at all. The number the buyer
      // transcribes on the payment step must stay theirs to correct, so it
      // must not appear here as inert, vouched-for text.
      component = mount({ quote_id: "test-quote-1" });
      enterManual();
      typeNumber("1234567");

      const state = readDisplayState();
      expect(component.companyId).toBe("1234567");
      expect(component.companyIdSource).toBe("manual");
      expect(state.displayVisible).toBe(false);
      expect(component.companyIdDisabled).toBe(false);
    });

    test("editing the name in manual mode after a registry pick takes the display down", async () => {
      // The lock reverses (`companyIdDisabled` suite above already pins
      // this); the display must track the same reversal, or the buyer would
      // see inert text for a number that no longer describes the company in
      // the field. Driven through manual mode, the only place the name is
      // editable since §1.
      component = mount({ quote_id: "test-quote-1" });
      await pick(hit("Acme Ltd", "111"));
      expect(readDisplayState().displayVisible).toBe(true);

      enterManual();
      await typeName("Acme Limited");

      expect(readDisplayState().displayVisible).toBe(false);
    });

    test("a restored registry pick shows the display on the very first render", () => {
      // No flash of an unpopulated display before init() settles: the gate is
      // `hasVouchedCompanyId()`, computed straight from restored state.
      component = mount({
        company_name: "Acme Ltd",
        company_id: "111",
        company_id_source: "registry",
      });

      const state = readDisplayState();
      expect(state.displayVisible).toBe(true);
      expect(state.displayText).toBe("111");
    });

    test("the display carries no input semantics of its own", () => {
      // It is text, not a control masquerading as one — no label pointing at
      // it, no name, nothing for a form or a screen reader to treat as an
      // input.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const display = doc.querySelector(".two-company-id-display");

      expect(display).not.toBeNull();
      expect(display.tagName).not.toBe("INPUT");
      expect(display.hasAttribute("name")).toBe(false);
    });

    test("the display names itself for screen readers", () => {
      // The visible "Company Number" label div is hidden once this display
      // is showing (it belongs to the input branch), so without an
      // aria-label of its own a screen-reader user hears only the bare
      // registry number, with nothing announcing what it is. The harness
      // resolves every `__()` call to one placeholder string (see
      // `ESCAPED_STRING` in hyva-harness.js), so this asserts the attribute
      // is present and non-empty rather than pinning exact wording.
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      const doc = new DOMParser().parseFromString(markup, "text/html");
      const display = doc.querySelector(".two-company-id-display");

      expect(display.hasAttribute("aria-label")).toBe(true);
      expect(display.getAttribute("aria-label")).toBe(H.ESCAPED_STRING);
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
      expect(
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_id"]',
          ":disabled",
        ),
      ).toBe("companyIdDisabled");
    });
  });
});
