/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25326, 2026-08-05 ruling: there is EXACTLY ONE company-search control
 * implementation, and it is reused at every point it is mounted.
 *
 * Before this, the payment tile carried a second control of its own alongside the
 * address step's. Three bugs were reported against the tile as if they were
 * independent defects:
 *
 *   1. the control rendered wider than the tile that hosts it, and only in the
 *      configuration that puts the control in the tile;
 *   2. "My company is not on the list" painted immediately below the company
 *      field before the buyer had touched anything, reading as a permanent link
 *      rather than a dropdown affordance;
 *   3. a faint border framed the company-name field and the Company Number label
 *      together.
 *
 * All three were consequences of the duplication. This file is the guard against
 * the duplication coming back — which no behavioural test can be, because two
 * implementations that happen to agree today pass every behavioural assertion
 * and then drift.
 *
 * It reads the SHIPPED templates. The strongest assertion here is that the
 * control subtree the two mount points render is byte-identical: that can only be
 * true while both are rendering the same file.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

const CONTROL_TEMPLATE = "view/frontend/templates/form/field/company-search-control.phtml";

/**
 * @param {string} relPath
 * @returns {string}
 */
function source(relPath) {
  return fs.readFileSync(path.join(H.REPO_ROOT, relPath), "utf8");
}

/**
 * @param {string} relPath
 * @returns {Document}
 */
function render(relPath) {
  return new DOMParser().parseFromString(
    H.renderTemplateMarkup(relPath),
    "text/html",
  );
}

/**
 * Collapse whitespace so an indentation difference between the two include
 * sites is not read as a difference in the control.
 *
 * @param {string} html
 * @returns {string}
 */
function normalise(html) {
  return html.replace(/\s+/g, " ").trim();
}

describe("one company-search control (bug 6)", () => {
  const tile = H.GATEWAY_METHOD_MARKUP_TEMPLATE;
  const address = H.COMPANY_NAME_MARKUP_TEMPLATE;

  test("both mount points include the same control template", () => {
    const include = "Two_GatewayHyva::form/field/company-search-control.phtml";

    expect(source(tile)).toContain(include);
    expect(source(address)).toContain(include);
    expect(fs.existsSync(path.join(H.REPO_ROOT, CONTROL_TEMPLATE))).toBe(true);
  });

  test("the control subtree they render is byte-identical", () => {
    const fromTile = render(tile).querySelector(".two-company-search-group");
    const fromAddress = render(address).querySelector(".two-company-search-group");

    expect(fromTile).not.toBeNull();
    expect(fromAddress).not.toBeNull();
    expect(normalise(fromTile.outerHTML)).toBe(normalise(fromAddress.outerHTML));
  });

  test("each mount point supplies the Alpine scope its surface needs", () => {
    // The harness substitutes ONE value for `$twoControlAlpineData`, so the
    // rendered markup cannot tell the two apart — this is the only place the
    // difference is checkable, and it matters: the address step needs its own
    // `x-data`, while the tile must have NONE so the control's state lands on
    // the payment form's component beside the tile label and the order-intent
    // dispatch. A stray `x-data` in the tile would give the control a private
    // copy of `companyName`/`companyId` that the label never sees.
    expect(source(tile)).toContain("$twoControlAlpineData = '';");
    expect(source(address)).toContain(
      "$twoControlAlpineData = 'x-data=\"' . $escaper->escapeHtmlAttr($gwBase . 'CompanySearchField') . '\"';",
    );
  });

  test("neither mount point renders a control of its own alongside it", () => {
    [tile, address].forEach(function (relPath) {
      expect(render(relPath).querySelectorAll(".two-company-search").length).toBe(1);
    });
  });

  test.each([
    [".two-company-search__panel", "the popover shell"],
    [".two-company-query", "the query field"],
    [".two-company-search__results", "the results list"],
    [".company-results", "the tile's own results container"],
    [".two-mode-chips", "the chip row that sat outside the popover"],
  ])("%s is not server-rendered here (%s)", (selector) => {
    // TWO-25503: the popover is the base plugin's, built at runtime. Markup for
    // it in this repo is a second implementation, which is what drifted.
    [tile, address].forEach(function (relPath) {
      expect(render(relPath).querySelectorAll(selector).length).toBe(0);
    });
  });

  test("the tile's own manual/search dual-input pair is gone", () => {
    const doc = render(tile);
    const raw = source(tile);

    // One company-name input and one company-number input. The mirror pair
    // submitted as `payment[manual_*]` and swapped its `:id`/`:name` bindings
    // with its twin — eight getters resolving which copy was canonical.
    expect(doc.querySelectorAll('input[name="payment[company_name]"]').length).toBe(1);
    expect(doc.querySelectorAll('input[name="payment[company_id]"]').length).toBe(1);
    expect(raw).not.toContain("manual_company_name");
    expect(raw).not.toContain("manual_company_id");
  });

  test("the tile's own search-control JS is gone from the component", () => {
    const raw = source(H.GATEWAY_METHOD_TEMPLATE);

    // Each of these was a tile-local copy of something the shared control now
    // owns. Named individually rather than as a count so a reintroduction says
    // which one came back.
    [
      "OnCompanySearchClickOutside",
      "OnCompanySearchFocus",
      "OnCompanySearchBlur",
      "ForgetCompanyIfNameDiverged",
      "manualEntryLinkVisible",
      "companySearchBlockVisible",
      "GetCompanyNameId",
      "GetManualCompanyNameField",
      "GetCompanyIdFieldName",
      "GetManualCompanyIdFieldId",
    ].forEach(function (name) {
      expect(raw.indexOf(name + "(")).toBe(-1);
    });
  });
});

describe("the manual-entry affordance lives only in the popover (bug 2)", () => {
  let env;
  let fetchStub;
  let component;

  beforeEach(() => {
    document.body.innerHTML = [
      '<div class="two-company-search" id="control-root">',
      '  <input type="text" id="company-field" value="" />',
      "</div>",
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();

    H.loadSharedHelpers();
    H.loadTemplate(H.COMPANY_NAME_TEMPLATE);
    env.fireAlpineInit();

    component = H.mountComponent(
      env.alpineComponents.twoGatewayHyvaCompanySearchField,
      {
        el: document.getElementById("company-field"),
        root: document.getElementById("control-root"),
      },
    );
    component.init();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    document.body.innerHTML = "";
  });

  test("there is exactly one manual-entry affordance, and the panel owns it", () => {
    const chips = component.companyPopoverChips();
    const manual = chips.filter((chip) => chip.mode === "manual");

    expect(manual).toHaveLength(1);
    // Reaching the panel through its options is the whole assertion: chips it
    // is handed render inside it, which is what the deleted row was not.
    expect(env.companyPanels).toHaveLength(1);
    expect(env.companyPanels[0].options.getChips().map((chip) => chip.mode))
      .toEqual(chips.map((chip) => chip.mode));
  });

  test("no mount point renders a manual-entry affordance of its own", () => {
    [H.GATEWAY_METHOD_MARKUP_TEMPLATE, H.COMPANY_NAME_MARKUP_TEMPLATE].forEach(
      function (relPath) {
        expect(
          render(relPath).querySelectorAll(".two-company-manual-entry-row").length,
        ).toBe(0);
      },
    );
  });

  test("the affordance is on offer before anything is typed", () => {
    // The old below-field link was justified by the in-panel row being
    // unreachable below the minimum query length. Nothing the adapter offers
    // has a length term, so the chip is on offer from zero characters.
    expect(component.search).toBeFalsy();

    expect(component.companyPopoverModeOffered("manual")).toBe(true);
    expect(
      component.companyPopoverChips().map((chip) => chip.mode),
    ).toContain("manual");
  });

  test("the below-the-field copy and its gate are gone", () => {
    [H.GATEWAY_METHOD_MARKUP_TEMPLATE, H.COMPANY_NAME_MARKUP_TEMPLATE].forEach(
      function (relPath) {
        const doc = render(relPath);
        // The class the below-field button carried. It was gated on the panel
        // being SHUT, which is the state a freshly rendered checkout is in — so
        // it painted before any interaction, which is the bug.
        expect(doc.querySelectorAll(".two-company-manual-entry").length).toBe(0);
      },
    );

    expect(source(H.COMPANY_NAME_TEMPLATE)).not.toContain(
      "belowFieldManualEntryVisible",
    );
    expect(source(H.GATEWAY_METHOD_TEMPLATE)).not.toContain(
      "belowFieldManualEntryVisible",
    );
  });

});

describe("the control is not an input-group (bug 3)", () => {
  test("no mount point emits the class", () => {
    [H.GATEWAY_METHOD_MARKUP_TEMPLATE, H.COMPANY_NAME_MARKUP_TEMPLATE].forEach(
      function (relPath) {
        const doc = render(relPath);
        // Hyvä's shared styling treats `.input-group` as ONE control with an
        // addon and paints a container border on it — permanently, not only on
        // focus. This control is a name input, a results panel and a number
        // display: three separately labelled things.
        expect(doc.querySelectorAll(".input-group").length).toBe(0);
      },
    );
  });

  test("the focus-ring suppression matches the hook the control does emit", () => {
    const css = source("view/frontend/web/css/custom.css");
    const doc = render(H.COMPANY_NAME_MARKUP_TEMPLATE);

    expect(
      doc.querySelectorAll(".two-company-search-group").length,
    ).toBeGreaterThan(0);
    // Doubled for specificity: (0,2,0), so a merchant theme rule matching two
    // classes cannot win on stylesheet load order — which this module does not
    // control.
    expect(css).toContain(
      ".two-company-search-group.two-company-search-group:focus-within",
    );
    // The old selector required `.input-group`, which is no longer emitted, so
    // leaving it would be a rule that can never match.
    expect(css).not.toContain(".input-group.two-company-search-group");
  });
});

describe("the control cannot outgrow its column (bug 1)", () => {
  test("the wrapper claims its column's width and refuses its intrinsic minimum", () => {
    const doc = render(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
    const group = doc.querySelector(".two-company-search-group");
    const classes = (group.getAttribute("class") || "").split(/\s+/);

    // `min-w-0` is the load-bearing half: without it a flex/grid child is sized
    // to its content's intrinsic minimum, which is how this control ended up
    // wider than the tile hosting it. `w-full` is what makes it claim exactly
    // the column rather than an undefined natural width.
    expect(classes).toContain("w-full");
    expect(classes).toContain("min-w-0");
  });

  test("the tile's include site is likewise bounded", () => {
    const doc = render(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
    const group = doc.querySelector(".two-company-search-group");
    const host = group.parentElement;
    const classes = (host.getAttribute("class") || "").split(/\s+/);

    expect(classes).toContain("w-full");
    expect(classes).toContain("min-w-0");
  });

  test("the tile root is bounded too, and the deep nested stack is gone", () => {
    const doc = render(H.GATEWAY_METHOD_MARKUP_TEMPLATE);
    const root = doc.querySelector(".payment-method-custom-form");
    const classes = (root.getAttribute("class") || "").split(/\s+/);

    expect(classes).toContain("w-full");
    expect(classes).toContain("min-w-0");
    // `min-h-108` is not a Tailwind class at all — it never resolved to
    // anything, and it wrapped the whole of the tile's old control.
    expect(source(H.GATEWAY_METHOD_MARKUP_TEMPLATE)).not.toContain("min-h-108");
  });
});
