/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326 §1/§2/§4 — the Hyvä address step's company-search DROPDOWN.
 *
 * Before this work the address step had no dropdown architecture at all: the
 * company-name input was the search box, results were an overlay hanging off
 * it, and the ticket records that as "a plain in-field autocomplete". Almost
 * every §1 bullet failed as a consequence — no query field, no spinner, no
 * zero-result wording, a threshold hint that waited for a keystroke, Escape
 * doing nothing.
 *
 * This suite mounts the REAL SHIPPED MARKUP rather than a hand-built fixture,
 * because most of what §1-§4 ask for is a property of the markup's structure —
 * which element is the next tab stop, what the panel contains, whether the
 * results container is reachable by Tab. A fixture built to suit the test
 * cannot fail on any of that.
 *
 * On the limits of jsdom, stated rather than papered over: it performs no
 * layout and runs no Alpine, so `x-show` never actually hides anything here and
 * geometry cannot be asserted at all. Where visibility matters the tests either
 * evaluate the component's own gating getter (which is the thing `x-show`
 * consults) or set the inline `display: none` that Alpine would have set. The
 * PrestaShop leg of this ticket found two real defects that only a laid-out
 * browser could see, so nothing in this file is offered as a substitute for the
 * live run.
 */

"use strict";

const H = require("./hyva-harness");

const COMPONENT_NAME = "twoGatewayHyvaCompanySearchField";

/** The shipped markup, parsed. */
function shippedDoc() {
  const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("address-step company-search dropdown (TWO-25326 §1/§2/§4)", () => {
  describe("the panel's structure, read off the shipped template", () => {
    test("§1 the panel contains a real query INPUT, and it is inside the panel", () => {
      const doc = shippedDoc();
      const panel = doc.querySelector('[x-show="showDropdown"]');
      expect(panel).not.toBeNull();

      const query = doc.querySelector("input.two-company-query");
      expect(query).not.toBeNull();
      expect(query.tagName).toBe("INPUT");
      expect(query.getAttribute("type")).toBe("text");
      // Inside the panel, not merely somewhere on the page — a query field
      // outside it would be the in-field autocomplete this ticket removed,
      // wearing a new class.
      expect(panel.contains(query)).toBe(true);
    });

    test("§1 the query field is the next tab stop after the company-name field", () => {
      const doc = shippedDoc();
      const name = doc.querySelector(".two-company-search > input");
      const query = doc.querySelector("input.two-company-query");
      expect(name).not.toBeNull();

      // Everything focusable, in document order. The requirement is about tab
      // ORDER, and with no positive tabindex anywhere in this subtree tab order
      // IS document order — asserted below so that stays true.
      //
      // jsdom runs no Alpine, so `x-show` hides nothing here. The two
      // below-the-field affordances sit between the name input and the panel in
      // the source but are hidden in every state where the panel is open —
      // `manualModeActive` and `belowFieldManualEntryVisible` are both false
      // then, the latter by an explicit `!showDropdown()` term. Excluding them
      // is what makes this assertion about the state the requirement is about.
      const HIDDEN_WHILE_OPEN = ["manualModeActive", "belowFieldManualEntryVisible"];
      const focusables = Array.from(
        doc.querySelectorAll("a[href], button, input, select, textarea"),
      ).filter(function (el) {
        if (el.getAttribute("tabindex") === "-1") return false;
        return !HIDDEN_WHILE_OPEN.some(function (gate) {
          return el.closest('[x-show="' + gate + '"]') !== null;
        });
      });
      focusables.forEach(function (el) {
        const ti = el.getAttribute("tabindex");
        expect(ti === null || Number(ti) <= 0).toBe(true);
      });

      const nameIndex = focusables.indexOf(name);
      const queryIndex = focusables.indexOf(query);
      expect(nameIndex).toBeGreaterThanOrEqual(0);
      expect(queryIndex).toBe(nameIndex + 1);
    });

    test("§2/§4 the 'not on the list' button is the next tab stop after the query field", () => {
      const doc = shippedDoc();
      const query = doc.querySelector("input.two-company-query");
      const button = doc.querySelector("button.two-company-manual-entry-row");
      expect(button).not.toBeNull();

      const HIDDEN_WHILE_OPEN = ["manualModeActive", "belowFieldManualEntryVisible"];
      const focusables = Array.from(
        doc.querySelectorAll("a[href], button, input, select, textarea"),
      ).filter(function (el) {
        if (el.getAttribute("tabindex") === "-1") return false;
        return !HIDDEN_WHILE_OPEN.some(function (gate) {
          return el.closest('[x-show="' + gate + '"]') !== null;
        });
      });
      expect(focusables.indexOf(button)).toBe(focusables.indexOf(query) + 1);
    });

    test("§2 the scrollable results container is NOT a tab stop", () => {
      // Chrome makes a scrollable container keyboard-focusable when it has no
      // focusable children, which is exactly what this one is. The ticket
      // reports it sitting in the tab order between the query field and the
      // button.
      const doc = shippedDoc();
      const results = doc.querySelector(".two-company-search__results");
      expect(results).not.toBeNull();
      expect(results.getAttribute("tabindex")).toBe("-1");
      // And it must really be the scroller, or the attribute is on the wrong
      // element and the real one is still reachable.
      expect(results.className).toMatch(/overflow-y-auto/);
    });

    test("§2 both manual-entry affordances are real buttons, not click-handler spans", () => {
      const doc = shippedDoc();
      ["two-company-manual-entry", "two-company-manual-entry-row"].forEach(
        function (cls) {
          const el = doc.querySelector("." + cls);
          expect(el).not.toBeNull();
          expect(el.tagName).toBe("BUTTON");
          // `type="button"` inside an address form: the default is `submit`,
          // which would place the buyer's order.
          expect(el.getAttribute("type")).toBe("button");
          // Enter and Space are native on a button, so there must be no
          // hand-rolled key handlers left to disagree with the click path.
          expect(el.getAttribute("@keydown.enter.stop.prevent")).toBeNull();
          expect(el.getAttribute("@keydown.space.stop.prevent")).toBeNull();
          expect(el.getAttribute("role")).toBeNull();
          expect(el.getAttribute("tabindex")).toBeNull();
        },
      );
    });

    test("§1 the spinner sits inside the QUERY field's wrapper, not the name field's", () => {
      const doc = shippedDoc();
      const wrapper = doc.querySelector(".two-company-search__query");
      const spinner = doc.querySelector(".two-company-search__spinner");
      expect(wrapper).not.toBeNull();
      expect(spinner).not.toBeNull();
      expect(wrapper.contains(spinner)).toBe(true);
      expect(spinner.getAttribute("x-show")).toBe("isSearching");
      // The stylesheet positions it absolutely, so the wrapper has to be the
      // positioned ancestor or it lands on the company-name field instead.
      const css = require("fs").readFileSync(
        require("path").join(H.REPO_ROOT, "view/frontend/web/css/custom.css"),
        "utf8",
      );
      expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).toMatch(
        /\.two-company-search__query\s*\{[^}]*position:\s*relative/,
      );
    });

    test("§1 the company-name field is readonly in search mode, typeable in manual mode", () => {
      // Preventing keys covers the keyboard only. Paste, drag-drop and autofill
      // all write into the field without a keydown, and in search mode nothing
      // would capture what landed — the buyer would see a company name with no
      // identifier behind it and no search ever run.
      const doc = shippedDoc();
      const name = doc.querySelector(".two-company-search > input");
      expect(name.getAttribute(":readonly")).toBe("searchModeActive");
      // A hard `readonly` attribute would break manual entry, where this field
      // IS the capture control.
      expect(name.hasAttribute("readonly")).toBe(false);
      // The hint describes the query field now, so the name field must not
      // still claim it — that would announce a typing instruction on a field
      // that cannot be typed into.
      expect(name.getAttribute("aria-describedby")).toBeNull();
      expect(
        doc
          .querySelector("input.two-company-query")
          .getAttribute("aria-describedby"),
      ).toBe("two-company-search-min-chars");
    });

    test("§1 the min-characters hint is inside the panel", () => {
      // Outside it, the hint could only ever be seen in states where the panel
      // was shut — which is why the ticket reports it as appearing late.
      const doc = shippedDoc();
      const panel = doc.querySelector('[x-show="showDropdown"]');
      const hint = doc.querySelector("#two-company-search-min-chars");
      expect(hint).not.toBeNull();
      expect(panel.contains(hint)).toBe(true);
    });

    test("§1 zero results render the EXACT wording 'No matches found'", () => {
      // Exact, because Luma shipped "No results found" and the ticket counts
      // that as a failure. The string is asserted verbatim.
      const doc = shippedDoc();
      const el = doc.querySelector(".two-company-search__no-matches");
      expect(el).not.toBeNull();
      expect(el.getAttribute("x-show")).toBe("noMatchesVisible");
      // The wording is asserted against the RAW template, because the harness
      // resolves every `__()` to one placeholder string — so a rendered-markup
      // assertion could not tell "No matches found" from any other copy in the
      // file, and would pass whatever the wording drifted to.
      // Comments stripped first: this template's own prose names the wrong
      // wording in order to warn against it, and a raw grep would read that as
      // the defect it is guarding.
      const source = require("fs")
        .readFileSync(
          require("path").join(H.REPO_ROOT, H.COMPANY_NAME_MARKUP_TEMPLATE),
          "utf8",
        )
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/<!--[\s\S]*?-->/g, "");
      expect(source).toContain("__('No matches found')");
      expect(source).not.toContain("No results found");
      expect(doc.querySelector('[x-show="showDropdown"]').contains(el)).toBe(
        true,
      );
    });

    test("§1 the debounce is 300ms and it is on the QUERY field", () => {
      const doc = shippedDoc();
      const query = doc.querySelector("input.two-company-query");
      expect(query.getAttribute("@input.debounce.300ms")).toBe("getItems");
      expect(query.getAttribute("@input")).toBe("noteCompanyQuery");

      // And the company-name field must no longer carry a search handler of
      // any kind, or typing into it would still search.
      const name = doc.querySelector(".two-company-search > input");
      expect(name.getAttribute("@input.debounce.500ms")).toBeNull();
      expect(name.getAttribute("@input")).toBeNull();
      expect(name.getAttribute("@click")).toBe("onCompanyNameClick");
      expect(name.getAttribute("@keydown")).toBe("onCompanyNameKeydown");
    });

    test("every handler the markup binds actually exists on the component", () => {
      // A binding that resolves to nothing is this repo's recurring failure
      // mode — CSP-friendly Alpine looks the whole attribute string up as a key
      // and no-ops silently when it is absent, so the page shows no error at
      // all. Sweep every Alpine binding in the subtree against a real instance.
      const env = H.installHyvaEnvironment();
      try {
        H.loadSharedHelpers();
        H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
        env.fireAlpineInit();
        const component = H.mountComponent(env.alpineComponents[COMPONENT_NAME]);

        const doc = shippedDoc();
        const root = doc.querySelector(".two-company-search");
        const elements = [root].concat(Array.from(root.querySelectorAll("*")));
        const missing = [];
        elements.forEach(function (el) {
          Array.from(el.attributes || []).forEach(function (attr) {
            const isBinding =
              attr.name.charAt(0) === "@" ||
              attr.name.charAt(0) === ":" ||
              attr.name === "x-show" ||
              attr.name === "x-text";
            if (!isBinding) return;
            const expression = attr.value;
            // Bare property names only; `x-for`/`x-html` scope vars and the
            // `item.*` paths are resolved per-row by Alpine, not off the
            // component.
            if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expression)) return;
            if (!(expression in component)) {
              missing.push(el.tagName + "[" + attr.name + "=" + expression + "]");
            }
          });
        });
        expect(missing).toEqual([]);
      } finally {
        env.restore();
      }
    });
  });

  describe("behaviour, driven against the shipped markup", () => {
    let env;
    let fetchStub;
    let component;
    let nameField;
    let queryField;
    let root;
    let nextControl;

    beforeEach(() => {
      const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
      document.body.innerHTML =
        '<div id="address-container"><div><div><div>' +
        markup +
        "</div></div></div>" +
        '<input type="text" id="next-control" />' +
        "</div>";

      env = H.installHyvaEnvironment();
      fetchStub = H.stubFetch();
      jest.spyOn(console, "error").mockImplementation(() => {});

      H.loadSharedHelpers();
      H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
      env.fireAlpineInit();

      root = document.querySelector(".two-company-search");
      nameField = document.querySelector(".two-company-search > input");
      queryField = document.querySelector("input.two-company-query");
      nextControl = document.getElementById("next-control");

      component = H.mountComponent(env.alpineComponents[COMPONENT_NAME], {
        el: nameField,
        root: root,
      });
      component.init();
    });

    afterEach(() => {
      fetchStub.restore();
      env.restore();
      document.body.innerHTML = "";
    });

    /** A keydown event object shaped the way the handler reads it. */
    function key(name, extra) {
      const event = Object.assign(
        {
          key: name,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          prevented: false,
        },
        extra || {},
      );
      event.preventDefault = function () {
        event.prevented = true;
      };
      return event;
    }

    test("§1 focus alone does NOT open the panel", () => {
      // Explicit in the ticket: "merely moving focus into it does not open the
      // dropdown - only clicking or typing". Nothing binds `@focus`, and that
      // absence is the whole guarantee, so assert it directly.
      expect(nameField.getAttribute("@focus")).toBeNull();
      nameField.focus();
      expect(component.isOpen).toBe(false);
    });

    test("§1 clicking the company-name field opens the panel and focuses the query field", () => {
      component.onCompanyNameClick();

      expect(component.isOpen).toBe(true);
      expect(component.showDropdown()).toBe(true);
      // Focus is asserted against the real document, not against the fact that
      // `.focus()` was called — `.focus()` on a non-rendered element silently
      // no-ops, which is the assumption that produced two false "fixed" claims
      // on this ticket already.
      expect(document.activeElement).toBe(queryField);
    });

    test("§1 typing a character opens the panel, seeds the query and leaves the NAME field untouched", () => {
      nameField.value = "";
      const event = key("a");

      component.onCompanyNameKeydown(event);

      expect(event.prevented).toBe(true);
      expect(component.isOpen).toBe(true);
      expect(queryField.value).toBe("a");
      expect(component.query).toBe("a");
      // The requirement the old architecture could not meet: the company-name
      // field is not a search box any more and must not change until a result
      // is selected.
      expect(nameField.value).toBe("");
      expect(document.activeElement).toBe(queryField);
    });

    test("§1/§4 Tab on the company-name field neither opens the panel nor is swallowed", () => {
      const event = key("Tab");

      component.onCompanyNameKeydown(event);

      expect(component.isOpen).toBe(false);
      // Not prevented: the browser's own Tab has to run, or the field is a trap.
      expect(event.prevented).toBe(false);
    });

    test("§4 Enter on the company-name field still reaches the form", () => {
      // The field is inside an address form. Swallowing Enter here would break
      // submit-by-keyboard for a buyer who never opens the panel at all.
      const event = key("Enter");

      component.onCompanyNameKeydown(event);

      expect(event.prevented).toBe(false);
      expect(component.isOpen).toBe(false);
    });

    test("§1 the min-characters hint shows immediately on open, before any typing", () => {
      // The reported Hyvä failure: the wording appeared only once the buyer had
      // typed at least one letter, so clicking in produced an empty panel.
      component.onCompanyNameClick();

      expect(component.query).toBe("");
      expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(true);
    });

    test("§1 Escape closes the panel and returns focus to the company-name field", () => {
      component.onCompanyNameClick();
      expect(document.activeElement).toBe(queryField);

      component.onQueryEscape();

      expect(component.isOpen).toBe(false);
      expect(component.showDropdown()).toBe(false);
      expect(document.activeElement).toBe(nameField);
    });

    test("§1/§4 Tab off 'not on the list' closes the panel AND lands on the next real control", () => {
      // Both halves, together. Closing alone leaves focus on `<body>` (the
      // WooCommerce defect); moving focus alone leaves the panel open over the
      // rest of the form (the reported Hyvä defect). The panel must genuinely
      // be shut and focus must genuinely be on the next control.
      component.onCompanyNameClick();
      const event = key("Tab");

      component.onManualEntryTab(event);

      expect(event.prevented).toBe(true);
      expect(component.isOpen).toBe(false);
      expect(document.activeElement).toBe(nextControl);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("§4 Shift+Tab off 'not on the list' goes back into the panel, which stays open", () => {
      component.onCompanyNameClick();
      const event = key("Tab", { shiftKey: true });

      component.onManualEntryTab(event);

      // Left to the browser: the query field is the natural previous stop, and
      // closing would make the forward shortcut a one-way door.
      expect(event.prevented).toBe(false);
      expect(component.isOpen).toBe(true);
    });

    test("§4 Shift+Tab out of the query field closes the panel and returns to company-name", () => {
      component.onCompanyNameClick();
      const event = key("Tab", { shiftKey: true });

      component.onQueryTab(event);

      expect(event.prevented).toBe(true);
      expect(component.isOpen).toBe(false);
      expect(document.activeElement).toBe(nameField);
    });

    test("§4 plain Tab out of the query field is left to the browser, panel open", () => {
      // The §4 shortcut: the next focusable in document order IS the "not on
      // the list" button, so nothing needs to intervene.
      component.onCompanyNameClick();
      const event = key("Tab");

      component.onQueryTab(event);

      expect(event.prevented).toBe(false);
      expect(component.isOpen).toBe(true);
    });

    test("nextFocusableAfterComponent skips controls hidden the way x-show hides them", () => {
      // Guards the resolver Tab-out depends on. Alpine writes an inline
      // `display: none`; a hidden control is not a tab stop, and landing focus
      // on one is indistinguishable from landing on `<body>`.
      nextControl.style.display = "none";
      const later = document.createElement("input");
      later.id = "later-control";
      document.getElementById("address-container").appendChild(later);

      expect(component.nextFocusableAfterComponent()).toBe(later);
    });

    test("§4 Tab-out skips a control hidden by CLASS, not just by inline style", () => {
      // Review round 1. This codebase hides things with a Tailwind `.hidden`
      // class at least twice on the payment tile (`companyIdHiddenClass`,
      // `companyNumberBlockHiddenClass`). An inline-style-only visibility check
      // would hand back an invisible element, focusAndVerify() would fail
      // silently, and focus would fall to `<body>` — the exact WooCommerce
      // defect this resolver exists to prevent.
      nextControl.classList.add("hidden");
      // jsdom applies no stylesheet, so `.hidden` has no computed effect here;
      // the resolver has to recognise the class itself, which is the point.
      const later = document.createElement("input");
      later.id = "later-control";
      document.getElementById("address-container").appendChild(later);

      expect(component.nextFocusableAfterComponent()).toBe(later);
    });

    test("§4 Tab-out skips a control hidden by the `hidden` attribute", () => {
      nextControl.hidden = true;
      const later = document.createElement("input");
      document.getElementById("address-container").appendChild(later);

      expect(component.nextFocusableAfterComponent()).toBe(later);
    });

    test("§4 Tab off the button falls back to company-name when nothing follows", () => {
      // Review round 1: the no-next-focusable branch used to skip
      // preventDefault() and let the native Tab run. That does not help —
      // Alpine's reactive flush drains on the microtask queue, before the
      // browser performs the default action, so the focused button is already
      // hidden when the next stop is computed and focus lands on `<body>`.
      document.getElementById("address-container").removeChild(nextControl);
      component.onCompanyNameClick();
      const event = key("Tab");

      component.onManualEntryTab(event);

      expect(event.prevented).toBe(true);
      expect(component.isOpen).toBe(false);
      expect(document.activeElement).toBe(nameField);
      expect(document.activeElement).not.toBe(document.body);
    });

    test("§4 Tab-out walks past a candidate that refuses focus", () => {
      // `.focus()` failing silently is the whole failure class this ticket
      // keeps hitting, so the resolver returns a LIST and the caller walks it.
      // A disabled-by-JS-only control models a candidate no attribute check
      // catches.
      const later = document.createElement("input");
      document.getElementById("address-container").appendChild(later);
      Object.defineProperty(nextControl, "focus", {
        value: function () {},
        configurable: true,
      });

      component.onCompanyNameClick();
      component.onManualEntryTab(key("Tab"));

      expect(document.activeElement).toBe(later);
    });

    test("§5 manual entry announces the pair, so an already-mounted tile updates", () => {
      // Review round 1. Deleting the address step's editable number input took
      // `onCompanyIdInput()` — the only dispatcher on the manual path — out of
      // the DOM with it, so manual entry wrote localStorage and announced
      // nothing. A payment tile that is already mounted syncs from this event,
      // not from storage, and so kept the previous company.
      const heard = [];
      const listener = function (e) {
        heard.push(e.detail);
      };
      window.addEventListener("shipping-company-selected", listener);
      try {
        component.enterManually();
        nameField.value = "Widgets Inc";
        component.$el = nameField;
        component.onNameFieldInput();

        expect(heard).toHaveLength(1);
        expect(heard[0].company_name).toBe("Widgets Inc");
      } finally {
        window.removeEventListener("shipping-company-selected", listener);
      }
    });

    test("§1 a pick blanks the query field's DOM value, not just the state", () => {
      // Otherwise any getItems() that runs before a close re-searches the term
      // the buyer abandoned when they picked.
      queryField.value = "acm";
      component.query = "acm";

      component.selectItem({ companyName: "Acme Ltd", companyId: "111" });

      expect(component.query).toBe("");
      expect(queryField.value).toBe("");
    });

    test("focusAndVerify reports FALSE when the element cannot take focus", () => {
      // The one behaviour every silent-no-op bug on this ticket needed and
      // none of them had.
      // A plain <div> with no tabindex cannot take focus. Deliberately not a
      // `display: none` input: jsdom does not model visibility for focus, so
      // that would pass here for a reason the browser does not share.
      const unfocusable = document.createElement("div");
      document.body.appendChild(unfocusable);

      expect(component.focusAndVerify(unfocusable)).toBe(false);
      expect(component.focusAndVerify(null)).toBe(false);
      expect(component.focusAndVerify(nextControl)).toBe(true);
    });

    test("§1 Space opens the panel but is NOT seeded into the query", () => {
      const event = key(" ");

      component.onCompanyNameKeydown(event);

      expect(component.isOpen).toBe(true);
      // A query beginning with a space is never what the buyer meant; Space is
      // the conventional "open the combobox" key in this position.
      expect(queryField.value).toBe("");
      expect(component.query).toBe("");
    });

    test("§5 the company-number label does not survive into manual entry", () => {
      // enterManually() deliberately does not clear a previous pick, and the
      // stale-pair clear only fires once the typed name has diverged — so a
      // buyer who picked a company and then chose "not on the list" kept a
      // registry-vouched number, and the label went on showing it. §5 requires
      // manual entry to show no number at all.
      component.companyId = "123456789";
      component.companyIdSource = "registry";
      component.companyName = "Acme Ltd";
      expect(component.companyIdDisplayVisible).toBe(true);

      component.enterManually();

      expect(component.manualMode).toBe(true);
      expect(component.companyIdDisplayVisible).toBe(false);
    });

    test("§2 activating 'not on the list' places focus in the company-name field", () => {
      component.onCompanyNameClick();

      component.enterManually();

      expect(component.manualMode).toBe(true);
      expect(component.isOpen).toBe(false);
      expect(document.activeElement).toBe(nameField);
    });

    test("§3 'Search for company' reopens the panel and focuses the QUERY field", () => {
      component.enterManually();
      expect(component.manualMode).toBe(true);

      component.enableSearch();

      expect(component.manualMode).toBe(false);
      expect(component.isOpen).toBe(true);
      expect(document.activeElement).toBe(queryField);
    });

    describe("§1 searching, and what the panel says while it happens", () => {
      /**
       * Type into the query field and run the search the debounced handler
       * would run, leaving the request in flight.
       *
       * @param {string} term
       * @returns {Promise<Promise>} the pending getItems() promise
       */
      async function search(term) {
        queryField.value = term;
        component.$el = queryField;
        component.noteCompanyQuery();
        component.$el = nameField;
        const pending = component.getItems();
        await H.flushPromises();
        // Wrapped, never returned bare: an async function RETURNING a promise
        // adopts it, so the caller would block on a request it has not settled
        // yet — the whole suite would just time out. The harness's own doc
        // comment flags this trap on its equivalent helper.
        return { pending: pending };
      }

      test("the term on the wire is the QUERY field's text, not the company-name field's", () => {
        // The bug the split exists to prevent: with one shared value, the
        // company name a buyer had already chosen was overwritten by, or
        // searched instead of, whatever was typed next.
        nameField.value = "Previously Chosen Ltd";
        return search("acm").then(function () {
          expect(fetchStub.calls).toHaveLength(1);
          expect(fetchStub.calls[0].url).toMatch(/acm/);
          expect(fetchStub.calls[0].url).not.toMatch(/Previously/);
          expect(nameField.value).toBe("Previously Chosen Ltd");
        });
      });

      test("the spinner is up while the request is in flight and down after it", async () => {
        const { pending } = await search("acm");
        expect(component.isSearching).toBe(true);

        fetchStub.calls[0].respond({ items: [] });
        await pending;

        expect(component.isSearching).toBe(false);
      });

      test("'No matches found' does NOT show while the search is still on the wire", async () => {
        const { pending } = await search("acm");

        // In flight: no verdict yet, so claiming there are no matches would be
        // a lie the buyer acts on.
        expect(component.noMatchesVisible).toBe(false);

        fetchStub.calls[0].respond({ items: [] });
        await pending;

        expect(component.noMatchesVisible).toBe(true);
      });

      test("'No matches found' does not show for a FAILED search", async () => {
        const { pending } = await search("acm");
        fetchStub.calls[0].respond({}, 500);
        await pending;

        expect(component.isSearchUnavailable).toBe(true);
        // A failure is not a verdict on whether the company exists.
        expect(component.noMatchesVisible).toBe(false);
      });

      test("'No matches found' comes down again the moment the buyer types on", async () => {
        const { pending } = await search("acm");
        fetchStub.calls[0].respond({ items: [] });
        await pending;
        expect(component.noMatchesVisible).toBe(true);

        queryField.value = "acme";
        component.$el = queryField;
        component.noteCompanyQuery();
        component.$el = nameField;

        // The verdict belonged to the previous term.
        expect(component.noMatchesVisible).toBe(false);
      });

      test("a non-empty result set leaves no 'no matches' message", async () => {
        const { pending } = await search("acm");
        fetchStub.calls[0].respond({
          items: [
            {
              name: "Acme Ltd",
              highlight: "<em>Acme</em> Ltd",
              national_identifier: { id: "123456789" },
            },
          ],
        });
        await pending;

        expect(component.items).toHaveLength(1);
        expect(component.noMatchesVisible).toBe(false);
      });

      test("selecting a result fills the NAME field, closes the panel and clears the query", async () => {
        const { pending } = await search("acm");
        fetchStub.calls[0].respond({
          items: [
            {
              name: "Acme Ltd",
              highlight: "<em>Acme</em> Ltd",
              national_identifier: { id: "123456789" },
            },
          ],
        });
        await pending;

        component.selectItem(component.items[0]);

        expect(nameField.value).toBe("Acme Ltd");
        expect(component.isOpen).toBe(false);
        expect(component.query).toBe("");
        expect(component.companyId).toBe("123456789");
        expect(component.companyIdSource).toBe("registry");
        // §5: the number is displayed, read-only, only for a registry-supplied
        // identifier.
        expect(component.companyIdDisplayVisible).toBe(true);
        expect(document.activeElement).toBe(nameField);
      });

      test("a query below the threshold puts nothing on the wire and shows the hint", async () => {
        await search("ac");

        expect(fetchStub.calls).toHaveLength(0);
        expect(component.twoGatewayHyvaShouldShowMinCharsMessage()).toBe(true);
        expect(component.noMatchesVisible).toBe(false);
        expect(component.isSearching).toBe(false);
      });
    });
  });
});
