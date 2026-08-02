/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25288 — the two company-search hints, and the single threshold behind
 * them.
 *
 * The copy is the easy part and is not what this suite is really about. The
 * defect is DRIFT: the number a buyer is told to type and the number actually
 * enforced were independent literals, five of them across three templates, so
 * changing one and missing another produced a field that says "3" and searches
 * at 4 with nothing in CI able to notice. So the assertions here are mostly
 * about provenance rather than appearance:
 *
 *  - the threshold reaches every guard from ONE PHP value, proved by rendering
 *    the templates with a DIFFERENT number injected and watching the guards
 *    move with it. A literal 3 that happens to agree with production would
 *    satisfy any test that used 3 as its fixture, which is why none of these do.
 *  - the hint INTERPOLATES that same value instead of restating it. Asserted at
 *    source level, because the Jest harness resolves every `__()` to one
 *    placeholder string — so an assertion on the RENDERED hint text cannot see
 *    the number at all and would pass just as happily over a hardcoded one.
 *  - the bindings exist AND the component defines what they name. Under Hyvä's
 *    CSP-friendly Alpine an attribute expression is a key lookup, so a binding
 *    naming a property the component does not have resolves to undefined and
 *    the element silently never shows. The shipping-address spinner shipped in
 *    exactly that state.
 *
 * On the trap this suite has to avoid: the hint markup is server-rendered, so a
 * test that only queried the DOM for the hint's text would pass with the Alpine
 * component entirely absent. Every behavioural assertion below goes through a
 * mounted component, and `expectBootstrapped()` fails loudly if the mount did
 * not happen.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const H = require("./hyva-harness");

/** The exact English source strings. A byte off and the dictionaries miss. */
const PLACEHOLDER_MSGID = "Enter company name to search";
const MIN_CHARS_MSGID = "Please enter %1 or more characters";

/** The PHP variable every surface reads the threshold out of. */
const PHP_THRESHOLD_VAR = "$companySearchMinChars";

/** Component state property the threshold lands in. */
const STATE_PROPERTY = "minSearchChars";

/**
 * A threshold that is NOT the production 3, injected in place of it.
 *
 * Deliberately larger than 3 so a guard left as a literal `3` is observably
 * wrong in both directions: it would search at 3 characters where this value
 * forbids it, and hide the hint at 3 where this value requires it.
 */
const INJECTED_MIN = 5;

/** Render/load rule that replaces the PHP-emitted threshold with INJECTED_MIN. */
const INJECT_RULE = [
  [/^\(int\) \$companySearchMinChars$/, String(INJECTED_MIN)],
];

const ADDRESS_COMPONENT = "twoGatewayHyvaCompanySearchField";
const PAYMENT_COMPONENT = "twoGatewayHyvaPaymentMethodBase";
const SHIPPING_COMPONENT = "searchInput";

/** The address field's input and its min-characters hint, by selector. */
const ADDRESS_INPUT = "input[type=text]";
const MIN_CHARS_SELECTOR = ".two-company-search__min-chars";

/** Every template that carries a company-search threshold or hint. */
const THRESHOLD_TEMPLATES = [
  H.COMPANY_NAME_TEMPLATE,
  H.COMPANY_NAME_MARKUP_TEMPLATE,
  H.SHIPPING_COMPANY_TEMPLATE,
  H.GATEWAY_METHOD_TEMPLATE,
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
];

/**
 * A template's source, verbatim and un-substituted.
 *
 * The PHP is the subject matter for the provenance assertions — whether the
 * hint interpolates a variable or restates a number is invisible once the
 * harness has resolved the tag.
 *
 * @param {string} relPath repo-relative template path
 * @returns {string}
 */
function templateSource(relPath) {
  return fs.readFileSync(path.join(H.REPO_ROOT, relPath), "utf8");
}

/**
 * Fail loudly if a mount produced no component.
 *
 * The hint and the placeholder are both in the server-rendered markup, so a
 * suite that skipped the mount would still see them and pass. This is the guard
 * that makes "the component never initialised" a red test rather than an
 * invisible one.
 *
 * @param {Object|undefined} component
 * @param {string} name the registered Alpine name
 * @returns {Object} the component
 */
function expectBootstrapped(component, name) {
  if (component === undefined || component === null) {
    throw new Error(
      "bootstrap check: no Alpine component registered as `" +
        name +
        "`. Every behavioural assertion in this suite depends on the mounted " +
        "component; the markup alone would satisfy them with the component absent.",
    );
  }
  // A threshold the component does not carry means the guards fell back to
  // `undefined`, and `n < undefined` is false — every length would search.
  expect(typeof component[STATE_PROPERTY]).toBe("number");
  return component;
}

/**
 * Load one surface's component with the threshold overridden.
 *
 * @param {string} jsTemplate repo-relative `-csp-js` template path
 * @param {string} name the registered Alpine name
 * @param {Object} [mountOptions] passed to mountComponent
 * @returns {{component: Object, restore: Function}}
 */
function mountWithInjectedThreshold(jsTemplate, name, mountOptions) {
  const env = H.installHyvaEnvironment();
  const fetchStub = H.stubFetch();
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  H.loadSharedHelpers();
  H.loadTemplate(jsTemplate, INJECT_RULE);
  env.fireAlpineInit();

  const component = H.mountComponent(
    env.alpineComponents[name],
    mountOptions || {},
  );

  return {
    component: expectBootstrapped(component, name),
    fetchStub: fetchStub,
    restore: function () {
      consoleError.mockRestore();
      fetchStub.restore();
      env.restore();
    },
  };
}

describe("company-search threshold provenance", () => {
  test("no template restates the threshold as a literal in a length guard", () => {
    THRESHOLD_TEMPLATES.forEach((relPath) => {
      const source = templateSource(relPath);

      // Every length comparison against a bare number, not just against 3. A
      // guard hardcoded to a DIFFERENT number is the same defect wearing a
      // disguise, and pinning the pattern rather than the digit is what stops
      // the next one landing.
      //
      // `query` and `term` are named alongside `search` because TWO-25326 §1
      // moved the guards onto the panel's own query text — `search` alone
      // would now match nothing on this surface, which is exactly how a
      // provenance check goes quietly vacuous.
      //
      // Zero is the one permitted literal: `length > 0` asks whether the field
      // is empty, which is not the threshold and does not move with it.
      const literals = (
        source.match(/(?:search|query|term)\.length\s*[<>]=?\s*\d+/g) || []
      ).map((match) => match.replace(/\D+/g, ""));

      expect(literals.filter((value) => value !== "0")).toEqual([]);
    });
  });

  test("no template restates the threshold inside the hint copy", () => {
    THRESHOLD_TEMPLATES.forEach((relPath) => {
      const source = templateSource(relPath);

      expect(source).not.toMatch(/Please enter \d+ or more characters/);
    });
  });

  test("every guard's threshold comes from the shared PHP value", () => {
    // One PHP variable per template that guards, and it is the same name in all
    // of them — the marker that they are reading one source rather than three
    // agreeing copies.
    [
      H.COMPANY_NAME_TEMPLATE,
      H.SHIPPING_COMPANY_TEMPLATE,
      H.GATEWAY_METHOD_TEMPLATE,
      H.GATEWAY_METHOD_MARKUP_TEMPLATE,
    ].forEach((relPath) => {
      expect(templateSource(relPath)).toContain(PHP_THRESHOLD_VAR);
    });

    // And it originates in the view model, not in a template local.
    //
    // Deliberately NOT pinning the shipped value here. Changing the threshold is
    // a legitimate change, and it is pinned in exactly one place — the PHP unit
    // test on the view model — so that it takes one edit rather than turning this
    // suite red for a reason that has nothing to do with drift.
    const viewModel = templateSource("ViewModel/CheckoutConfig.php");
    expect(viewModel).toMatch(/COMPANY_SEARCH_MIN_CHARS = \d+;/);
    expect(viewModel).toContain("getCompanySearchMinChars");
    // The getter must RETURN the constant, not a number of its own. Returning a
    // literal that currently agrees with the constant reopens exactly the drift
    // this whole change closes, and no value-based assertion can see it — the
    // two numbers agree until the day someone changes one.
    expect(viewModel).toContain("return self::COMPANY_SEARCH_MIN_CHARS;");
  });

  test("both hint strings use the exact English source text", () => {
    // Character for character: these resolve against dictionaries maintained in
    // the base Two Magento module, and a reworded key silently falls back to
    // English in every other locale.
    expect(templateSource(H.COMPANY_NAME_MARKUP_TEMPLATE)).toContain(
      "__('" + PLACEHOLDER_MSGID + "')",
    );
    expect(templateSource(H.COMPANY_NAME_TEMPLATE)).toContain(
      "__('" + PLACEHOLDER_MSGID + "')",
    );

    // The min-characters key is the `%1` placeholder form, with the count passed
    // as an argument. A key that spelled the number would need one dictionary
    // entry per threshold and would drift the moment the threshold moved.
    [H.COMPANY_NAME_MARKUP_TEMPLATE, H.GATEWAY_METHOD_MARKUP_TEMPLATE].forEach(
      (relPath) => {
        const source = templateSource(relPath);
        expect(source).toContain(MIN_CHARS_MSGID);
        expect(source).toMatch(
          new RegExp(
            "__\\(\\s*[\"']" +
              MIN_CHARS_MSGID.replace(/[%$]/g, "\\$&") +
              "[\"']\\s*,\\s*\\" +
              PHP_THRESHOLD_VAR +
              "\\s*,?\\s*\\)",
          ),
        );
      },
    );
  });

  test("this repo ships no translation dictionary of its own", () => {
    // The keys above are translated by dictionaries the base Two Magento module
    // ships; Magento merges module dictionaries globally, so `__()` here
    // resolves against them. An i18n directory appearing in this repo would
    // shadow that and is what this asserts against.
    expect(fs.existsSync(path.join(H.REPO_ROOT, "i18n"))).toBe(false);
  });
});

/**
 * Each surface's component must take its threshold from the PHP value, not from
 * a literal that happens to match it. Proved by injecting a different number.
 */
describe.each([
  {
    label: "address field",
    js: H.COMPANY_NAME_TEMPLATE,
    component: ADDRESS_COMPONENT,
  },
  {
    label: "payment tile",
    js: H.GATEWAY_METHOD_TEMPLATE,
    component: PAYMENT_COMPONENT,
  },
  {
    label: "shipping picker",
    js: H.SHIPPING_COMPANY_TEMPLATE,
    component: SHIPPING_COMPONENT,
  },
])("threshold injection — $label", (surface) => {
  test("the component carries the injected threshold, not a literal 3", () => {
    const mounted = mountWithInjectedThreshold(surface.js, surface.component);
    try {
      expect(mounted.component[STATE_PROPERTY]).toBe(INJECTED_MIN);
      // Spelled out: a literal 3 left in the template would land here as 3 and
      // this is the assertion that names why that is wrong.
      expect(mounted.component[STATE_PROPERTY]).not.toBe(3);
    } finally {
      mounted.restore();
    }
  });
});

describe("address field — empty-field hint (element 3)", () => {
  test("the input carries a server-rendered placeholder", () => {
    const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const input = doc.querySelector(ADDRESS_INPUT);

    expect(input).not.toBeNull();
    // The harness resolves every `__()` to one placeholder string, so this
    // asserts the attribute is PRESENT and routed through the translator and
    // escaper — the msgid itself is pinned at source level above.
    expect(input.getAttribute("placeholder")).toBe(H.ESCAPED_STRING);
  });

  test("the placeholder wins over one the field renderer may emit", () => {
    // Duplicate attributes resolve first-occurrence-wins, and Hyvä's renderer
    // is free to emit a `placeholder` from the customer attribute's frontend
    // config. Ours has to be emitted first or the hint is silently absent
    // wherever it does. `renderAttributes()` resolves to a `name="company"`
    // fixture, which is what marks its position in the tag.
    const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
    const openTag = /<input\b[^>]*>/.exec(markup);

    expect(openTag).not.toBeNull();
    const placeholderAt = openTag[0].indexOf("placeholder=");
    const renderedAttrsAt = openTag[0].indexOf('name="company"');

    expect(placeholderAt).toBeGreaterThan(-1);
    expect(renderedAttrsAt).toBeGreaterThan(-1);
    expect(placeholderAt).toBeLessThan(renderedAttrsAt);
  });

  test("the Alpine binding names a getter the component defines", () => {
    const bound = H.readAlpineBinding(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      ADDRESS_INPUT,
      ":placeholder",
    );

    const mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
    );
    try {
      // Under CSP Alpine this is a key lookup; an undefined value here is a
      // binding that blanks the placeholder instead of setting it.
      expect(typeof mounted.component[bound]).toBe("function");
      expect(mounted.component[bound]()).toBe(H.ESCAPED_STRING);
    } finally {
      mounted.restore();
    }
  });

  test("manual entry clears the placeholder", () => {
    const bound = H.readAlpineBinding(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      ADDRESS_INPUT,
      ":placeholder",
    );
    const mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
    );
    try {
      mounted.component.manualMode = true;

      // "Enter company name to search" over a field being filled in by hand is
      // wrong, and is the reason the binding exists at all alongside the static
      // attribute.
      expect(mounted.component[bound]()).toBe("");
    } finally {
      mounted.restore();
    }
  });
});

describe("address field — minimum-characters hint (element 4)", () => {
  /** @returns {Element} the hint element as the shipped template renders it */
  function hintElement() {
    const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const hints = doc.querySelectorAll(MIN_CHARS_SELECTOR);

    // Exactly one: a second would be a duplicate message a querySelector
    // assertion could not see.
    expect(hints.length).toBe(1);
    return hints[0];
  }

  test("the hint is rendered on this surface at all", () => {
    // It was absent entirely — below the threshold getItems() returned early
    // and the address step showed nothing, indistinguishable from a search that
    // had failed.
    expect(hintElement()).not.toBeNull();
    expect(hintElement().textContent.trim()).toBe(H.ESCAPED_STRING);
  });

  test("the hint sits inside the panel but outside the results scroller", () => {
    // REPLACES "the hint sits outside the results dropdown", whose reasoning
    // was that the panel and the hint were mutually exclusive — the panel
    // opened at or above the threshold, the hint showed only below it. TWO-25326
    // §1 inverted exactly that: the panel opens on interaction and the hint is
    // what a freshly-opened, empty panel shows, so the hint has to be INSIDE
    // the panel or it can never be seen at the moment it is needed. It still
    // must not be inside the results scroller, which `x-for` owns.
    const markup = H.renderTemplateMarkup(H.COMPANY_NAME_MARKUP_TEMPLATE);
    const doc = new DOMParser().parseFromString(markup, "text/html");
    const hint = doc.querySelector(MIN_CHARS_SELECTOR);
    const panel = doc.querySelector("[x-show='showDropdown']");
    const dropdownItems = doc.querySelector("template[x-for]");

    expect(panel).not.toBeNull();
    expect(panel.contains(hint)).toBe(true);
    expect(dropdownItems).not.toBeNull();
    expect(dropdownItems.contains(hint)).toBe(false);
  });

  test("the x-show binding names a getter the component defines", () => {
    const bound = H.readAlpineBinding(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      MIN_CHARS_SELECTOR,
      "x-show",
    );
    const mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
    );
    try {
      expect(typeof mounted.component[bound]).toBe("function");
    } finally {
      mounted.restore();
    }
  });

  /**
   * The visibility table, evaluated against the INJECTED threshold so a literal
   * 3 anywhere in the chain fails at least one row.
   */
  test("the hint shows from ZERO characters up to the threshold, and measures the QUERY", () => {
    // REPLACES "the hint shows only between one character and the threshold".
    // The zero-length exclusion WAS the bug TWO-25326 §1 reports: the buyer
    // opened the panel, saw nothing, and had to type a letter before the
    // surface would explain what it wanted. The hint now lives inside the
    // panel — being open at all is the condition the old `search.length > 0`
    // and `isCompanySelected` terms were standing in for — so it fires at
    // zero, and it measures `query`, the panel's own text, not the
    // company-name field.
    const bound = H.readAlpineBinding(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      MIN_CHARS_SELECTOR,
      "x-show",
    );
    const mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
    );
    try {
      const component = mounted.component;

      for (let n = 0; n < INJECTED_MIN; n += 1) {
        component.query = "x".repeat(n);
        expect(component[bound]()).toBe(true);
      }

      // At the threshold the search runs, so the hint must be gone.
      component.query = "x".repeat(INJECTED_MIN);
      expect(component[bound]()).toBe(false);
      component.query = "x".repeat(INJECTED_MIN + 4);
      expect(component[bound]()).toBe(false);

      // Under a literal 3 the row below would be the one that fails: three
      // characters would be treated as long enough to search.
      component.query = "xxx";
      expect(component[bound]()).toBe(true);

      // And the company-NAME field is not what it reads. A long chosen name
      // beside an empty query must still hint, or a reopened panel would sit
      // silent again — the same defect by the other door.
      component.query = "";
      component.search = "Some Very Long Company Name Ltd";
      expect(component[bound]()).toBe(true);
    } finally {
      mounted.restore();
    }
  });

  test("manual entry suppresses the hint", () => {
    const bound = H.readAlpineBinding(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      MIN_CHARS_SELECTOR,
      "x-show",
    );
    const mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
    );
    try {
      mounted.component.query = "x";
      expect(mounted.component[bound]()).toBe(true);

      // No search runs in manual mode, so telling the buyer to type more is
      // instructing them to satisfy a threshold that no longer applies.
      mounted.component.manualMode = true;
      expect(mounted.component[bound]()).toBe(false);
    } finally {
      mounted.restore();
    }
  });

  /**
   * A mounted component over a root that carries its own input, which is what
   * `selectItem()` and the manual-entry helpers reach for through `$root`.
   *
   * @returns {{component: Object, bound: string, field: HTMLElement, restore: Function}}
   */
  function mountOverField() {
    // Both inputs, in shipped order — the hint measures the SECOND one.
    document.body.innerHTML = [
      '<div id="root">',
      '  <input type="text" id="field" value="" />',
      '  <input type="text" class="two-company-query" id="query" value="" />',
      "</div>",
    ].join("\n");
    const field = document.getElementById("field");
    const queryInput = document.getElementById("query");
    const root = document.getElementById("root");

    const bound = H.readAlpineBinding(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      MIN_CHARS_SELECTOR,
      "x-show",
    );
    const mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
      { el: field, root: root },
    );
    mounted.component.init();

    return {
      component: mounted.component,
      bound: bound,
      field: field,
      queryInput: queryInput,
      fetchStub: mounted.fetchStub,
      restore: mounted.restore,
    };
  }

  test("choosing a company closes the panel, which is what takes the hint off screen", async () => {
    // REPLACES "choosing a company shorter than the threshold hides the hint".
    // The old defect was that `selectItem()` wrote the chosen name into
    // `search` — the very value the hint measured — so a registered name
    // shorter than the threshold left "please enter N or more characters"
    // sitting under a populated, closed field. `isCompanySelected` was the
    // term added to suppress it.
    //
    // TWO-25326 §1 removed the coupling instead of patching it: the hint reads
    // the panel's `query`, and the panel is what carries it. A pick empties the
    // query AND closes the panel, so the getter is free to say "yes, an empty
    // query is below the threshold" — nothing renders it. Asserting the getter
    // alone here would now be asserting the wrong thing, so the panel gate is
    // asserted with it.
    const mounted = mountOverField();
    try {
      const component = mounted.component;
      const shortName = "Ab";
      expect(shortName.length).toBeLessThan(INJECTED_MIN);

      component.openDropdown("");
      component.query = shortName;
      expect(component.showDropdown()).toBe(true);
      expect(component[mounted.bound]()).toBe(true);

      component.selectItem({ companyName: shortName, companyId: "1" });

      expect(component.search).toBe(shortName);
      expect(component.query).toBe("");
      // The panel is shut, so the hint is not on screen whatever the getter
      // says about an empty query.
      expect(component.showDropdown()).toBe(false);

      // Reopening deliberately brings it back: an empty query IS the state the
      // hint exists to explain (§1), and a panel that opened silent is the bug.
      component.openDropdown("");
      expect(component.showDropdown()).toBe(true);
      expect(component[mounted.bound]()).toBe(true);
    } finally {
      mounted.restore();
    }
  });

  test("returning to search opens the panel onto the hint, whatever was typed by hand", async () => {
    // REPLACES "text typed by hand reaches the hint on switching back to
    // search", which existed because `search` had to be refreshed from the
    // field for the hint to be right. §3 removed the whole question: the hint
    // measures the panel's query, enableSearch() opens the panel with that
    // query EMPTY, and the hand-typed company name is left alone in the name
    // field rather than being adopted as a search term.
    const mounted = mountOverField();
    try {
      const component = mounted.component;

      component.enterManually();
      mounted.field.value = "Ab";
      component.onNameFieldInput();

      expect(component.search).toBe("Ab");
      // Suppressed while manual entry is in effect: no search runs, so there
      // is no threshold to satisfy.
      expect(component[mounted.bound]()).toBe(false);

      component.enableSearch();

      expect(component.showDropdown()).toBe(true);
      expect(component.query).toBe("");
      expect(component[mounted.bound]()).toBe(true);
      // The typed name survives the trip; it is a name, not a query.
      expect(mounted.field.value).toBe("Ab");
    } finally {
      mounted.restore();
    }
  });

  test("the hint is shown at exactly the query lengths that issue no request", () => {
    // The claim and the enforcement, checked against each other rather than
    // each against a fixture. This is the drift the ticket is about: a hint
    // visible at a length that DOES search, or absent at one that does not,
    // fails here whichever half moved.
    //
    // Swept from ZERO now, not one — that boundary is the §1 fix, and starting
    // at one would step straight over it.
    const mounted = mountOverField();
    try {
      const component = mounted.component;

      for (let n = 0; n <= INJECTED_MIN; n += 1) {
        const before = mounted.fetchStub.calls.length;
        mounted.queryInput.value = "x".repeat(n);
        component.getItems();

        const searched = mounted.fetchStub.calls.length > before;
        const hinted = component[mounted.bound]();

        expect(hinted).toBe(!searched);
      }
    } finally {
      mounted.restore();
    }
  });
});
