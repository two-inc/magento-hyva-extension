/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288. The company-search spinner, on BOTH surfaces that search.
 *
 * The spinner is an animated GIF applied by the stylesheet as a background image
 * on one childless element, so what the templates have to get right is a very
 * small set of things that are all invisible to every other suite:
 *
 *  - it exists at all. The shipping-address field carried `isSearching` in
 *    component state, driven correctly on every exit path, and bound it to
 *    nothing — so that form searched with no feedback whatsoever. A state
 *    property bound to nothing has no user-visible effect, which is why the
 *    binding is read out of the shipped markup here rather than assumed.
 *  - it keeps BOTH classes, spelled exactly. The positioning class carries
 *    position, size and the background image. The chip-loading class paints
 *    nothing here — it is the shared loading hook this markup has always
 *    carried, kept for merchant and brand overlays that style it. Drop either
 *    and nothing else in CI notices.
 *  - it has NO children. The old markup carried three dot spans. Leaving them in
 *    would paint three stray dots on top of the GIF.
 *  - it stays `aria-hidden`. It is decorative; the search result is what gets
 *    announced.
 *
 * Assertions are made against the rendered shipped templates, not against a
 * fixture copy of the markup, so a template edit is what makes them fail.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

/** The one stylesheet the Hyva checkout loads for this module. */
const STYLESHEET = "view/frontend/web/css/custom.css";

/**
 * Both classes, in the order the templates spell them.
 *
 * `POSITION_CLASS` is what paints the spinner: position, box and background
 * image. `LEGACY_HOOK_CLASS` paints nothing on this element — its declarations
 * are text-level and inert on a childless fixed-size box — but it is carried
 * deliberately, as the shared loading hook a merchant or brand overlay may
 * style. It is asserted below because dropping it is a silent behaviour change
 * for those overlays, not because the spinner needs it to render.
 */
const POSITION_CLASS = "two-company-search__spinner";
const LEGACY_HOOK_CLASS = "two-term-chip__loading";

const SPINNER_SELECTOR = "." + POSITION_CLASS;

/** The component state property the spinner must be bound to. */
const SEARCHING_STATE = "isSearching";

/**
 * The two surfaces that run a company search, each with its markup template,
 * the `-csp-js` template defining its component, and that component's
 * registered Alpine name.
 */
const SURFACES = [
  {
    label: "payment tile",
    markup: H.GATEWAY_METHOD_MARKUP_TEMPLATE,
    js: H.GATEWAY_METHOD_TEMPLATE,
    component: "twoGatewayHyvaPaymentMethodBase",
  },
  {
    label: "shipping-address field",
    markup: H.COMPANY_NAME_MARKUP_TEMPLATE,
    js: H.COMPANY_NAME_TEMPLATE,
    component: "twoGatewayHyvaCompanySearchField",
  },
];

/**
 * The spinner element as the surface's shipped template renders it.
 *
 * @param {string} relPath repo-relative markup template path
 * @returns {Element}
 */
function spinnerFrom(relPath) {
  const markup = H.renderTemplateMarkup(relPath);
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const spinners = doc.querySelectorAll(SPINNER_SELECTOR);
  // Exactly one per surface: a second one would mean two spinners fighting over
  // the same absolute position, and a `querySelector` assertion would not see
  // it.
  expect(spinners.length).toBe(1);
  return spinners[0];
}

describe.each(SURFACES)("company-search spinner — $label", (surface) => {
  test("renders exactly one spinner element", () => {
    expect(spinnerFrom(surface.markup)).not.toBeNull();
  });

  // The legacy hook is inert on the spinner, so this is not a rendering
  // assertion — it pins the class on the element for overlays that style it.
  test("carries both the positioning and the legacy hook class", () => {
    const spinner = spinnerFrom(surface.markup);

    expect(spinner.classList.contains(POSITION_CLASS)).toBe(true);
    expect(spinner.classList.contains(LEGACY_HOOK_CLASS)).toBe(true);
  });

  test("has no child nodes for the CSS to fight with", () => {
    const spinner = spinnerFrom(surface.markup);

    expect(spinner.childElementCount).toBe(0);
    // Text children are just as wrong as element ones — the old markup's dots
    // were text inside spans, and a stray `.` survives an element-count check.
    expect(spinner.textContent.trim()).toBe("");
  });

  test("is hidden from assistive technology", () => {
    const spinner = spinnerFrom(surface.markup);

    expect(spinner.getAttribute("aria-hidden")).toBe("true");
  });

  test("is bound to the searching state, which the component defines", () => {
    // Throws if the element has no `x-show` at all, which is the shipping
    // field's original defect.
    const bound = H.readAlpineBinding(
      surface.markup,
      SPINNER_SELECTOR,
      "x-show",
    );
    expect(bound).toBe(SEARCHING_STATE);

    // Under CSP Alpine the binding is a key lookup on the component, so a
    // binding whose name the component does not define resolves to undefined
    // and the spinner never shows. Mount the real component and check.
    const env = H.installHyvaEnvironment();
    const fetchStub = H.stubFetch();
    try {
      H.loadSharedHelpers();
      H.loadTemplate(surface.js);
      // The templates register their components from an `alpine:init` listener,
      // so nothing is in `alpineComponents` until that event fires.
      env.fireAlpineInit();
      const component = H.mountComponent(
        env.alpineComponents[surface.component],
        {},
      );

      expect(component[bound]).toBe(false);
    } finally {
      fetchStub.restore();
      env.restore();
    }
  });
});

/**
 * The stylesheet is the entire spinner: the element is childless, so the image
 * and the box it is painted into come from here and nowhere else.
 *
 * The motion comes from the GIF itself, which is why nothing here asserts a CSS
 * animation. The previous revision of this branch drew the spinner with a
 * conic-gradient and a rotate keyframe; that shipped visibly motionless and was
 * abandoned in favour of the animated GIF the PrestaShop plugin already uses.
 * A CSS rule cannot pause, slow or step a GIF, so there is deliberately no
 * reduced-motion rule to assert either.
 *
 * Where it can, this reads the real declarations back through jsdom's cascade
 * rather than regex-matching the file, so a rule that parses differently from
 * how it reads fails. jsdom resolves `background-image`, `background-repeat` and
 * `background-size`; it does NOT resolve the multi-value `background-position`
 * shorthand, so that one is not asserted.
 */
describe("company-search spinner stylesheet", () => {
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
