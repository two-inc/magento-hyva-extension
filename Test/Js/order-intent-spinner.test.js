/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 tile bugfix batch, bug 5 + cross-platform requirement 11.
 *
 * Bug 5: the order-intent check had no visible progress indicator at all on
 * Hyvä. A buyer who picked a company sat looking at an unchanged tile for
 * however long the decision took, with no way to tell it was working.
 *
 * Requirement 11 is the standing cross-platform rule about the fix: the
 * indicator must be LOCAL to the payment tile, never a page-covering overlay.
 * The reason is the same one that made the company-search spinner an in-field
 * element rather than `magewire:loader:start` — a full-screen overlay over a
 * checkout the buyer is still filling in blocks interaction for a background
 * check they did not ask for. So this file asserts both halves: that the
 * indicator exists and is driven by real request state, AND that the intent path
 * dispatches no magewire loader event.
 *
 * The lifecycle assertions run against the REAL module-level dispatcher, because
 * that is what owns the flag once a request is on the wire; `placeOrderIntent()`
 * is the seam.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaPaymentMethodBase";

/** The indicator's own gate, read out of the shipped markup. */
const CHECKING_SHOW_BINDING = H.readAlpineBinding(
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
  '[data-name="order_intent_checking"]',
  "x-show",
);

/** A promise plus its resolver, so a test decides when the request settles. */
function deferred() {
  let resolve;
  const promise = new Promise(function (res) {
    resolve = res;
  });
  return { promise: promise, resolve: resolve };
}

/**
 * Take the popover back down, so a verdict the open panel suppressed appears.
 *
 * @param {Object} env the installed Hyvä environment
 */
function closeCompanyPopover(env) {
  env.companyPanels[env.companyPanels.length - 1].close();
}

/**
 * Put the popover on screen, the way clicking the company field does.
 *
 * Drives the panel the component actually built rather than stubbing the
 * question away, so a component that never mounted one fails here instead of
 * passing on a fake answer.
 *
 * @param {Object} env the installed Hyvä environment
 */
function openCompanyPopover(env) {
  expect(env.companyPanels.length).toBeGreaterThan(0);
  env.companyPanels[env.companyPanels.length - 1].open();
}

describe("order-intent progress indicator (bug 5 / requirement 11)", () => {
  describe("the shipped markup", () => {
    let doc;

    beforeAll(() => {
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
      doc = new DOMParser().parseFromString(markup, "text/html");
    });

    test("the indicator is inside the payment tile, not a page-level overlay", () => {
      const indicator = doc.querySelector('[data-name="order_intent_checking"]');
      expect(indicator).not.toBeNull();

      // Inside the tile's own root — the element that carries the tile
      // component. An indicator rendered as a sibling of the tile, or appended
      // to `<body>`, is the page overlay requirement 11 forbids.
      const tileRoot = doc.querySelector(".payment-method-custom-form");
      expect(tileRoot).not.toBeNull();
      expect(tileRoot.contains(indicator)).toBe(true);

      // Nothing that would make it cover the page. `fixed`/`inset-0` are the
      // Tailwind utilities an overlay is built from, and this element carries
      // neither; it is in the tile's normal flow.
      const classes = indicator.getAttribute("class") || "";
      expect(classes).not.toMatch(/\bfixed\b/);
      expect(classes).not.toMatch(/\binset-0\b/);
    });

    test("it announces itself rather than being a bare decorative GIF", () => {
      const indicator = doc.querySelector('[data-name="order_intent_checking"]');

      // Same treatment as the two intent verdict notices it precedes: a live
      // region with real text. The GIF alone tells a screen-reader user
      // nothing, which is why the spinner span is `aria-hidden` and the
      // sentence beside it is not.
      expect(indicator.getAttribute("role")).toBe("status");
      expect(indicator.textContent.trim().length).toBeGreaterThan(0);

      const spinner = indicator.querySelector(".two-company-search__spinner");
      expect(spinner).not.toBeNull();
      expect(spinner.getAttribute("aria-hidden")).toBe("true");
      // Childless: the class paints a `background-image`, and a background
      // image needs no child nodes.
      expect(spinner.childNodes.length).toBe(0);
    });

    test("its gate is a bare property the component actually defines", () => {
      // `readAlpineBinding` already refused anything but a bare property name.
      // What it cannot check is that the component HAS that property — a
      // binding resolving to `undefined` is exactly as invisible as a missing
      // one, and this repo has shipped that before.
      const env = H.installHyvaEnvironment();
      try {
        H.loadSharedHelpers();
        env.fireAlpineInit();
        const component = H.mountComponent(
          env.alpineComponents[COMPONENT_NAME],
          {},
        );
        expect(typeof component[CHECKING_SHOW_BINDING]).toBe("boolean");
        expect(component[CHECKING_SHOW_BINDING]).toBe(false);
      } finally {
        env.restore();
      }
    });
  });

  describe("the lifecycle", () => {
    let env;
    let fetchStub;
    let component;
    let form;

    beforeEach(() => {
      jest.useFakeTimers();
      document.body.innerHTML = [
        '<input type="radio" name="payment-method-option" value="two_payment" checked />',
        '<form id="two_payment_form">',
        '  <input type="text" class="two-company-search" style="display:none" />',
        '  <input type="text" id="company_name" name="payment[company_name]" value="" />',
        '  <input type="text" id="company_id" name="payment[company_id]" value="" />',
        "</form>",
      ].join("\n");

      env = H.installHyvaEnvironment();
      // The capture controller asks the registry for the billing country's
      // company types the moment the tile mounts.
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
    });

    afterEach(() => {
      fetchStub.restore();
      env.restore();
      jest.useRealTimers();
      document.body.innerHTML = "";
    });

    test("goes up on the pick, not 500ms later when the request leaves", () => {
      component.placeOrderIntent = function () {
        return deferred().promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");

      // Before the dispatcher's debounce has elapsed. Half a second of a tile
      // that has visibly not reacted to the pick is the complaint.
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);
    });

    test("a check going on the wire clears whatever verdict was showing", () => {
      // The invariant enforced where the request actually leaves, which is the
      // only place that covers ALL of the dispatch sites. The address-area company
      // sync fires this event directly, changing neither company name nor id, so
      // no watcher runs and nothing else would clear the box — round 6 found a
      // stale verdict sitting beside the progress row for the whole request.
      component.placeOrderIntent = function () {
        return deferred().promise;
      };
      component.generalErrorMessage = "SENTINEL-general-error";

      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNotice = "YES Alpha Ltd";
      // …and a previous FAILURE for the same company, which a fresh check must
      // forget, because the question is being asked again.
      component.orderIntentFailures["111111111"] = { name: "Alpha Ltd" };

      window.dispatchEvent(new Event("dispatch-order-intent"));
      jest.advanceTimersByTime(500);

      expect(component.orderIntentChecking).toBe(true);
      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.orderIntentFailures["111111111"]).toBeUndefined();
    });

    test("a rejected check reports through the real dispatcher", () => {
      // The ONLY production route to the error box: the dispatcher's `.catch`
      // records the failure while a check is still in flight, and its `.finally`
      // lowers the row, which is what re-derives the box. Every other test in
      // this file calls the error handler directly with the row already down — a
      // state the live dispatcher never produces at that point — so without this
      // the whole path was uncovered (round 7).
      component.generalErrorMessage = "SENTINEL-general-error";
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.placeOrderIntent = function () {
        return Promise.reject({});
      };

      component.fillCompanyData("111111111", "Alpha Ltd");
      jest.advanceTimersByTime(500);

      return H.flushPromises().then(() => {
        expect(component.orderIntentChecking).toBe(false);
        expect(component.orderIntentErrorNotice).toBe("SENTINEL-general-error");
        expect(component.twoTileErrorVisible).toBe(true);
        // And it stays retryable: a failure is never a decision.
        expect(component.orderIntentDecisions["111111111"]).toBeUndefined();
      });
    });

    test("comes down when the payment method changes inside the debounce", () => {
      // Round-3 finding. The row goes up optimistically on the pick, so every
      // path that then declines to make a request has to take it back down. Two
      // early returns in the debounce callback did not, leaving a permanent
      // "Checking availability" box — reachable by picking a company and then
      // switching payment method within the 500ms window.
      component.placeOrderIntent = function () {
        return deferred().promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);

      // The buyer switches away from Two before the debounce elapses.
      document.querySelector(
        'input[name="payment-method-option"]',
      ).value = "some_other_method";
      jest.advanceTimersByTime(500);

      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("comes down when no payment method is selected at all", () => {
      component.placeOrderIntent = function () {
        return deferred().promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);

      document.querySelector(
        'input[name="payment-method-option"]',
      ).checked = false;
      jest.advanceTimersByTime(500);

      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("comes down when the request settles", async () => {
      const request = deferred();
      component.placeOrderIntent = function () {
        return request.promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      jest.advanceTimersByTime(500);
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);

      request.resolve({ approved: true });
      await H.flushPromises();

      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("a superseded request finishing late does not take it down", async () => {
      const first = deferred();
      const second = deferred();
      let call = 0;
      component.placeOrderIntent = function () {
        call += 1;
        return call === 1 ? first.promise : second.promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      jest.advanceTimersByTime(500);

      component.companyName = "Company B";
      component.companyId = "222222222";
      component.fillCompanyData("222222222", "Company B");
      jest.advanceTimersByTime(500);

      first.resolve({ approved: true });
      await H.flushPromises();

      // B's check is genuinely still running. Lowering the indicator here would
      // tell the buyer a decision has been reached when none has.
      expect(component[CHECKING_SHOW_BINDING]).toBe(true);

      second.resolve({ approved: true });
      await H.flushPromises();
      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("a dispatch that declines to request takes it down again", () => {
      let calls = 0;
      component.placeOrderIntent = function () {
        calls += 1;
        return deferred().promise;
      };

      // Order intent switched off for the merchant: the dispatcher makes no
      // request at all, so an indicator raised by fillCompanyData() would spin
      // for the rest of the session.
      component.isOrderIntentEnabled = "";
      component.orderIntentChecking = true;
      window.dispatchEvent(new Event("dispatch-order-intent"));
      jest.advanceTimersByTime(500);

      expect(calls).toBe(0);
      expect(component[CHECKING_SHOW_BINDING]).toBe(false);
    });

    test("nothing on the intent path raises the page-wide magewire loader", async () => {
      const request = deferred();
      component.placeOrderIntent = function () {
        return request.promise;
      };

      component.companyName = "Company A";
      component.companyId = "111111111";
      component.fillCompanyData("111111111", "Company A");
      jest.advanceTimersByTime(500);
      request.resolve({ approved: true });
      await H.flushPromises();

      // The harness records `magewire:loader:start` / `:done` as a sequence.
      // Requirement 11: this check must never reach for that overlay.
      expect(env.loaderEvents).toEqual([]);
    });
  });

  /*
   * 2026-08-05, cross-platform order-intent UI unification.
   *
   * The in-progress row and the three verdicts are ONE box in four states, in
   * one place in the tile, differing only in colour and carrying no title —
   * the treatment the other three platforms render. What is checkable here is
   * the structure and the source of the wording; the rendered TEXT is not,
   * because this harness collapses every translation call to one constant, so
   * wording is pinned at template-source level instead.
   */
  describe("the one order-intent box, four states", () => {
    const fs = require("fs");
    const path = require("path");

    const TILE_SOURCE = fs.readFileSync(
      path.join(H.REPO_ROOT, H.GATEWAY_METHOD_MARKUP_TEMPLATE),
      "utf8",
    );
    /*
     * COMMENTS STRIPPED, and every assertion below reads this rather than the
     * raw file.
     *
     * Two ways prose defeats a regex written to find code, and this file hit
     * both. It contains the same tokens as the declaration it explains, so
     * `[^}]*margin:` matched the explanation instead of the rule. And it
     * contains BRACES — this stylesheet quotes selectors like
     * `.two-order-intent-message { margin: 0 0 1.5em }` inside rule bodies as a
     * matter of style — so `[^}]*\}` terminates at a comment's brace and the
     * match truncates before the declarations that follow it. That silently
     * un-covered the "geometry is declared once" assertion, whose whole purpose
     * is catching a state that re-declares geometry.
     *
     * `company-search-focus-scope` and `company-search-spinner` already do this.
     */
    const CSS_SOURCE = fs
      .readFileSync(
        path.join(H.REPO_ROOT, "view/frontend/web/css/custom.css"),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, "");

    /** The four states, by the `data-name` each element is found under. */
    const STATES = [
      ["order_intent_checking", "two-order-intent-checking"],
      ["order_intent_message", "approved"],
      ["order_intent_not_available_message", "unavailable"],
      ["order_intent_error_message", "error"],
    ];

    let doc;

    beforeAll(() => {
      doc = new DOMParser().parseFromString(
        H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE),
        "text/html",
      );
    });

    test("the in-progress row says exactly 'Checking availability'", () => {
      // Source-level, because the harness resolves every `__()` to one
      // constant — a rendered-text assertion here could not fail. The old
      // wording is asserted ABSENT too: a translation key left behind in the
      // template is a string no catalogue has a row for any more, which
      // degrades silently to English.
      expect(TILE_SOURCE).toContain("__('Checking availability')");
      expect(TILE_SOURCE).not.toContain("Checking your company");
    });

    test("the dispatcher passes an absent company name as absent, not as ''", () => {
      // A CONTRACT assertion, deliberately at source level. The record treats a
      // missing name as UNKNOWN and stores `null`, which no company name can
      // match; coercing to '' hands it a value that IS matchable and quietly
      // kills that fail-closed branch. The only behavioural difference is on a
      // late nameless reply, which the sequence guard makes very hard to reach
      // from a test — so this pins the contract instead of simulating the path,
      // and it fails if the coercion comes back.
      const jsSource = fs.readFileSync(
        path.join(H.REPO_ROOT, H.GATEWAY_METHOD_TEMPLATE),
        "utf8",
      );
      expect(jsSource).toContain(
        "const requestedCompanyName = component.companyName || undefined;",
      );
      expect(jsSource).not.toContain(
        "const requestedCompanyName = component.companyName || '';",
      );
    });

    test("every locale has a row for that exact key", () => {
      const catalogues = fs
        .readdirSync(path.join(H.REPO_ROOT, "i18n"))
        .filter((name) => name.endsWith(".csv"));

      // Guards the rename against the half-done case: the template asking for
      // a key none of the four catalogues answers.
      expect(catalogues.length).toBeGreaterThan(0);
      catalogues.forEach((name) => {
        const csv = fs.readFileSync(
          path.join(H.REPO_ROOT, "i18n", name),
          "utf8",
        );
        expect(csv).toContain('"Checking availability","');
        expect(csv).not.toContain("Checking your company");
      });
    });

    test.each(STATES)(
      "%s is a bordered colour box with no title, in the tile's own flow",
      (dataName, stateClass) => {
        const el = doc.querySelector('[data-name="' + dataName + '"]');
        expect(el).not.toBeNull();

        const classes = (el.getAttribute("class") || "").split(/\s+/);
        expect(classes).toContain("two-order-intent-box");
        expect(classes).toContain(stateClass);

        // No title, no heading, no second line of chrome: the box holds the
        // message and nothing else. The in-progress row's own children are its
        // sentence and the spinner, neither of which is a heading.
        expect(el.querySelector("h1,h2,h3,h4,h5,h6,strong,legend")).toBeNull();

        // In the tile's flow, never a page overlay (requirement 11).
        const tileRoot = doc.querySelector(".payment-method-custom-form");
        expect(tileRoot).not.toBeNull();
        expect(tileRoot.contains(el)).toBe(true);
        expect(classes).not.toContain("fixed");
        expect(classes).not.toContain("inset-0");

        // `x-cloak`, so nothing `x-show` will hide is visible before Alpine
        // boots. The error box is emitted unconditionally and its border and
        // background come from this module's stylesheet rather than from
        // possibly-uncompiled utilities, which made the pre-Alpine flash of an
        // empty red bordered strip certain rather than merely possible.
        expect(el.hasAttribute("x-cloak")).toBe(true);
      },
    );

    test("the stylesheet carries the rule x-cloak depends on", () => {
      // The attribute alone does nothing. Nothing else in this module used
      // `x-cloak`, so the rule it needs had to be declared here — and if it goes
      // missing the four boxes flash on every checkout load, which is the exact
      // defect the attribute was added to fix.
      // Anchored on the module's own class, not on `[x-cloak]` alone: round 9
      // showed the loose pattern matched any selector, so narrowing or typo'ing
      // this rule left the assertion green while restoring the flash it exists to
      // prevent.
      expect(CSS_SOURCE).toMatch(
        /\.two-order-intent-box\[x-cloak\]\s*\{[^}]*display:\s*none/,
      );
    });

    test.each(STATES)(
      "%s gets its colour from this module's own stylesheet",
      (dataName, stateClass) => {
        // Not a Tailwind utility. The merchant owns the Tailwind build, so a
        // colour only this module asks for may never be generated — and the
        // failure is silent: a borderless, colourless box that still claims a
        // verdict. `input.company_id:disabled` and
        // `.two-company-search__unavailable` are CSS here for the same reason.
        const selector =
          stateClass === "two-order-intent-checking"
            ? "." + stateClass
            : ".two-order-intent-message." + stateClass;
        // Whitespace-tolerant: the claim is that this module's stylesheet
        // declares the state, not that it is formatted a particular way.
        expect(CSS_SOURCE).toMatch(
          new RegExp(selector.replace(/[.]/g, "\\.") + "\\s*\\{"),
        );

        const el = doc.querySelector('[data-name="' + dataName + '"]');
        const classes = el.getAttribute("class") || "";
        expect(classes).not.toMatch(/\bbg-[a-z]+-\d{2,3}\b/);
        expect(classes).not.toMatch(/\btext-[a-z]+-\d{2,3}\b/);
        expect(classes).not.toMatch(/\bborder-[a-z]+-\d{2,3}\b/);
      },
    );

    test("the in-progress row reserves its spinner gutter independent of order", () => {
      // Equal-specificity rules would leave this decided by position in the file
      // (round 9). Two classes, so reordering the stylesheet cannot silently
      // shrink the gutter the absolutely-positioned spinner sits in.
      expect(CSS_SOURCE).toMatch(
        /\.two-order-intent-box\.two-order-intent-checking\s*\{[^}]*padding-right:/,
      );
      expect(CSS_SOURCE).toMatch(
        /\.two-order-intent-box\.two-order-intent-checking\s*\{[^}]*position:\s*relative/,
      );
    });

    test("the geometry is declared once, on the shared class", () => {
      // The four states drifted apart when each restated its own padding and
      // radius in a class list. Only `.two-order-intent-box` may declare them.
      expect(CSS_SOURCE).toMatch(
        /\.two-order-intent-box \{[^}]*border-radius:[^}]*\}/,
      );
      /*
       * MARGIN too, and stated rather than inherited. The base plugin's
       * stylesheet, which this checkout also loads, carries a bare
       * `.two-order-intent-message { margin: … }` — a class the three VERDICT
       * boxes carry and the two in-progress boxes do not. Leaving margin unset
       * here lets that rule apply to some states and not others, which is
       * exactly the drift declaring geometry once is supposed to prevent.
       */
      expect(CSS_SOURCE).toMatch(
        /\.two-order-intent-box \{[^}]*margin:[^}]*\}/,
      );
      STATES.forEach(([, stateClass]) => {
        if (stateClass === "two-order-intent-checking") return;
        const rule = CSS_SOURCE.match(
          new RegExp("\\.two-order-intent-message\\." + stateClass + " \\{[^}]*\\}"),
        );
        expect(rule).not.toBeNull();
        expect(rule[0]).not.toContain("border-radius");
      });
    });
  });

  describe("the three verdicts are mutually exclusive", () => {
    let env;
    let fetchStub;
    let component;

    beforeEach(() => {
      // A real control root and company field, because one of this describe's
      // rules is about what happens UNDER AN OPEN POPOVER — and the popover is
      // built around that field. Mounted with neither, there is no panel to
      // open and the rule cannot be expressed.
      document.body.innerHTML = [
        '<div id="root" class="two-company-search" data-two-capture-host="tile">',
        '  <input type="text" id="field" data-two-capture-field value="" />',
        "</div>",
      ].join("\n");

      env = H.installHyvaEnvironment();
      fetchStub = H.stubFetch();
      H.loadSharedHelpers();
      env.fireAlpineInit();
      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        root: document.getElementById("root"),
      });
      component.mountCompanyPopover();
      component.orderIntentApprovedNoticeCopy = null;
      component.orderIntentNotAvailableCopy = null;
    });

    afterEach(() => {
      fetchStub.restore();
      env.restore();
    });

    /**
     * 2026-08-06 ruling: ONE verdict, ONE notice.
     *
     * A decline used to raise a 5-second toast as well as the in-tile box —
     * two notices saying the same thing, the weaker of which self-dismisses
     * and lands at the top of the page rather than beside the company it is
     * about. The box is the verdict surface on all four platforms.
     *
     * Asserted against `env.messages`, the harness's record of
     * `window.dispatchMessages()`, so this fails the moment the call comes
     * back — including from a place other than where it was deleted.
     */
    describe("a decline raises no toast", () => {
      test("the in-tile box is the only notice a decline produces", () => {
        component.companyName = "Alpha Ltd";
        component.companyId = "111111111";
        component.orderIntentNotAvailableCopy = {
          withCompany: "NO {{companyName}}",
          withoutCompany: "NO",
          companyNameToken: "{{companyName}}",
          companyNumberToken: "{{companyNumber}}",
        };
        component.orderIntentDeclinedMessage = "SENTINEL-declined-toast";

        component.processOrderIntentSuccessResponse(
          { approved: false },
          "111111111",
          "Alpha Ltd",
        );

        // The box did paint — otherwise "no toast" would be satisfied by a
        // verdict that never rendered at all.
        expect(component.orderIntentNotAvailableNotice).toBe("NO Alpha Ltd");
        expect(component.twoTileNotAvailableVisible).toBe(true);
        expect(env.messages).toEqual([]);
      });

      /**
       * The case that keeps a toast (review round 1): the box's ELEMENT is only
       * rendered when the brand has not switched the notice copy off, and a
       * brand shipping today does switch it off — so a declined buyer there gets
       * the toast rather than nothing at all.
       *
       * Null copy is the PRECONDITION this test sets up, not the gate. The gate
       * asks the wider question — `resolveOrderIntentNotAvailableNotice() === ''`
       * — which also catches copy that is present but unusable; the sibling test
       * below covers that half.
       */
      test("a brand with no inline notice at all still gets told", () => {
        // `beforeEach` already nulls both copies, which IS the suppressed
        // brand; asserted explicitly so the precondition is not incidental.
        expect(component.orderIntentNotAvailableCopy).toBeNull();
        component.companyName = "Alpha Ltd";
        component.companyId = "111111111";
        component.orderIntentDeclinedMessage = "SENTINEL-declined";

        component.processOrderIntentSuccessResponse(
          { approved: false },
          "111111111",
          "Alpha Ltd",
        );

        expect(env.messages).toEqual([
          [{ type: "error", text: "SENTINEL-declined" }],
        ]);
        // And there is genuinely no box to have shown instead.
        expect(component.orderIntentNotAvailableNotice).toBe("");
        expect(component.twoTileNotAvailableVisible).toBe(false);
      });

      test("copy that is present but unusable falls back too", () => {
        // Review round 2. The resolver deliberately degrades malformed copy to
        // a SILENT box rather than throwing, so gating the fallback on "the
        // copy is null" left exactly that defensive branch showing a rendered,
        // empty box and no toast — silence, from the guard that exists to stop
        // the tile going dead.
        component.companyName = "Alpha Ltd";
        component.companyId = "111111111";
        component.orderIntentDeclinedMessage = "SENTINEL-declined";
        component.orderIntentNotAvailableCopy = {
          // No `withCompany` string: resolves to '' for a named company.
          withoutCompany: "NO",
          companyNameToken: "{{companyName}}",
          companyNumberToken: "{{companyNumber}}",
        };

        component.processOrderIntentSuccessResponse(
          { approved: false },
          "111111111",
          "Alpha Ltd",
        );

        expect(component.orderIntentNotAvailableNotice).toBe("");
        expect(env.messages).toEqual([
          [{ type: "error", text: "SENTINEL-declined" }],
        ]);
      });

      test("an APPROVAL on that same brand raises nothing", () => {
        // The fallback is for the decline only — a brand that suppressed its
        // approved copy has said it does not want the buyer congratulated.
        component.companyId = "111111111";

        component.processOrderIntentSuccessResponse(
          { approved: true },
          "111111111",
          "Alpha Ltd",
        );

        expect(env.messages).toEqual([]);
      });

      test("dropping the toast did not drop the verdict the flag records", () => {
        // The toast sat directly above `placeOrderIntentFlag`'s write in the
        // same branch, so deleting the branch by hand could have taken the
        // flag with it.
        component.orderIntentNotAvailableCopy = {
          withCompany: "NO {{companyName}}",
          withoutCompany: "NO",
          companyNameToken: "{{companyName}}",
          companyNumberToken: "{{companyNumber}}",
        };
        component.companyId = "111111111";
        component.processOrderIntentSuccessResponse(
          { approved: true },
          "111111111",
          undefined,
        );
        expect(component.placeOrderIntentFlag).toBe(true);

        component.processOrderIntentSuccessResponse(
          { approved: false },
          "111111111",
          undefined,
        );
        expect(component.placeOrderIntentFlag).toBe(false);
        expect(env.messages).toEqual([]);
      });

      test("a FAILED check still toasts — it carries detail the box does not", () => {
        // Deliberately unchanged by the ruling: the box shows the general
        // wording only, so deleting this toast would drop the API's own
        // diagnostic text with nothing left carrying it.
        component.companyId = "111111111";
        component.generalErrorMessage = "SENTINEL-general-error";

        component.processOrderIntentErrorResponse({}, "111111111");

        expect(env.messages).toEqual([
          [{ type: "error", text: "SENTINEL-general-error" }],
        ]);
      });
    });

    test("clearOrderIntentNotices() takes all three down together", () => {
      component.orderIntentApprovedNotice = "a";
      component.orderIntentNotAvailableNotice = "b";
      component.orderIntentErrorNotice = "c";

      component.clearOrderIntentNotices();

      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.orderIntentNotAvailableNotice).toBe("");
      expect(component.orderIntentErrorNotice).toBe("");
      // Whether a check is RUNNING is a separate fact and is not touched.
      component.orderIntentChecking = true;
      component.clearOrderIntentNotices();
      expect(component.orderIntentChecking).toBe(true);
    });

    test("an errored check replaces a standing approval with the error box", () => {
      component.companyId = "111111111";
      component.orderIntentApprovedNotice = "Available for Company A";
      // Seeded so the clearing assertion below can actually fail: an assertion
      // that a property is '' when nothing ever set it passes vacuously.
      component.orderIntentNotAvailableNotice = "stale not-available";
      // A sentinel, not the component's own `generalErrorMessage`: this harness
      // collapses every translation call to ONE constant, so asserting the box
      // equals `generalErrorMessage` would pass for any translated string at all
      // and prove only that the box is non-empty.
      component.generalErrorMessage = "SENTINEL-general-error";

      component.processOrderIntentErrorResponse({}, "111111111");

      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.orderIntentNotAvailableNotice).toBe("");
      // The error is now REPORTED in the tile, not only in a toast that
      // self-dismisses: a tile that goes back to showing nothing is
      // indistinguishable from a check that never ran.
      expect(component.orderIntentErrorNotice).toBe("SENTINEL-general-error");
      expect(component.twoTileErrorVisible).toBe(true);
      expect(component.placeOrderIntentFlag).toBe(false);
    });

    test("a schema error with per-field messages leaves the box empty", () => {
      component.companyId = "111111111";

      component.processOrderIntentErrorResponse(
        {
          responseJSON: {
            error_code: "SCHEMA_ERROR",
            error_json: [{ msg: "field one is wrong" }],
          },
        },
        "111111111",
      );

      // There is no single sentence to put in the box; the per-field messages
      // are toasted instead, exactly as before.
      expect(component.orderIntentErrorNotice).toBe("");
      expect(component.twoTileErrorVisible).toBe(false);
      // And no RECORD either — otherwise the panel-closed repaint would invent a
      // box for it out of `generalErrorMessage`, which is precisely the sentence
      // this path decided it did not have.
      expect(component.orderIntentFailures).toEqual({});
      component.refreshOrderIntentVerdict();
      expect(component.twoTileErrorVisible).toBe(false);
    });

    test("a late reply does not decide whether the ORDER may be placed", () => {
      // Round-5 finding on round-4's fix: hoisting the flag above the
      // on-screen guard meant a reply about a company the buyer had left could
      // still set it. The flag says whether THIS order may be placed, and the
      // order is for the company on screen.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );
      expect(component.placeOrderIntentFlag).toBe(true);

      // B's decline lands late, while A is still on screen.
      component.processOrderIntentSuccessResponse(
        { approved: false },
        "222222222",
        "Beta Ltd",
      );

      expect(component.placeOrderIntentFlag).toBe(true);
      // …but B's decision is still recorded, so B is not stuck.
      expect(component.orderIntentDecisions["222222222"]).toEqual({
        name: "Beta Ltd",
        approved: false,
      });
    });

    test("no verdict is repainted underneath an open results panel", () => {
      // The repaint path has to obey the same rule the reply path does, or the
      // two disagree — reachable here because this tile's company-number field
      // is editable, so a decided number can be typed back in with the panel up.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "YES {{companyName}}",
        withoutCompany: "YES",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );
      expect(component.orderIntentApprovedNotice).toBe("YES Alpha Ltd");

      component.clearOrderIntentNotices();
      openCompanyPopover(env);
      component.refreshOrderIntentVerdict();

      expect(component.orderIntentApprovedNotice).toBe("");
    });

    test("a retry in flight is not overpainted by the failure it is retrying", () => {
      // Round-5 finding. The repaint fired on the panel closing, a moment after
      // the re-pick had already raised the progress row and dispatched — so it
      // killed the row and put the stale failure back while the retry was still
      // on its way, and the dispatcher then raised the row again, leaving both on
      // screen at once.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.generalErrorMessage = "SENTINEL-general-error";
      component.isOrderIntentEnabled = "1";

      component.processOrderIntentErrorResponse({}, "111111111", "Alpha Ltd");
      expect(component.twoTileErrorVisible).toBe(true);

      // The buyer re-picks the same company: a retry goes out.
      component.fillCompanyData("111111111", "Alpha Ltd");
      expect(component.orderIntentChecking).toBe(true);

      // The panel closing must not resurrect the failure over the attempt.
      component.refreshOrderIntentVerdict();

      expect(component.twoTileErrorVisible).toBe(false);
      expect(component.orderIntentChecking).toBe(true);
    });

    test("the box never carries the API's own diagnostic text", () => {
      // The box does not self-dismiss, so upstream `error_message` /
      // `error_details` — strings written for a developer — must not be parked
      // permanently in a buyer's checkout. The toast still carries them.
      component.companyId = "111111111";
      component.generalErrorMessage = "SENTINEL-general-error";

      component.processOrderIntentErrorResponse(
        {
          responseJSON: {
            error_code: "ORDER_INVALID",
            error_message: "RAW-UPSTREAM-MESSAGE",
            error_details: "RAW-UPSTREAM-DETAILS",
          },
        },
        "111111111",
      );

      expect(component.orderIntentErrorNotice).toBe("SENTINEL-general-error");
      expect(component.orderIntentErrorNotice).not.toContain("RAW-UPSTREAM");
    });

    test("a late reply files its verdict under the company it ASKED about", () => {
      // Round-3 finding, and the sharpest one: the id used to advance above the
      // paint guard while the name and decision were written below it, so this
      // interleaving tore the record apart and left company B both unreachable
      // (dedup said decided, the name said otherwise) and liable to be shown
      // company A's approval.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      // B is picked, then the buyer reverts to A before B's reply lands.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.processOrderIntentSuccessResponse(
        { approved: false },
        "222222222",
        "Beta Ltd",
      );

      // B's record is entirely B's — name and decision filed under B's id, and
      // A's own record is untouched beside it. One slot could not do this: B
      // overwrote it, and A's verdict was gone for the session.
      expect(component.orderIntentDecisions["222222222"]).toEqual({
        name: "Beta Ltd",
        approved: false,
      });
      expect(component.orderIntentDecisions["111111111"]).toEqual({
        name: "Alpha Ltd",
        approved: true,
      });

      // Nothing about B is painted while A is on screen…
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.orderIntentNotAvailableNotice).toBe("");

      // …and B's own decline is reachable the moment B is on screen again,
      // rather than being stuck behind a name that never matches.
      component.companyName = "Beta Ltd";
      component.companyId = "222222222";
      component.orderIntentNotAvailableCopy = {
        withCompany: "No: {{companyName}}",
        withoutCompany: "No",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.refreshOrderIntentVerdict();
      expect(component.twoTileNotAvailableVisible).toBe(true);
    });

    test("a verdict is not painted underneath an open results panel", () => {
      // A reply can land mid-search. Painting it behind the dropdown of
      // candidates replacing that very company is the complaint that made a new
      // search clear the box at all.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "Yes: {{companyName}}",
        withoutCompany: "Yes",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      openCompanyPopover(env);

      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      expect(component.orderIntentApprovedNotice).toBe("");
      // But it is on record, so closing the panel shows it.
      expect(component.orderIntentDecisions["111111111"].approved).toBe(true);
      closeCompanyPopover(env);
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).not.toBe("");
    });

    test("two companies' verdicts coexist, and coming back shows yours", () => {
      // THE reason the record is a map. Six review rounds were spent patching a
      // single slot that could not represent this: approve A, check B, come back
      // to A, and A's verdict was gone for the session because B had overwritten
      // the only slot there was.
      const copy = (word) => ({
        withCompany: word + " {{companyName}}",
        withoutCompany: word,
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      });
      component.orderIntentApprovedNoticeCopy = copy("YES");
      component.orderIntentNotAvailableCopy = copy("NO");

      // A is approved.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );
      expect(component.orderIntentApprovedNotice).toBe("YES Alpha Ltd");

      // B is declined.
      component.companyName = "Beta Ltd";
      component.companyId = "222222222";
      component.processOrderIntentSuccessResponse(
        { approved: false },
        "222222222",
        "Beta Ltd",
      );
      expect(component.orderIntentNotAvailableNotice).toBe("NO Beta Ltd");

      // Back to A: A's own approval, not B's decline, and no new check needed.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).toBe("YES Alpha Ltd");
      expect(component.orderIntentNotAvailableNotice).toBe("");

      // And back to B: B's decline is still B's.
      component.companyName = "Beta Ltd";
      component.companyId = "222222222";
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentNotAvailableNotice).toBe("NO Beta Ltd");
      expect(component.orderIntentApprovedNotice).toBe("");
    });

    test("a malformed notice copy yields a silent box, never a throw", () => {
      // The box is re-derived from the dispatcher's `finally` now, so a throw in
      // a resolver is an unhandled rejection that takes the rest of that handler
      // with it — including lowering the progress row. A brand supplies this copy
      // through config, so a missing sentence must degrade, not detonate.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNoticeCopy = { withoutCompany: "YES" };

      expect(() => {
        component.processOrderIntentSuccessResponse(
          { approved: true },
          "111111111",
          "Alpha Ltd",
        );
      }).not.toThrow();
      expect(component.orderIntentApprovedNotice).toBe("");

      expect(() => component.refreshOrderIntentVerdict()).not.toThrow();
    });

    test("a copy with no no-company sentence resolves to '', not 'undefined'", () => {
      // The sibling guard, and a different failure from the one above: the old
      // code returned `undefined` here rather than throwing, and `x-text` renders
      // that as the literal word "undefined" in the buyer's tile.
      //
      // Asserted on the RESOLVER, not on the painted notice. Round 8 caught the
      // first version of this test being vacuous: refresh's `if (!text) return`
      // swallows `undefined` and '' identically, so the notice is '' either way
      // and the defect the test names could not be observed through it.
      component.companyName = "";
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "YES {{companyName}}",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.orderIntentNotAvailableCopy = {
        withCompany: "NO {{companyName}}",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };

      expect(component.resolveOrderIntentApprovedNotice()).toBe("");
      expect(component.resolveOrderIntentNotAvailableNotice()).toBe("");
    });

    test("the dedup gate will not reuse a decision reached under another name", () => {
      // The name half of `hasOrderIntentDecisionFor`, which round 8 found had no
      // coverage at all — the gate's own JSDoc and AGENTS.md both call it
      // load-bearing. A company renamed by hand after its check must be asked
      // about again rather than inheriting the old name's answer, because the
      // notice text embeds the name.
      component.orderIntentDecisions["111111111"] = {
        name: "Old Ltd",
        approved: true,
      };

      expect(
        component.hasOrderIntentDecisionFor("111111111", "Old Ltd"),
      ).toBe(true);
      expect(
        component.hasOrderIntentDecisionFor("111111111", "Renamed Ltd"),
      ).toBe(false);

      // And through the gate that matters: a dispatch DOES go out for the
      // renamed company.
      const dispatched = [];
      const listener = () => dispatched.push("intent");
      window.addEventListener("dispatch-order-intent", listener);
      try {
        component.isOrderIntentEnabled = "1";
        component.fillCompanyData("111111111", "Renamed Ltd");
        expect(dispatched).toEqual(["intent"]);
      } finally {
        window.removeEventListener("dispatch-order-intent", listener);
      }
    });

    test("an errored check is not painted under an open panel either", () => {
      // Round 6: the two paint paths have to agree. The error path used to paint
      // regardless, justified by there being no record to repaint from later —
      // there is one now, so the justification is gone.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.generalErrorMessage = "SENTINEL-general-error";
      openCompanyPopover(env);

      component.processOrderIntentErrorResponse({}, "111111111", "Alpha Ltd");

      expect(component.orderIntentErrorNotice).toBe("");
      // On record, so closing the panel reports it.
      expect(component.orderIntentFailures["111111111"]).toEqual({
        name: "Alpha Ltd",
      });
      closeCompanyPopover(env);
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentErrorNotice).toBe("SENTINEL-general-error");
    });

    test("a check raised outside the pick path clears the standing verdict", () => {
      // Why the explicit clear beside the optimistic row is not redundant:
      // raising the row does not clear (only LOWERING re-derives), so without it a
      // standing verdict would sit beside "Checking availability" for the whole
      // request — the one state the box is not allowed to be in.
      //
      // Two paths reach it with something standing. A re-pick of a company whose
      // check FAILED: failures are not in the decisions map, so the dedup gate
      // opens and dispatches, while the panel-closed repaint has already put the
      // error box back. And a manual-entry commit, which reaches
      // `onCompanyCommitted` without `onDropdownClear` ever firing.
      //
      // (An earlier version of this comment named the shipping-step sync and the
      // storage restore. Both are wrong and review round 11 caught it: the sync
      // assigns `companyName`/`companyId` directly and never calls this method,
      // and the storage restore passes `triggerOrderIntent = false`, so it takes
      // the else branch. There are exactly two callers.)
      //
      // Found by mutation sweep after round 9: deleting that clear failed nothing.
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "YES {{companyName}}",
        withoutCompany: "YES",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.isOrderIntentEnabled = "1";

      // A is decided and its verdict is on screen.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );
      component.setOrderIntentChecking(false);
      expect(component.orderIntentApprovedNotice).toBe("YES Alpha Ltd");

      // A different company arrives without any dropdown interaction.
      component.fillCompanyData("222222222", "Beta Ltd");

      expect(component.orderIntentChecking).toBe(true);
      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.orderIntentNotAvailableNotice).toBe("");
      expect(component.orderIntentErrorNotice).toBe("");
    });

    test("a check in progress outranks every recorded verdict", () => {
      // The invariant, stated once instead of guarded per route (round 6).
      // "Checking availability" and a conclusion cannot both be true, and after
      // three rounds of guarding one more path to that state this is the rule
      // that removes the class: while a check is running, nothing paints. The
      // dispatcher re-derives the box the moment it settles, so nothing is lost.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "Yes: {{companyName}}",
        withoutCompany: "Yes",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      component.orderIntentChecking = true;
      component.refreshOrderIntentVerdict();

      // The row is left alone, and no verdict is painted beside it.
      expect(component.orderIntentChecking).toBe(true);
      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.twoTileNotAvailableVisible).toBe(false);
      expect(component.twoTileErrorVisible).toBe(false);

      // Settled, and the same record now paints.
      component.orderIntentChecking = false;
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).toBe("Yes: Alpha Ltd");
    });

    test("a decided verdict clears the other two states", () => {
      // Real copy objects. `beforeEach` nulls both, which makes every resolver
      // return '' — so asserting a notice is '' after a verdict would pass with
      // the clearing deleted. With copy installed, each verdict paints its OWN
      // non-empty string and the exclusivity is a real claim.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNoticeCopy = {
        withCompany: "YES {{companyName}}",
        withoutCompany: "YES",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.orderIntentNotAvailableCopy = {
        withCompany: "NO {{companyName}}",
        withoutCompany: "NO",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };

      component.orderIntentErrorNotice = "stale error";
      component.orderIntentNotAvailableNotice = "stale not-available";

      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      expect(component.orderIntentApprovedNotice).toBe("YES Alpha Ltd");
      expect(component.orderIntentErrorNotice).toBe("");
      expect(component.orderIntentNotAvailableNotice).toBe("");

      component.orderIntentErrorNotice = "stale error";
      component.processOrderIntentSuccessResponse(
        { approved: false },
        "111111111",
        "Alpha Ltd",
      );

      expect(component.orderIntentNotAvailableNotice).toBe("NO Alpha Ltd");
      expect(component.orderIntentErrorNotice).toBe("");
      expect(component.orderIntentApprovedNotice).toBe("");
    });

    test("a failed check is repainted too, not lost with the box", () => {
      // Round-4 finding: the abandoned-search repaint covered the two decided
      // verdicts but not the failed one, which is written by the error handler
      // and was never recorded — so a buyer who searched and abandoned lost the
      // report of a failure that was still failing, with the order still blocked.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.generalErrorMessage = "SENTINEL-general-error";

      component.processOrderIntentErrorResponse({}, "111111111");
      expect(component.twoTileErrorVisible).toBe(true);

      // A search starts and is then abandoned.
      component.clearOrderIntentNotices();
      expect(component.twoTileErrorVisible).toBe(false);
      component.refreshOrderIntentVerdict();

      expect(component.orderIntentErrorNotice).toBe("SENTINEL-general-error");
      expect(component.twoTileErrorVisible).toBe(true);
    });

    test("a failure stays retryable, and a later decision supersedes it", () => {
      // The failure record is deliberately kept OUT of the dedup gate: that gate
      // reads the DECISIONS map, so filing an error there would suppress
      // the retry the error exists to invite.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.generalErrorMessage = "SENTINEL-general-error";

      component.processOrderIntentErrorResponse({}, "111111111");
      // No DECISION record — a failure must stay eligible for retry, and the
      // dedup gate reads the decisions, so filing it there would suppress the
      // retry the failure exists to invite.
      expect(component.orderIntentDecisions["111111111"]).toBeUndefined();

      component.orderIntentApprovedNoticeCopy = {
        withCompany: "YES {{companyName}}",
        withoutCompany: "YES",
        companyNameToken: "{{companyName}}",
        companyNumberToken: "{{companyNumber}}",
      };
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      // The retry's answer replaces the failure everywhere, including on a
      // later repaint — the question has been answered now.
      expect(component.orderIntentErrorNotice).toBe("");
      component.clearOrderIntentNotices();
      component.refreshOrderIntentVerdict();
      expect(component.twoTileErrorVisible).toBe(false);
      expect(component.orderIntentApprovedNotice).toBe("YES Alpha Ltd");
    });

    test("a brand-suppressed notice leaves the progress row alone", () => {
      // Round-4 finding: the repaint lowered the row before knowing whether it
      // would paint anything, so a brand that switched the copy off got a tile
      // that went blank instead of one that kept showing progress until the
      // request settled on its own.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.orderIntentApprovedNoticeCopy = null;
      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      component.orderIntentChecking = true;
      component.refreshOrderIntentVerdict();

      expect(component.orderIntentApprovedNotice).toBe("");
      expect(component.orderIntentChecking).toBe(true);
    });

    test("a late reply never pairs one company's id with another's name", () => {
      // Round-4 finding on round-3's fix: the fallback for a missing name used
      // live state, which for a late reply is the WRONG company. The record now
      // says "unknown" instead, which no company name can match, so the box
      // stays empty rather than mispainting.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";

      // A reply for B arrives with no name while A is on screen.
      component.processOrderIntentSuccessResponse({ approved: true }, "222222222");

      expect(component.orderIntentDecisions["222222222"].name).toBeNull();

      // B cannot be painted from that record…
      component.companyName = "Beta Ltd";
      component.companyId = "222222222";
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).toBe("");
      // …but a decision IS on record for B, so TWO-25345 still holds: B is not
      // asked about again just because its name could not be established.
      expect(component.orderIntentDecisions["222222222"]).toBeDefined();
    });
  });
});
