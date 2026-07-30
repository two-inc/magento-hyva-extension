/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * The harness's own guarantees.
 *
 * Reading JS out of a `.phtml` at test time buys the suite a real production
 * template instead of a copy, at the cost of one specific hazard: a template
 * edit the renderer no longer understands could leave a suite that passes
 * because it is asserting against nothing. Every step of the renderer therefore
 * throws instead of degrading, and this file is what stops those throws from
 * being quietly softened later.
 */

"use strict";

const H = require("./hyva-harness");

const FIXTURES = "Test/Js/fixtures/";

describe("template renderer contract", () => {
  test("an unmapped PHP expression is a hard error naming the expression", () => {
    expect(() =>
      H.renderTemplateJs(FIXTURES + "unknown-tag.phtml.fixture"),
    ).toThrow(/no test value for PHP expression `\$somethingNobodyMapped`/);
  });

  test("a caller can supply the missing value itself", () => {
    const js = H.renderTemplateJs(FIXTURES + "unknown-tag.phtml.fixture", [
      [/^\$somethingNobodyMapped$/, "substituted"],
    ]);

    expect(js).toContain("window.value = 'substituted';");
  });

  test("a PHP tag the renderer cannot even recognise is a hard error", () => {
    expect(() =>
      H.renderTemplateJs(FIXTURES + "short-tag.phtml.fixture"),
    ).toThrow(/unsubstituted PHP tag/);
  });

  test("a template with no <script> block is a hard error, not an empty suite", () => {
    expect(() =>
      H.renderTemplateJs(FIXTURES + "no-script.phtml.fixture"),
    ).toThrow(/no <script> block found/);
  });

  describe("escapeJs() is unwrapped, not swallowed by a catch-all", () => {
    // TWO-25238 wrapped a set of config values in escapeJs(). A catch-all rule
    // degraded every one of them to the fallback string, which made an API base
    // URL something new URL() rejects and left four other values meaningless
    // while their tests still passed. The value's own rule has to win however
    // the template escapes it.
    const rendered = () =>
      H.renderTemplateJs(FIXTURES + "escaped-config.phtml.fixture");

    test("a wrapped config value keeps its own test value", () => {
      expect(rendered()).toContain(
        "const apiUrl = 'https://checkout-api.test.invalid';",
      );
    });

    test("a (string) cast inside the wrapper does not hide the value", () => {
      expect(rendered()).toContain("const limit = '10';");
    });

    test("only an expression with no rule of its own falls back", () => {
      expect(rendered()).toContain(
        "const message = '" + H.ESCAPED_STRING + "';",
      );
    });

    test("no template renders a config value as the fallback string", () => {
      const templates = [
        H.GATEWAY_METHOD_TEMPLATE,
        H.COMPANY_NAME_TEMPLATE,
        H.SHIPPING_COMPANY_TEMPLATE,
        H.PAYMENT_FIELDS_TEMPLATE,
      ];
      templates.forEach(function (template) {
        const js = H.renderTemplateJs(template);
        [
          "checkoutApiUrl",
          "companySearchLimit",
          "isAddressSearchEnabled",
          "isCompanySearchEnabled",
          "isOrderIntentEnabled",
          "currentQuoteId",
        ].forEach(function (key) {
          expect(js).not.toContain(key + ": '" + H.ESCAPED_STRING + "'");
          expect(js).not.toContain(key + " : '" + H.ESCAPED_STRING + "'");
          expect(js).not.toContain(key + " = '" + H.ESCAPED_STRING + "'");
        });
      });
    });
  });

  describe.each([
    ["gateway_method-csp-js", H.GATEWAY_METHOD_TEMPLATE],
    ["companyName-csp-js", H.COMPANY_NAME_TEMPLATE],
    ["shipping_company", H.SHIPPING_COMPANY_TEMPLATE],
    ["company-name-payment", H.PAYMENT_FIELDS_TEMPLATE],
  ])("%s renders", (_label, template) => {
    test("with no PHP left in it, and parses as JavaScript", () => {
      const js = H.renderTemplateJs(template);

      expect(js).not.toContain("<?");
      // The PHP preamble and the trailing registerInlineScript() call are
      // outside the <script> block and must not reach the evaluator.
      expect(js).not.toContain("registerInlineScript");
      expect(js).not.toContain("declare(strict_types=1)");
      // Syntax-checks the rendered source without running it.
      expect(() => new Function(js)).not.toThrow();
    });
  });

  describe("markup rendering, for the Alpine attribute bindings", () => {
    // Component state bound to nothing has no user-visible effect, so a test
    // asserting on it can pass while the page is broken. That is a defect this
    // suite has actually shipped once (TWO-25253), and reading the binding out
    // of the markup template is what makes it detectable — which in turn means
    // these guarantees need pinning like the JS renderer's do.
    test("shares the JS renderer's hard error on an unmapped expression", () => {
      expect(() =>
        H.renderTemplateMarkup(FIXTURES + "unknown-tag.phtml.fixture"),
      ).toThrow(/no test value for PHP expression `\$somethingNobodyMapped`/);
    });

    test("strips <script> blocks, leaving only markup", () => {
      const markup = H.renderTemplateMarkup(H.GATEWAY_METHOD_MARKUP_TEMPLATE);

      expect(markup).not.toContain("<?");
      expect(markup).not.toContain("<script");
      expect(markup).toContain('data-name="company_id"');
    });

    test("a missing binding is a hard error, not a silent undefined", () => {
      expect(() =>
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_id"]',
          ":somethingNobodyBound",
        ),
      ).toThrow(/has no `:somethingNobodyBound` binding/);
    });

    test("an element the selector cannot find is a hard error", () => {
      expect(() =>
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          "input#nothing-like-this",
          ":readonly",
        ),
      ).toThrow(/no element matching/);
    });

    test("a binding that is not a bare property name is a hard error", () => {
      // The harness resolves a binding as `component[name]`, so that is all it
      // accepts — narrower ON PURPOSE than CSP-friendly Alpine, which looks the
      // whole expression up as a key and so happily evaluates the sibling
      // `x-show="!showManual"` against the `['!showManual']` getter in
      // gateway_method-csp-js.phtml. That binding is CSP-legal; it is just not
      // resolvable this way, which is why the guard rejects it here.
      expect(() =>
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_name"]',
          "@input.debounce.300ms",
        ),
      ).not.toThrow();
      expect(() =>
        H.readAlpineBinding(
          H.GATEWAY_METHOD_MARKUP_TEMPLATE,
          'input[data-name="company_id"]',
          "x-show",
        ),
      ).toThrow(/is not a bare property name/);
    });
  });

  test("the shared helpers are asserted to exist after loading, not assumed", () => {
    const env = H.installHyvaEnvironment();
    try {
      H.loadSharedHelpers();
      expect(typeof window.twoGatewayCompanySearch).toBe("function");
      expect(typeof window.twoGatewayCompanyDetail).toBe("function");
      expect(window.twoGatewayCompanySearchCache instanceof Map).toBe(true);
    } finally {
      env.restore();
    }
  });
});
