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
const MIN_CHARS_MSGID = "Enter %1 or more characters";

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

/** The address field's own input, by selector. */
const ADDRESS_INPUT = "input[type=text]";

/**
 * The min-characters hint, with a body this repo can see the count land in.
 *
 * The harness resolves every `__()` to one constant, so the shipped msgid's
 * `%1` is gone by the time the component reads it and the interpolation cannot
 * be observed at all. This substitutes a body that keeps the placeholder.
 */
const HINT_RULE = [
  [/^__\('Enter %1 or more characters'\)$/, "at least %1 characters"],
];

/**
 * The ONE company-search control's markup (TWO-25326, 2026-08-05).
 *
 * Both the hint and the company-name placeholder used to be emitted by each
 * surface's own template. There is now exactly one control, included by both
 * mount points, so both strings are emitted from here and nowhere else.
 */
const CONTROL_MARKUP_TEMPLATE =
  "view/frontend/templates/form/field/company-search-control.phtml";

/** Every template that carries a company-search threshold or hint. */
const THRESHOLD_TEMPLATES = [
  H.COMPANY_NAME_TEMPLATE,
  H.COMPANY_NAME_MARKUP_TEMPLATE,
  CONTROL_MARKUP_TEMPLATE,
  H.SHIPPING_COMPANY_TEMPLATE,
  H.GATEWAY_METHOD_TEMPLATE,
  H.GATEWAY_METHOD_MARKUP_TEMPLATE,
];

/**
 * `$twoControlInputAttributes` as the ADDRESS STEP supplies it.
 *
 * The harness's default rule resolves this parameter to the payment tile's
 * value, because that surface is the one whose selectors need the exact
 * `company_name` id/name. The address step builds it from the Hyvä entity
 * field's own config instead — `renderAttributes()`, which the harness maps to
 * `name="company"` — and that marker is what the attribute-ORDER assertion below
 * measures its position against.
 */
const ADDRESS_CONTROL_ATTRS_RULE = [
  [
    /^\$twoControlInputAttributes$/,
    'name="company" required data-validate=\'{"required":true}\'',
  ],
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
 * @param {Array<[RegExp, string]>} [extraRules] applied ahead of the threshold
 * @returns {{component: Object, env: Object, fetchStub: Object, restore: Function}}
 */
function mountWithInjectedThreshold(jsTemplate, name, mountOptions, extraRules) {
  const env = H.installHyvaEnvironment();
  const fetchStub = H.stubFetch();
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => {});

  const rules = (extraRules || []).concat(INJECT_RULE);
  // The shared helpers are the payment tile's template, which is also where the
  // panel's string map lives — so a rule aimed at either has to reach both.
  H.loadSharedHelpers(rules);
  H.loadTemplate(jsTemplate, rules);
  env.fireAlpineInit();

  const component = H.mountComponent(
    env.alpineComponents[name],
    mountOptions || {},
  );

  return {
    component: expectBootstrapped(component, name),
    env: env,
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

      expect(source).not.toMatch(/Enter \d+ or more characters/);
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

  test("ONE hint string, emitted from ONE file, in the exact English source text", () => {
    // REWRITTEN 2026-08-05 (TWO-25326). This used to assert BOTH hint strings,
    // because each surface emitted its own copy of the control markup and so its
    // own copy of the copy. There is one control now
    // (form/field/company-search-control.phtml, included by both mount points),
    // so "both strings agree" is no longer a thing that can be true or false —
    // there is one string, and this pins where it lives.
    //
    // Character for character, either way: these resolve against dictionaries
    // maintained in the base Two Magento module, and a reworded key silently
    // falls back to English in every other locale.
    const control = templateSource(CONTROL_MARKUP_TEMPLATE);

    expect(control).toContain("__('" + PLACEHOLDER_MSGID + "')");
    // The JS side keeps its own copy of the placeholder msgid deliberately: it is
    // the value `:placeholder` restores when the buyer leaves manual entry, so it
    // has to reach the component as data. Same source text, or the hint changes
    // when Alpine boots.
    expect(templateSource(H.COMPANY_NAME_TEMPLATE)).toContain(
      "__('" + PLACEHOLDER_MSGID + "')",
    );

    // And the string is emitted from the control ALONE. A second copy in a mount
    // point's own markup is how the two surfaces drifted apart in the first place.
    [H.COMPANY_NAME_MARKUP_TEMPLATE, H.GATEWAY_METHOD_MARKUP_TEMPLATE].forEach(
      (relPath) => {
        expect(templateSource(relPath)).not.toContain(
          "__('" + PLACEHOLDER_MSGID + "')",
        );
      },
    );

    // The min-characters key moved to the panel's string map (TWO-25503): the
    // shared popover renders the hint, so the count is substituted in JS from
    // `minSearchChars` rather than passed to `__()`. The key keeps its `%1`
    // form — one that spelled the number would need a dictionary entry per
    // threshold and would drift the moment the threshold moved.
    expect(templateSource(H.GATEWAY_METHOD_TEMPLATE)).toContain(
      "__('" + MIN_CHARS_MSGID + "')",
    );
    expect(control).not.toContain(MIN_CHARS_MSGID);
  });

  test("this repo's own dictionary does not shadow the company-search keys", () => {
    // REWRITTEN 2026-08-05. The old assertion was that this repo ships NO `i18n`
    // directory at all, on the reasoning that Magento merges module dictionaries
    // globally so `__()` here resolves against the base Two module's. That is no
    // longer true of the repo: it now ships CSVs for strings that exist ONLY
    // here and therefore have no base-module entry to resolve against.
    //
    // The guarantee that survives is the narrower, real one — a LOCAL copy of a
    // key the base module already translates is what shadows and drifts, so the
    // company-search keys this suite pins must not appear in this repo's own
    // dictionary.
    const i18nDir = path.join(H.REPO_ROOT, "i18n");
    if (!fs.existsSync(i18nDir)) return;

    const dictionaries = fs
      .readdirSync(i18nDir)
      .filter((name) => name.endsWith(".csv"));
    // A dictionary directory with no dictionaries in it is a packaging mistake
    // that would make this test vacuous.
    expect(dictionaries.length).toBeGreaterThan(0);

    dictionaries.forEach((name) => {
      const csv = fs.readFileSync(path.join(i18nDir, name), "utf8");

      expect(csv).not.toContain(PLACEHOLDER_MSGID);
      expect(csv).not.toContain(MIN_CHARS_MSGID);
      // And never the count spelled into the key, in any locale: that needs one
      // row per threshold value and silently misses the day the threshold moves.
      expect(csv).not.toMatch(/Enter \d+ or more characters/);
    });
  });

  test("every locale in the set translates the same keys", () => {
    // Added 2026-08-05 alongside the rewrite above. Once this repo ships a
    // dictionary of its own, the failure mode it introduces is a string
    // translated in some locales and missed in others — which renders as English
    // for those buyers and is invisible to every other test here.
    const i18nDir = path.join(H.REPO_ROOT, "i18n");
    if (!fs.existsSync(i18nDir)) return;

    /**
     * The msgids one dictionary carries.
     *
     * Magento's CSV is `"<msgid>","<translation>"`, so the msgid is the first
     * quoted field. Rows are compared as a SET: order is not meaningful and
     * pinning it would fail on an unrelated re-sort.
     *
     * @param {string} name
     * @returns {Array<string>}
     */
    function msgids(name) {
      return fs
        .readFileSync(path.join(i18nDir, name), "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const match = /^"((?:[^"]|"")*)"\s*,/.exec(line);
          if (match === null) {
            throw new Error(
              "i18n/" + name + ": row is not `\"msgid\",\"translation\"`: " + line,
            );
          }
          return match[1];
        })
        .sort();
    }

    const dictionaries = fs
      .readdirSync(i18nDir)
      .filter((name) => name.endsWith(".csv"));
    const reference = msgids(dictionaries[0]);

    expect(reference.length).toBeGreaterThan(0);
    dictionaries.forEach((name) => {
      expect(msgids(name)).toEqual(reference);
    });
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
    //
    // `ADDRESS_CONTROL_ATTRS_RULE` is what puts that marker in the tag at all
    // (TWO-25326, 2026-08-05): the entity-field attributes are now passed INTO the
    // shared control as `$twoControlInputAttributes`, and the harness's default
    // rule for that parameter carries the payment tile's id/name instead. This is
    // the address step's own value, so the ordering measured here is the ordering
    // this surface actually ships.
    const markup = H.renderTemplateMarkup(
      H.COMPANY_NAME_MARKUP_TEMPLATE,
      ADDRESS_CONTROL_ATTRS_RULE,
    );
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

/**
 * TWO-25503 moved the hint into the shared popover, which renders it from the
 * `minInputLengthMessage()` this module hands it. The drift this suite exists
 * for therefore lives on one seam now: the number the message states and the
 * number `searchCompanies()` enforces both come off `minSearchChars`, and they
 * are checked against each other below rather than each against a fixture.
 */
describe("address field — minimum-characters hint (element 4)", () => {
  let mounted;
  let searchApi;

  beforeEach(() => {
    // The panel's string map is `window.X = window.X || —` and the harness does
    // not reset it, so an earlier test's translations would win over HINT_RULE.
    delete window.twoGatewayPanelStrings;

    document.body.innerHTML = [
      // Without a country the engine refuses to search at all, and every row of
      // the sweep below would read as "too short".
      '<input id="shipping-country_id" value="GB" />',
      '<div id="root" class="two-company-search">',
      '  <input type="text" id="field" value="" />',
      "</div>",
    ].join("\n");

    mounted = mountWithInjectedThreshold(
      H.COMPANY_NAME_TEMPLATE,
      ADDRESS_COMPONENT,
      {
        el: document.getElementById("field"),
        root: document.getElementById("root"),
      },
      HINT_RULE,
    );
    mounted.component.init();

    expect(mounted.env.companyPanels).toHaveLength(1);
    searchApi = mounted.env.companyPanels[0].options.search;
  });

  afterEach(() => {
    mounted.restore();
    document.body.innerHTML = "";
  });

  test("the panel is handed the hint and the threshold behind it", () => {
    expect(typeof searchApi.minInputLengthMessage).toBe("function");
    expect(searchApi.MIN_INPUT_LENGTH).toBe(INJECTED_MIN);
  });

  test.each([
    [".two-company-search__min-chars", "the hint element"],
    ['[data-name="company_search_min_chars"]', "its data hook"],
  ])("no mount point renders %s of its own (%s)", (selector) => {
    [H.COMPANY_NAME_MARKUP_TEMPLATE, H.GATEWAY_METHOD_MARKUP_TEMPLATE].forEach(
      (relPath) => {
        const doc = new DOMParser().parseFromString(
          H.renderTemplateMarkup(relPath),
          "text/html",
        );

        expect(doc.querySelectorAll(selector)).toHaveLength(0);
      },
    );
  });

  test("the hint interpolates the threshold instead of restating it", () => {
    expect(searchApi.minInputLengthMessage()).toBe(
      "at least " + INJECTED_MIN + " characters",
    );
    // A literal 3 anywhere in the chain lands here as 3.
    expect(searchApi.minInputLengthMessage()).not.toContain("3");
  });

  test("the threshold it states is the threshold enforced", async () => {
    for (let n = 0; n <= INJECTED_MIN; n += 1) {
      const before = mounted.fetchStub.calls.length;
      const pending = searchApi.searchCompanies({ term: "x".repeat(n) });
      await H.flushPromises();

      const searched = mounted.fetchStub.calls.length > before;
      expect(searched).toBe(n >= INJECTED_MIN);

      if (searched) mounted.fetchStub.last().respond({ items: [] });
      await pending;
    }
  });
});

