/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288, TWO-25503. Search feedback, on BOTH surfaces that search.
 *
 * The original defect: the shipping-address field carried `isSearching` in
 * component state, drove it correctly on every exit path, and bound it to
 * nothing — so that form searched with no feedback whatsoever.
 *
 * The indicator itself is no longer this module's markup. The shared popover
 * (`Two_Gateway/js/model/company-search-panel.js`) renders and gates its own,
 * off the promise `searchCompanies()` returns, so what this repo can still be
 * wrong about is whether either surface hands the panel a promise that spans
 * the request at all. A `searchCompanies()` that settled before its fetch did
 * would reproduce the original defect exactly — a search running with the
 * indicator already down — and no other suite in this directory looks at it.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

/** The one stylesheet the Hyva checkout loads for this module. */
const STYLESHEET = "view/frontend/web/css/custom.css";

const POSITION_CLASS = "two-company-search__spinner";
const LEGACY_HOOK_CLASS = "two-term-chip__loading";

/**
 * The two surfaces that run a company search, each with the `-csp-js` template
 * defining its component, that component's registered Alpine name, the entry
 * point Magewire re-runs, and the fixture it resolves against.
 *
 * The tile's fixture is its own SHIPPED markup: on that surface the control has
 * no `x-data`, so its state lands on the payment form's component, and a
 * hand-built stand-in would not prove the two resolve to each other. The
 * harness substitutes one value for `$twoControlAlpineData` at both mount
 * points, so the address step's `x-data` has to be stripped back out.
 */
const SURFACES = [
  {
    label: "payment tile",
    js: H.GATEWAY_METHOD_TEMPLATE,
    component: "twoGatewayHyvaPaymentMethodBase",
    fixture: function () {
      return [
        '<input id="shipping-country_id" value="GB" />',
        H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE).replace(
          /x-data="twoGatewayHyvaCompanySearchField"/,
          "",
        ),
      ].join("\n");
    },
    start: function (component) {
      component.$watch = function () {};
      component.initialize(JSON.parse(H.QUOTE_JSON));
    },
    rootId: "two_payment_form",
  },
  {
    label: "shipping-address field",
    js: H.COMPANY_NAME_TEMPLATE,
    component: "twoGatewayHyvaCompanySearchField",
    fixture: function () {
      return [
        '<input id="shipping-country_id" value="GB" />',
        '<div id="control-root" class="two-company-search">',
        '  <input type="text" id="company-field" value="" />',
        "</div>",
      ].join("\n");
    },
    start: function (component) {
      component.init();
    },
    rootId: "control-root",
  },
];

describe.each(SURFACES)("search feedback — $label", (surface) => {
  let env;
  let fetchStub;
  let panel;

  beforeEach(() => {
    document.body.innerHTML = surface.fixture();

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers();
    H.loadTemplate(surface.js);
    env.fireAlpineInit();

    const root = document.getElementById(surface.rootId);
    const component = H.mountComponent(env.alpineComponents[surface.component], {
      el: root,
      root: root,
    });
    surface.start(component);

    expect(env.companyPanels).toHaveLength(1);
    panel = env.companyPanels[0];
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    document.body.innerHTML = "";
  });

  test("the panel is given something to gate its indicator on", () => {
    expect(typeof panel.options.search.searchCompanies).toBe("function");
    expect(typeof panel.options.search.abortActiveRequest).toBe("function");
  });

  test("the promise it returns spans the request rather than settling first", async () => {
    let settled = false;
    const pending = panel.options.search
      .searchCompanies({ term: "example trading" })
      .then(function (result) {
        settled = true;
        return result;
      });

    await H.flushPromises();

    // A request is on the wire and nothing has come back: the indicator is up
    // for exactly this window, so resolving here is the original defect.
    expect(fetchStub.calls.length).toBe(1);
    expect(settled).toBe(false);

    fetchStub.last().respond({ items: [] });
    await pending;

    expect(settled).toBe(true);
  });
});

/**
 * The GIF rule itself, which this module still ships and still paints with —
 * the order-intent progress row carries the class now that the search spinner
 * is the panel's. The element is childless, so the image and the box it is
 * painted into come from here and nowhere else.
 *
 * The motion comes from the GIF, which is why nothing here asserts a CSS
 * animation. A CSS rule cannot pause, slow or step a GIF, so there is
 * deliberately no reduced-motion rule to assert either.
 *
 * Where it can, this reads the real declarations back through jsdom's cascade
 * rather than regex-matching the file, so a rule that parses differently from
 * how it reads fails. jsdom resolves `background-image`, `background-repeat` and
 * `background-size`; it does NOT resolve the multi-value `background-position`
 * shorthand, so that one is not asserted.
 */
describe("the GIF spinner rule", () => {
  /** @returns {string} the shipped stylesheet, verbatim */
  function stylesheetText() {
    return fs.readFileSync(path.join(H.REPO_ROOT, STYLESHEET), "utf8");
  }

  /**
   * The stylesheet with its comments stripped.
   *
   * Load-bearing: the rules below forbid constructs the comments explaining
   * those very rules necessarily name, so matching against the raw file makes
   * every one of them a guaranteed false positive.
   *
   * @returns {string}
   */
  function declarations() {
    return stylesheetText().replace(/\/\*[\s\S]*?\*\//g, "");
  }

  /** @returns {string} */
  function spinnerRule() {
    const match = declarations().match(
      /\.two-company-search__spinner\s*\{([\s\S]*?)\}/,
    );
    if (match === null) {
      throw new Error("no .two-company-search__spinner rule in " + STYLESHEET);
    }
    return match[1];
  }

  /**
   * The spinner's computed style, with the real shipped stylesheet applied to a
   * node carrying the spinner class.
   *
   * @returns {CSSStyleDeclaration}
   */
  function computedSpinnerStyle() {
    const style = document.createElement("style");
    style.textContent = stylesheetText();
    document.head.appendChild(style);

    const el = document.createElement("span");
    el.className = POSITION_CLASS + " " + LEGACY_HOOK_CLASS;
    document.body.appendChild(el);

    return getComputedStyle(el);
  }

  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  test("paints itself with the loading GIF as a background image", () => {
    const computed = computedSpinnerStyle();

    // Read through the cascade, so a declaration jsdom cannot parse fails here
    // even though it is present in the file.
    expect(computed.backgroundImage).toMatch(/loader\.gif/);
    expect(computed.backgroundRepeat).toBe("no-repeat");
    expect(computed.backgroundSize).toBe("16px 16px");
  });

  test("references an asset that actually exists on disk", () => {
    const match = spinnerRule().match(
      /background-image:\s*url\(\s*["']?([^"')]+)["']?\s*\)/,
    );
    if (match === null) {
      throw new Error("no background-image url() in the spinner rule");
    }
    const url = match[1];

    // A URL in a stylesheet resolves against the stylesheet's own location, so
    // that is what the on-disk check has to resolve against too. Without this,
    // a correct-looking URL pointing at a file that was never committed passes.
    const resolved = path.resolve(
      path.dirname(path.join(H.REPO_ROOT, STYLESHEET)),
      url,
    );

    expect(fs.existsSync(resolved)).toBe(true);
  });

  test("keeps the selector a single flat class, with no !important", () => {
    const css = declarations();

    // The element carries a second, shared class. A compound selector or a
    // descendant chain here would out-specify any flat single-class rule
    // targeting that shared class, and break it with nothing else failing.
    expect(css).not.toMatch(/\.two-company-search__spinner\s*\./);
    expect(css).not.toMatch(/\.\S+\s+\.two-company-search__spinner/);
    expect(spinnerRule()).not.toMatch(/!important/);
  });
});
