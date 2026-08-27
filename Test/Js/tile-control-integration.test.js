/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326, 2026-08-05. The payment tile mounts the ONE company-search control
 * (form/field/company-search-control.phtml + `twoGatewayCompanySearchControl()`)
 * with no `x-data` of its own, so the control's state lands on the payment form's
 * component beside the tile label and the order-intent dispatch.
 *
 * That is a WIRING claim, and wiring is what the rest of this directory cannot
 * check. The unit suites mount a component against a hand-built fixture, so they
 * pass whether or not the shipped markup resolves against the shipped component:
 * a class the resolver looks for that the template does not emit, a bound method
 * name that no longer exists, an input the field resolver picks in the wrong
 * order — all invisible to a fixture written to agree with the component.
 *
 * So this suite renders the tile's REAL markup, mounts the REAL component over
 * it, and walks one whole capture: search for a term, take a result, and check
 * what the buyer and the order end up with. Only `fetch` is stubbed.
 *
 * TWO-25503 moved the popover into the base plugin, so the walk goes through the
 * options the tile hands the panel rather than through markup this repo renders.
 * That is the wiring claim now: the panel's own DOM, its open/close and its
 * keyboard handling are covered against the real file in magento-plugin's suite.
 *
 * The one thing it cannot render faithfully is `$twoControlAlpineData`: the
 * harness substitutes a single value for both mount points, so the address
 * step's `x-data` appears in the tile's render too. It is stripped below, which
 * reproduces production — and `company-search-one-control.test.js` pins the two
 * templates' actual values at source level, which is the only place that
 * difference is checkable.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

describe("the payment tile's mounted control (integration)", () => {
  let env;
  let fetchStub;
  let component;
  let form;
  let nameField;
  let panel;

  beforeEach(() => {
    const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);

    document.body.innerHTML = [
      // The dispatcher refuses to run unless Two is the checked payment option.
      '<input type="radio" name="payment-method-option" value="two_payment" checked />',
      // `twoGatewayGetCountryCode()` reads this when the quote has no country;
      // without a country the engine refuses to search at all.
      '<input id="shipping-country_id" value="GB" />',
      // Production emits no `x-data` here — see the file comment.
      markup.replace(/x-data="twoGatewayHyvaCompanySearchField"/, ""),
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    env.fireAlpineInit();

    form = document.getElementById("two_payment_form");
    component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
      el: form,
      root: form,
    });
    component.$watch = function () {};
    component.initialize(JSON.parse(H.QUOTE_JSON));

    nameField = form.querySelector('input[name="payment[company_name]"]');
    expect(env.companyPanels).toHaveLength(1);
    panel = env.companyPanels[0];
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    document.body.innerHTML = "";
  });

  /**
   * Run a search the way the panel does, and settle it with one hit.
   *
   * @param {string} term
   * @param {string} identifier value for `national_identifier.id`
   * @returns {Promise<Object>} the panel-shaped result
   */
  async function search(term, identifier) {
    const pending = panel.options.search.searchCompanies({ term: term });
    await H.flushPromises();
    fetchStub.last().respond({
      items: [
        {
          name: "Example Trading Ltd",
          highlight: "<em>Example</em> Trading Ltd",
          national_identifier: { id: identifier },
          lookup_id: "lookup-1",
        },
      ],
    });
    const result = await pending;
    await H.flushPromises();
    return result;
  }

  /**
   * Take a result the way the panel does.
   *
   * @param {Object} item one entry from `search()`'s result
   * @returns {void}
   */
  function select(item) {
    panel.options.onSelect(item);
  }

  test("the shipped markup and the shipped component resolve to each other", () => {
    expect(nameField).not.toBeNull();

    // The control's DOM resolvers, against the real markup rather than a
    // fixture. `controlRoot()` returning null is the failure that silently
    // disables the whole control on this surface, because `$root` here is the
    // whole `<form>`, not the control.
    expect(component.controlRoot()).not.toBeNull();
    expect(component.companyNameField()).toBe(nameField);
    // The name field must never be mistaken for the number input — that
    // resolver decides what is published as the order's company name.
    expect(component.companyNameField()).not.toBe(
      document.getElementById("company_id"),
    );
  });

  test("the popover is built on that field and no other", () => {
    expect(panel.calls).toContain("bind");
    // Document-wide, because that is how the panel resolves its host: a
    // selector matching anything else would give it the wrong input.
    const matched = document.querySelectorAll(panel.options.fieldSelector);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toBe(nameField);
  });

  test("searching goes on the wire, and leaves the captured name alone", async () => {
    const result = await search("example", "123456789");

    expect(fetchStub.calls.length).toBe(1);
    expect(fetchStub.last().url).toContain("country=GB");
    expect(fetchStub.last().url).toContain("q=example");
    expect(result.items).toHaveLength(1);
    // The panel holds the query in its own box; it never leaks into the field
    // that submits.
    expect(nameField.value).toBe("");
  });

  test("taking a result captures it everywhere the order and the tile need it", async () => {
    const result = await search("example", "123456789");

    select(result.items[0]);

    // What submits.
    expect(nameField.value).toBe("Example Trading Ltd");
    expect(document.getElementById("company_id").value).toBe("123456789");
    // What the buyer reads.
    expect(component.companyTileLabelText).toBe(
      "Example Trading Ltd (123456789)",
    );
    // The chips are repainted, so the mode the pick put the control in reads
    // as selected.
    expect(panel.calls.some((call) => call.startsWith("syncChips:registered"))).toBe(true);
    // And the intent check has visibly started.
    expect(component.orderIntentChecking).toBe(true);
  });

  test("a placeholder identifier is captured but never rendered", async () => {
    const result = await search("example", "TWO:ST-0001");

    // The results row the buyer chose from already hid it.
    expect(result.items[0].html).toBe("<em>Example</em> Trading Ltd");

    select(result.items[0]);

    // Captured for the API…
    expect(document.getElementById("company_id").value).toBe("TWO:ST-0001");
    // …and absent, brackets included, from everything on screen.
    expect(component.companyTileLabelText).toBe("Example Trading Ltd");
  });

  test("manual entry is reachable from the panel and hands the field back", () => {
    component.enterManually();

    expect(component.manualMode).toBe(true);
    expect(component.manualModeActive).toBe(true);
    // The field is now the buyer's own to type in, which on this surface means
    // the panel has let go of it.
    expect(panel.calls).toContain("releaseField");
    expect(component.searchModeActive).toBe(false);
    // The company-number input unlocks with it, since nothing has vouched for
    // an identifier for a hand-typed name.
    expect(component.companyIdDisabled).toBe(false);

    component.enableSearch();
    expect(component.searchModeActive).toBe(true);
    expect(panel.calls).toContain("reclaimField");
  });

  test("a hand-typed name is committed as the company, with no identifier", () => {
    component.enterManually();

    nameField.value = "Unlisted Trading Ltd";
    component.$el = nameField;
    component.onNameFieldInput();

    expect(component.search).toBe("Unlisted Trading Ltd");
    expect(component.hasVouchedCompanyId()).toBe(false);
    // The tile label follows the intent notice, so the name alone is what a
    // manual-entry buyer would see there once a decision lands.
    expect(component.companyTileLabelText).toBe("Unlisted Trading Ltd");
  });

  test("starting a new search takes the previous verdict off the tile", async () => {
    // 2026-08-05, cross-platform order-intent UI unification: a buyer searching
    // again is replacing the company the standing verdict was about, so the
    // verdict is stale from the moment the search starts — not from the moment
    // the replacement is picked, and not from the moment the next decision
    // arrives. The live notice properties are assigned directly rather than
    // resolved from brand copy: what is under test is the clearing, and the
    // three of them are the whole visible verdict.
    //
    // `$watch` is a no-op in this suite (see beforeEach), so the `companyName` /
    // `companyId` watchers cannot be what clears these — this isolates the
    // search-start path the engine's `onLoaderStart` hook drives.
    component.orderIntentApprovedNotice = "Available for Example Trading Ltd";
    component.orderIntentNotAvailableNotice = "stale not-available";
    component.orderIntentErrorNotice = "stale error";

    const pending = panel.options.search.searchCompanies({ term: "example" });
    await H.flushPromises();

    // A request is on the wire and NOTHING has come back yet.
    expect(fetchStub.calls.length).toBe(1);
    expect(component.orderIntentApprovedNotice).toBe("");
    expect(component.orderIntentNotAvailableNotice).toBe("");
    expect(component.orderIntentErrorNotice).toBe("");
    expect(component.orderIntentMessageVisible).toBe(false);
    expect(component.twoTileNotAvailableVisible).toBe(false);
    expect(component.twoTileErrorVisible).toBe(false);

    fetchStub.last().respond({ items: [] });
    await pending;
  });

  test("the panel-closed hook fires with the INCOMING company already written", async () => {
    // Round 9: the outcome-only version of this test below cannot fail on the
    // ordering it names, because fillCompanyData() clears or re-derives in the
    // same synchronous call and erases the wrong-company repaint before anything
    // can observe it. So observe the hook ITSELF: what the company was at the
    // moment it ran is the whole claim.
    select((await search("alpha", "111111111")).items[0]);

    const seenAtHookTime = [];
    const real = component.refreshOrderIntentVerdict.bind(component);
    component.refreshOrderIntentVerdict = function () {
      seenAtHookTime.push({ id: this.companyId, name: this.companyName });
      return real();
    };

    select((await search("beta", "222222222")).items[0]);

    // It did fire — otherwise this test would pass by observing nothing.
    expect(seenAtHookTime.length).toBeGreaterThan(0);
    // And every time it fired, the pick had already been written. Before the
    // engine's call was moved below the state writes, this was the OUTGOING
    // company and the hook painted its verdict over the new one.
    seenAtHookTime.forEach((seen) => {
      expect(seen.id).toBe("222222222");
      expect(seen.name).toBe("Example Trading Ltd");
    });
  });

  test("picking a new company evaluates against the INCOMING one", async () => {
    // Round-5 finding. The engine dismissed the panel BEFORE writing the pick's
    // company, so the tile's panel-closed repaint ran against the OUTGOING one —
    // briefly repainting the previous company's verdict and lowering the progress
    // row of the request that had just gone out for its replacement. Ordering was
    // the fix, so this is assertable synchronously.
    select((await search("alpha", "111111111")).items[0]);
    component.orderIntentApprovedNoticeCopy = {
      withCompany: "Available for {{companyName}}",
      withoutCompany: "Available",
      companyNameToken: "{{companyName}}",
      companyNumberToken: "{{companyNumber}}",
    };
    component.processOrderIntentSuccessResponse(
      { approved: true },
      "111111111",
      "Example Trading Ltd",
    );
    component.setOrderIntentChecking(false);
    expect(component.orderIntentApprovedNotice).not.toBe("");

    // A different company is picked.
    select((await search("beta", "222222222")).items[0]);

    // The previous company's verdict is not on screen next to the new company,
    // and the new company's check is visibly running.
    expect(component.companyId).toBe("222222222");
    expect(component.orderIntentApprovedNotice).toBe("");
    expect(component.orderIntentMessageVisible).toBe(false);
    expect(component.orderIntentChecking).toBe(true);
  });

  test("abandoning a search puts the standing verdict back", async () => {
    // Round-3 finding: clearing on search start had no counterpart for a search
    // that ENDS without changing the company. The buyer opens the panel, types,
    // then presses Escape or clicks away — no watcher fires, no pick happens, and
    // nothing else writes the notices, so the verdict was gone for the rest of
    // the session. In the declined case that removes the explanation for a
    // decline that still stands.
    select((await search("example", "123456789")).items[0]);
    // A real copy OBJECT. The harness's default stand-in for this getter is a
    // bare JSON string, which the resolver cannot substitute into.
    component.orderIntentApprovedNoticeCopy = {
      withCompany: "Available for {{companyName}} ({{companyNumber}})",
      withoutCompany: "Available",
      companyNameToken: "{{companyName}}",
      companyNumberToken: "{{companyNumber}}",
    };
    component.processOrderIntentSuccessResponse(
      { approved: true },
      "123456789",
      "Example Trading Ltd",
    );
    // The pick raised the progress row optimistically and this suite runs no
    // dispatcher to settle it, so it is settled here as the real one's `finally`
    // does — lowering the row is what paints the box, since a verdict may never
    // share the tile with a progress row.
    component.setOrderIntentChecking(false);
    expect(component.orderIntentApprovedNotice).not.toBe("");

    // Search again — the box goes down.
    const pending = panel.options.search.searchCompanies({ term: "example" });
    await H.flushPromises();
    expect(component.orderIntentApprovedNotice).toBe("");
    fetchStub.last().respond({ items: [] });
    await pending;

    // …and abandoning it puts the box back, because the company on screen is
    // still the one the verdict was reached for. Synchronous: the engine
    // dismisses the panel AFTER writing the pick's company, so the hook needs no
    // deferral (round 5).
    component.closeDropdown();

    expect(component.orderIntentApprovedNotice).not.toBe("");
    expect(component.orderIntentMessageVisible).toBe(true);
  });

  test("a search too short to go on the wire leaves the verdict standing", async () => {
    // The complement of the test above, and what stops it from passing for the
    // wrong reason. Clearing is hung on a search actually starting, so a buyer
    // who opens the panel and types one character has not replaced anything
    // yet and must not lose the verdict for the company they still have.
    component.orderIntentApprovedNotice = "Available for Example Trading Ltd";

    await panel.options.search.searchCompanies({ term: "e" });
    await H.flushPromises();

    expect(fetchStub.calls.length).toBe(0);
    expect(component.orderIntentApprovedNotice).toBe(
      "Available for Example Trading Ltd",
    );
  });

  test("the control's own number display stays down on this surface", async () => {
    select((await search("example", "123456789")).items[0]);

    // The tile carries the number in its single `<name> (<number>)` label, so
    // the control's display would print it twice.
    expect(component.companyIdDisplayVisible).toBe(false);
  });
});
