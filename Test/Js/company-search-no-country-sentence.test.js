/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-27226: every Hyvä surface that searches for a company tells a buyer who
 * has no country with the same standard sentence, as a toast.
 *
 * The harness resolves every `__()` to one constant, so the rule below answers
 * only the exact call form the templates must make. A surface still asking for
 * any other msgid toasts the harness constant instead, and its case fails.
 */

"use strict";

const H = require("./hyva-harness");

const NO_COUNTRY_SENTENCE =
  "Select your country above to search for your company.";

const RULES = [
  [
    /^__\('Select your country above to search for your company\.'\)$/,
    NO_COUNTRY_SENTENCE,
  ],
  // A quote that carries no country, so nothing but the DOM could supply one.
  [/^\$quoteDetails(Json)?$/, '{"quote_id":"test-quote-1"}'],
];

describe.each([
  {
    js: H.COMPANY_NAME_TEMPLATE,
    component: "twoGatewayHyvaCompanySearchField",
    description: "the address step",
  },
  {
    js: H.GATEWAY_METHOD_TEMPLATE,
    component: "twoGatewayHyvaPaymentMethodBase",
    description: "the payment tile",
  },
  {
    js: H.SHIPPING_COMPANY_TEMPLATE,
    component: "searchInput",
    description: "the address-book modal",
  },
])("no-country toast on $description", (surface) => {
  let env;
  let fetchStub;

  beforeEach(() => {
    // A country select the buyer has not chosen in: the store default is then
    // suppressed, so the country cannot be resolved.
    document.body.innerHTML = [
      '<select name="country_id"><option value="" selected></option></select>',
      '<input type="text" id="field" value="" />',
    ].join("\n");

    env = H.installHyvaEnvironment();
    fetchStub = H.stubFetch();
    jest.spyOn(console, "error").mockImplementation(() => {});

    H.loadSharedHelpers(RULES);
    H.loadTemplate(surface.js, RULES);
    env.fireAlpineInit();
  });

  afterEach(() => {
    fetchStub.restore();
    env.restore();
    jest.restoreAllMocks();
    document.body.innerHTML = "";
  });

  test("toasts the standard sentence once and searches nothing", async () => {
    const component = H.mountComponent(
      env.alpineComponents[surface.component],
      {
        el: document.getElementById("field"),
      },
    );

    await component.runCompanySearch("acme");
    await component.runCompanySearch("acmex");

    expect(component.countryCode).toBeFalsy();
    expect(fetchStub.searchCalls()).toHaveLength(0);
    expect(env.messages).toEqual([
      [{ type: "warning", text: NO_COUNTRY_SENTENCE }],
    ]);
  });
});
