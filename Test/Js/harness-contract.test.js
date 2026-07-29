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

  describe.each([
    ["gateway_method-csp-js", H.GATEWAY_METHOD_TEMPLATE],
    ["companyName-csp-js", H.COMPANY_NAME_TEMPLATE],
    ["shipping_company", H.SHIPPING_COMPANY_TEMPLATE],
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
