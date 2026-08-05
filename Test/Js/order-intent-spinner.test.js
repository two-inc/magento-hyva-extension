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
    const CSS_SOURCE = fs.readFileSync(
      path.join(H.REPO_ROOT, "view/frontend/web/css/custom.css"),
      "utf8",
    );

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
        expect(tileRoot.contains(el)).toBe(true);
        expect(classes).not.toContain("fixed");
        expect(classes).not.toContain("inset-0");
      },
    );

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

    test("the geometry is declared once, on the shared class", () => {
      // The four states drifted apart when each restated its own padding and
      // radius in a class list. Only `.two-order-intent-box` may declare them.
      expect(CSS_SOURCE).toMatch(
        /\.two-order-intent-box \{[^}]*border-radius:[^}]*\}/,
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
    let component;

    beforeEach(() => {
      env = H.installHyvaEnvironment();
      H.loadSharedHelpers();
      env.fireAlpineInit();
      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {});
      component.orderIntentApprovedNoticeCopy = null;
      component.orderIntentNotAvailableCopy = null;
    });

    afterEach(() => {
      env.restore();
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
      expect(component.lastOrderIntentErrorCompanyId).toBeNull();
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
      expect(component.lastOrderIntentCompanyId).toBe("222222222");
      expect(component.lastOrderIntentApproved).toBe(false);
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
      component.showDropdown = function () {
        return true;
      };
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

      // The record is entirely B's — id, name and decision together.
      expect(component.lastOrderIntentCompanyId).toBe("222222222");
      expect(component.lastOrderIntentCompanyName).toBe("Beta Ltd");
      expect(component.lastOrderIntentApproved).toBe(false);

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
      component.showDropdown = function () {
        return true;
      };

      component.processOrderIntentSuccessResponse(
        { approved: true },
        "111111111",
        "Alpha Ltd",
      );

      expect(component.orderIntentApprovedNotice).toBe("");
      // But it is on record, so closing the panel shows it.
      expect(component.lastOrderIntentApproved).toBe(true);
      component.showDropdown = function () {
        return false;
      };
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).not.toBe("");
    });

    test("repainting a verdict takes the in-progress row down with it", () => {
      // The row may still be up for a DIFFERENT company's request. It says
      // nothing true about the company now on screen, so a verdict for that
      // company replaces it rather than sitting beside it.
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

      expect(component.orderIntentChecking).toBe(false);
      expect(component.orderIntentApprovedNotice).not.toBe("");
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
      // reads `lastOrderIntentCompanyId`, so filing an error there would suppress
      // the retry the error exists to invite.
      component.companyName = "Alpha Ltd";
      component.companyId = "111111111";
      component.generalErrorMessage = "SENTINEL-general-error";

      component.processOrderIntentErrorResponse({}, "111111111");
      expect(component.lastOrderIntentCompanyId).toBe("");

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

      expect(component.lastOrderIntentCompanyId).toBe("222222222");
      expect(component.lastOrderIntentCompanyName).toBeNull();

      // B cannot be painted from that record…
      component.companyName = "Beta Ltd";
      component.companyId = "222222222";
      component.refreshOrderIntentVerdict();
      expect(component.orderIntentApprovedNotice).toBe("");
      // …but the id still advanced, so the dedup gate (TWO-25345) still works.
      expect(component.lastOrderIntentCompanyId).toBe("222222222");
    });
  });
});
