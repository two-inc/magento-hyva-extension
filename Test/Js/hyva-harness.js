/**
 * Copyright © Two.inc All rights reserved.
 * See COPYING.txt for license details.
 *
 * TWO-25245. Browser-JS-in-Jest harness for the Hyvä extension.
 *
 * This module's JS is neither AMD nor ESM nor even a `.js` file: it is an
 * inline `<script>` block inside a `.phtml` template, registered with Hyvä's
 * CSP helper and rendered into a page where Alpine, Magewire and Hyvä's own
 * `hyva` global already exist. There is nothing to `require()` — and Jest
 * cannot import a `.phtml` at all.
 *
 * Extracting the JS to a real `.js` file would be the clean answer, but that is
 * a production change, and PR #71 (TWO-25238, the CSP nonce fix) is open over
 * exactly these templates. So the harness does the extraction at TEST time
 * instead: it renders the template the way PHP would (minus PHP), pulls the
 * `<script>` bodies out, and evaluates them in global scope exactly as a
 * `<script>` tag would.
 *
 * No production code was changed to make this testable.
 *
 * The dangerous failure mode for an approach like this is silent degradation:
 * a template edit that the renderer no longer understands, leaving a suite that
 * passes because it is testing nothing. Every step below therefore throws
 * rather than skips — an unknown PHP tag, a leftover PHP tag, a template with
 * no `<script>` in it, and a load that did not produce the globals it should
 * are all hard errors.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Test-time stand-ins for the PHP short-echo tags in the templates.
 *
 * Keyed by a pattern matched against the tag's whitespace-collapsed inner
 * expression. Each value is substituted as raw text, so it has to be valid in
 * the JS context the tag sits in. Two tags are used in more than one context
 * and constrain their value:
 *
 *   - the quote JSON appears both bare (`const q = <?= $quoteDetailsJson ?>;`)
 *     and quoted (`quote: '<?= $quoteDetails ?>'`, later `JSON.parse`d), so the
 *     value must be a JSON object literal containing no single quotes;
 *   - `$gwBase` is spliced into identifiers (`<?= $gwBase ?>OnInit()`) as well
 *     as into strings, so it must be a bare identifier fragment.
 *
 * `getAlpineFnPrefix()` returns the brand prefix, so `$gwBase` is
 * `<prefix>GatewayHyva`; the vanilla prefix is `two`.
 */
const QUOTE_JSON =
  '{"quote_id":"test-quote-1","shipping_country_id":"GB","grand_total":100}';

/**
 * Fallback for an escapeJs()/escapeHtmlAttr() whose argument has no rule of its
 * own — the translated user-facing strings. Its output lands inside single
 * quotes in JS and inside double quotes in markup, so it must contain neither.
 */
const ESCAPED_STRING = "Escaped message";

const PHP_VALUE_RULES = [
  [/^\$gwBase$/, "twoGatewayHyva"],
  [/^\$brandedViewModel->getMethodCode\(\)$/, "two_payment"],
  // company-name-payment.phtml hoists the same value into a local.
  [/^\$methodCode$/, "two_payment"],
  // Order matters: the str_replace() wrapper has to be matched before the
  // bare getMagewireBlockName() rule below it.
  [/^str_replace\(.*getMagewireBlockName\(\).*\)$/, "two_payment"],
  [
    /^\$brandedViewModel->getMagewireBlockName\(\)$/,
    "checkout.payment.method.two_payment",
  ],
  [/^\$checkoutApiUrl$/, "https://api.test.invalid"],
  // The Magento link base URL `rest/V1/two/...` hangs off, with no trailing
  // slash — the template strips it, and a suite asserting on a built URL sees
  // the join.
  [/^\$restBaseUrl$/, "https://shop.test.invalid"],
  [/^\$soleTraderErrorMessage$/, ESCAPED_STRING],
  // Its own copy, not ESCAPED_STRING: its suite has to tell it apart.
  [/^\$companyRequiredMessage$/, "Select a company first"],
  // Emitted BARE as a JS boolean literal, not quoted like the neighbouring
  // config flags. `false` is the production default for a store that has not
  // turned address autopopulation on; the phone-autofill suite overrides it via
  // `extraRules`, which is what proves the gate reads the injected value.
  [/^\$isAddressAutopopulationEnabled$/, "false"],
  [/^\$companySearchLimit$/, "10"],
  // The min-characters threshold, emitted bare as an int rather than quoted.
  // Its default here matches production so the existing suites' queries keep
  // the same meaning; the min-chars suite overrides it via `extraRules` with a
  // DIFFERENT number, which is what proves the guards read the injected value
  // instead of a literal that happened to agree with it.
  [/^\(int\) \$companySearchMinChars$/, "3"],
  [/^\$isOrderIntentEnabled$/, "1"],
  [/^\$isAddressSearchEnabled$/, "1"],
  [/^\$isCompanySearchEnabled$/, "1"],
  [/^\$currentQuoteId$/, "test-quote-1"],
  [/^\$currentStoreId$/, "1"],
  [/^\$configModel->getIs[A-Za-z]+Enabled\(\)$/, "1"],
  [/^\$merchantId$/, "test-merchant-id"],
  [/^\$merchantName$/, "Example Shop"],
  [/^\$orderIntentConfig\[.*\]$/, "test"],
  [/^\$quoteDetails(Json)?$/, QUOTE_JSON],
  // Bare, not quoted: json_encode() of a string yields a JSON string literal.
  // The optional `?: …` tail is the fallback for json_encode() returning false;
  // TWO-25238 added it so a malformed byte cannot make the template emit nothing
  // where a value belongs.
  [
    /^json_encode\(\s*\$orderIntentApprovedNotice[\s\S]*?\)(?:\s*\?:\s*\S+)?$/,
    '"Approved"',
  ],
  // Sibling of the rule above (TWO-25326 §7.2/§7.3), defaulted to 'null'
  // (brand switched off) rather than a fake copy object: every pre-existing
  // suite in this directory predates this getter and exercises the APPROVED
  // path only, several by overriding `orderIntentApprovedNoticeCopy` directly
  // without a matching `orderIntentNotAvailableCopy` override — a truthy
  // placeholder here would make resolveOrderIntentNotAvailableNotice() read
  // `.withCompany` off a bare string and throw. Suites that need this getter
  // live override it via extraRules or by assigning the property directly.
  [
    /^json_encode\(\s*\$orderIntentNotAvailableNotice[\s\S]*?\)(?:\s*\?:\s*\S+)?$/,
    "null",
  ],
  [/^\$escaper->escapeUrl\(.*\)$/, "/checkout"],
  // Markup-only values, for renderTemplateMarkup() over gateway_method.phtml.
  // `__()` resolves explicitly rather than falling through the escapeHtmlAttr
  // unwrapper to the same place, so the table names every expression it
  // answers instead of relying on a default.
  [/^__\(.*\)$/, ESCAPED_STRING],
  [/^\$brandedViewModel->getFormId\(\)$/, "two_payment_form"],
  [/^\$configModel->getCheckoutSubtitleHtml\(\)$/, ""],
  [/^\$(errorMessage|paymentTermsMessage|termsNotAcceptedMessage)$/, "Message"],
  // The sole-term chip's format string and day count get values of their own,
  // ahead of the shared group below. Folding them in with `$pluralLabel` and
  // `$singularLabel` gave the chip four attributes carrying the identical
  // literal `day`, which made a test that reads one of them unable to tell it
  // apart from the others — so sourcing an attribute from the WRONG variable,
  // the actual defect TWO-25266 fixes, rendered a green suite.
  [/^\$singleLabel$/, "Payment Terms %1 days"],
  [/^\$singleDay$/, "30"],
  [/^\$(pluralLabel|singularLabel)$/, "day"],
  [/^\(int\) \$days$/, "14"],
  // Markup-only values for renderTemplateMarkup() over companyName.phtml, whose
  // chrome comes from Hyva Checkout's form-element renderer rather than from
  // literal markup. They resolve to '' because nothing asserts on the rendered
  // label, tooltip or wrapper — only on the Alpine bindings this module adds
  // around them. `renderClass()` lands inside a `class="…"` attribute and
  // `renderAttributes()` between attributes, so both must stay attribute-safe.
  [/^\$renderer->render(Label|Before)\(\$element\)$/, ""],
  // The normalizer collapses whitespace but keeps it, and this template breaks
  // the chained call across lines, so the spaces are optional in the pattern.
  [/^\$element ?->getRenderer\(\) ?->render(Tooltip|After)\(\$element\)$/, ""],
  [/^\$element->renderClass\([\s\S]*\)$/, "form-input"],
  [/^\$element->renderAttributes\(\$escaper\)$/, 'name="company"'],
  // form/field/company-search-control.phtml's contract (TWO-25326, 2026-08-05):
  // the ONE company-search control, included by BOTH the address step and the
  // payment tile. Its three parameters are the only thing that differs between
  // the two mount points, so they resolve here to one value that satisfies both
  // surfaces' selectors — the address step's `form-input` from Hyva's field
  // renderer AND the tile's `company_name` hook, plus the canonical
  // id/name/validation the tile supplies.
  //
  // A suite that needs the other surface's exact value overrides it through
  // `extraRules`, the same way the min-chars suite overrides the threshold.
  [/^\$twoControlAlpineData$/, 'x-data="twoGatewayHyvaCompanySearchField"'],
  [/^\$twoControlInputClass$/, "form-input company_name"],
  [
    /^\$twoControlInputAttributes$/,
    'id="company_name" name="payment[company_name]" data-name="company_name"' +
      " required data-validate='{\"required\":true}'",
  ],
];

/**
 * `include $block->getTemplateFile('Two_GatewayHyva::…')` — the mechanism the
 * ONE company-search control is mounted with at both of its mount points.
 *
 * Matched as a whole `<?php … ?>` block, because the block carrying the include
 * also carries the `$twoControl*` assignments that parameterise it, and neither
 * is anything this harness evaluates. `(?:(?!\?>)[\s\S])` rather than a lazy
 * `[\s\S]*?` so a match can never span a `?>` and swallow an unrelated earlier
 * block along with it.
 */
const TEMPLATE_INCLUDE_PATTERN =
  /<\?php(?:(?!\?>)[\s\S])*?include\s+\$block->getTemplateFile\(\s*['"]Two_GatewayHyva::([^'"]+)['"]\s*,?\s*\)\s*;?(?:(?!\?>)[\s\S])*\?>/g;

/**
 * Resolve a normalized PHP expression to its test value, or null if no rule
 * applies.
 *
 * escapeJs() is unwrapped rather than matched by a catch-all. TWO-25238 wrapped
 * a set of config values in escapeJs() and a catch-all silently degraded every
 * one of them to the literal `ESCAPED_STRING`, which turned an API base URL into
 * a value `new URL()` rejects and left four other tests exercising a meaningless
 * string while still passing. Unwrapping keeps each value's own rule
 * authoritative no matter how it is escaped at the call site, so adding
 * escaping to a template can never again change what the suite tests.
 *
 * @param {string} expression whitespace-collapsed inner expression
 * @param {Array<[RegExp, string]>} rules
 * @returns {string|null}
 */
function resolveExpression(expression, rules) {
  for (let i = 0; i < rules.length; i += 1) {
    if (rules[i][0].test(expression)) {
      return rules[i][1];
    }
  }

  // htmlspecialchars() is unwrapped AND applied: it is used in the markup
  // template to put the quote JSON into an attribute, so the entity-escaped
  // quotes are what keeps the rendered markup parseable — exactly as in the
  // page. Resolving it to a blank would leave a `"` mid-attribute and silently
  // truncate the element the test then queries.
  const htmlSpecialChars =
    /^htmlspecialchars\(\s*([\s\S]*?)\s*,[\s\S]*\)$/.exec(expression);
  if (htmlSpecialChars !== null) {
    const resolved = resolveExpression(htmlSpecialChars[1], rules);

    return (resolved === null ? ESCAPED_STRING : resolved).replace(
      /"/g,
      "&quot;",
    );
  }

  // escapeHtml / escapeHtmlAttr unwrap the same way escapeJs does, and for the
  // same reason: the escaping applied at the call site must not decide what the
  // suite is testing.
  const escaped =
    /^\$escaper->escape(?:Js|Html|HtmlAttr)\(\s*([\s\S]*?)\s*\)$/.exec(
      expression,
    );
  if (escaped !== null) {
    // Drop a `(string)` cast the template may apply before escaping.
    const inner = escaped[1].replace(/^\(string\)\s*/, "");
    const resolved = resolveExpression(inner, rules);

    return resolved === null ? ESCAPED_STRING : resolved;
  }

  return null;
}

/**
 * Collapse a PHP tag's inner expression to a single line for matching.
 *
 * Strips `/* … *\/` comments (`<?= /* @noEscape *\/ json_encode(…) ?>` is a
 * real tag in gateway_method-csp-js.phtml) and the trailing comma PHP allows
 * before a closing paren.
 *
 * @param {string} raw the text between `<?=` and `?>`
 * @returns {string}
 */
function normalizeExpression(raw) {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .replace(/,\s*\)/g, ")")
    .trim();
}

/**
 * Resolve `<?php if ((!)$isCompanySearchInPaymentTile...): ?> A [<?php else: ?>
 * B] <?php endif ...?>` blocks, keeping only the winning branch's literal
 * markup and discarding the rest — BEFORE the naive "drop every `<?php ...
 * ?>` tag" pass below, which has no concept of a condition at all and would
 * otherwise render BOTH branches concatenated (TWO-25326 §7.1 introduced the
 * first genuine either/or branches in these templates; every prior `<?php if
 * ?>` in this codebase has no competing `else`, so always-both-branches was
 * never visible before).
 *
 * Deliberately narrow: it only recognises blocks whose OPENING condition
 * names this one flag. Every other conditional in a template — `$showChip`,
 * `hasTooltip()`, `getOrderIntentApprovedNotice() !== null`, and so on — is
 * left completely untouched by this function and falls through to the
 * existing naive strip exactly as before, so this cannot change what any
 * pre-existing suite renders.
 *
 * Nesting-aware: a nested `<?php if (...): ?> ... <?php endif ?>` inside the
 * winning branch (e.g. companyName.phtml's fallback field still has
 * `$element->hasAttributes()` / `isRequired()` guards inside it) is walked
 * over by depth-counting rather than matched as this call's own endif, and is
 * left in the winning branch's text for the ordinary naive strip afterward —
 * unchanged from how it already renders today.
 *
 * @param {string} source the raw template text
 * @param {boolean} isPaymentTile resolved value of $isCompanySearchInPaymentTile
 * @param {string} relPath for error messages
 * @returns {string}
 */
function resolveCompanySearchLocationConditionals(
  source,
  isPaymentTile,
  relPath,
) {
  const openTagRe =
    /<\?php\s+if\s*\(\s*(!?)\s*\$isCompanySearchInPaymentTile\b[^)]*\)\s*:\s*\?>/;
  const tokenRe =
    /<\?php\s+(if\s*\([\s\S]*?\)\s*:|else\s*:|endif\b[\s\S]*?)\s*\?>/g;

  let openMatch;
  // eslint-disable-next-line no-cond-assign
  while ((openMatch = openTagRe.exec(source)) !== null) {
    const negated = openMatch[1] === "!";
    const condTrue = negated ? !isPaymentTile : isPaymentTile;
    const openStart = openMatch.index;
    const openEnd = openMatch.index + openMatch[0].length;

    tokenRe.lastIndex = openEnd;
    let depth = 0;
    let elseStart = -1;
    let elseEnd = -1;
    let endifStart = -1;
    let endifEnd = -1;
    let tok;
    // eslint-disable-next-line no-cond-assign
    while ((tok = tokenRe.exec(source)) !== null) {
      const body = tok[1];
      if (/^if\s*\(/.test(body)) {
        depth += 1;
      } else if (/^else\s*:/.test(body)) {
        if (depth === 0 && elseStart === -1) {
          elseStart = tok.index;
          elseEnd = tok.index + tok[0].length;
        }
      } else if (/^endif\b/.test(body)) {
        if (depth === 0) {
          endifStart = tok.index;
          endifEnd = tok.index + tok[0].length;
          break;
        }
        depth -= 1;
      }
    }

    if (endifStart === -1) {
      throw new Error(
        "harness: unmatched `<?php if (...$isCompanySearchInPaymentTile...) ?>` " +
          "(no matching endif found) in " +
          relPath,
      );
    }

    let winningContent;
    if (elseStart !== -1) {
      winningContent = condTrue
        ? source.slice(openEnd, elseStart)
        : source.slice(elseEnd, endifStart);
    } else {
      winningContent = condTrue ? source.slice(openEnd, endifStart) : "";
    }

    source =
      source.slice(0, openStart) + winningContent + source.slice(endifEnd);
    // Restart the outer search: content shifted, and there may be a sibling
    // (non-nested) block further down the same file.
    openTagRe.lastIndex = 0;
  }

  return source;
}

/**
 * Substitute a `.phtml` template's PHP the way PHP would, minus the PHP.
 *
 * The shared step behind renderTemplateJs() and renderTemplateMarkup(), so the
 * markup half of a template gets the same fail-loud substitution — and the same
 * `PHP_VALUE_RULES` table — as its `<script>` half.
 *
 * @param {string} relPath repo-relative template path
 * @param {Array<[RegExp, string]>} [extraRules] per-test rules, tried first
 * @returns {string} the rendered template
 */
function renderTemplate(relPath, extraRules) {
  const absPath = path.join(REPO_ROOT, relPath);
  let source = fs.readFileSync(absPath, "utf8");

  const rules = (extraRules || []).concat(PHP_VALUE_RULES);

  // TWO-25326 §7.1: resolve the one flag this harness understands
  // conditionally, and cut the losing branch of any block gated on it, BEFORE
  // the naive "every `<?php ?>` emits nothing" pass a few lines down — which
  // has no concept of true/false and would otherwise keep both branches.
  //
  // Default is PER-FILE, not one shared value, and that is deliberate rather
  // than an inconsistency: every pre-existing suite over EITHER template was
  // written against the pre-ruling code, where both templates' rich controls
  // existed unconditionally and simultaneously — companyName.phtml's suites
  // assume the address-area control is the live one, gateway_method*.phtml's
  // assume the tile's own is. Production's actual default (address-area) is
  // exactly companyName.phtml's assumption, so that file needs no override at
  // all; gateway_method*.phtml's suites are, after this ruling, exercising the
  // NON-default (payment_tile) configuration — a real, intentional trade so
  // their large existing coverage of that control's own behaviour did not
  // need rewriting. `extraRules` can still override either default per test.
  if (source.indexOf("$isCompanySearchInPaymentTile") !== -1) {
    const override = extraRules
      ? resolveExpression("$isCompanySearchInPaymentTile", extraRules)
      : null;
    const isPaymentTile =
      override !== null
        ? override === "1"
        : relPath.indexOf("form/field/companyName.phtml") === -1;
    source = resolveCompanySearchLocationConditionals(
      source,
      isPaymentTile,
      relPath,
    );
  }

  // Splice in any INCLUDED template before the naive strip below, which has no
  // concept of an include and would drop the control the page actually renders —
  // leaving a suite that asserts on markup nothing emitted. Recursive through
  // renderTemplate(), so the partial gets the same fail-loud substitution as its
  // caller, and it is the real shipped file rather than a hand-copied excerpt.
  source = source.replace(
    TEMPLATE_INCLUDE_PATTERN,
    function (_match, included) {
      return renderTemplate("view/frontend/templates/" + included, extraRules);
    },
  );

  // `<?php … ?>` blocks are the template's PHP preamble and its trailing
  // registerInlineScript() call — they emit nothing, so they are dropped
  // whole rather than substituted.
  source = source.replace(/<\?php[\s\S]*?\?>/g, "");
  source = source.replace(/<\?=([\s\S]*?)\?>/g, function (_match, raw) {
    const expression = normalizeExpression(raw);
    const resolved = resolveExpression(expression, rules);
    if (resolved !== null) {
      return resolved;
    }
    throw new Error(
      "harness: no test value for PHP expression `" +
        expression +
        "` in " +
        relPath +
        ". Add a rule to PHP_VALUE_RULES (or pass one via extraRules) — this throws " +
        "rather than substituting a blank so a template change cannot quietly " +
        "reduce the suite to testing nothing.",
    );
  });

  if (source.indexOf("<?") !== -1) {
    throw new Error("harness: unsubstituted PHP tag left in " + relPath);
  }

  return source;
}

/**
 * Render a `.phtml` template's inline JS the way PHP would, minus the PHP.
 *
 * @param {string} relPath repo-relative template path
 * @param {Array<[RegExp, string]>} [extraRules] per-test rules, tried first
 * @returns {string} the concatenated `<script>` bodies
 */
function renderTemplateJs(relPath, extraRules) {
  const source = renderTemplate(relPath, extraRules);

  // Attributes are discarded, which is also how a `<script nonce="…">` from
  // the CSP work stays invisible to this harness.
  const blocks = [];
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let match = scriptPattern.exec(source);
  while (match !== null) {
    blocks.push(match[1]);
    match = scriptPattern.exec(source);
  }
  if (blocks.length === 0) {
    throw new Error("harness: no <script> block found in " + relPath);
  }
  return blocks.join("\n");
}

/**
 * Render a `.phtml` template's MARKUP the way PHP would, minus the PHP and
 * minus its `<script>` blocks.
 *
 * Exists so a test can assert on an Alpine attribute binding — which lives in
 * the markup template, not in the `-csp-js` one — against the real shipped
 * file. Component state that is bound to nothing has no user-visible effect,
 * and reading the binding out of the template is what makes a test able to fail
 * when the binding is missing. Same fail-loud substitution as the JS half: an
 * unknown or leftover PHP tag throws.
 *
 * @param {string} relPath repo-relative template path
 * @param {Array<[RegExp, string]>} [extraRules] per-test rules, tried first
 * @returns {string} the rendered markup
 */
function renderTemplateMarkup(relPath, extraRules) {
  return renderTemplate(relPath, extraRules).replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/g,
    "",
  );
}

/**
 * Read one element's Alpine attribute binding out of a rendered markup
 * template, the way CSP-friendly Alpine would.
 *
 * The CSP Alpine build Hyvä ships evaluates only a property lookup in an
 * attribute expression — no operators, no object literals. It looks the WHOLE
 * expression up as a key on the component, which is why
 * gateway_method-csp-js.phtml can define an `['!showManual']` getter and have
 * `x-show="!showManual"` resolve to it: that binding is perfectly CSP-legal.
 *
 * This helper is deliberately NARROWER than CSP Alpine, and the check is the
 * harness's own contract rather than a statement about CSP. It requires **a
 * bare property name** — so a test can resolve the binding off a mounted
 * component and assert on the value the page would get. Whether the component
 * actually HAS that property is a separate check, made at runtime by each
 * suite's own binding-application helper.
 * It therefore also rejects two things CSP Alpine itself accepts: a dotted path
 * (`foo.bar`), and a getter key that is not a valid identifier
 * (`!showManual`). Both would need a different resolution strategy than
 * `component[name]`; neither is what any binding under test uses.
 *
 * @param {string} relPath repo-relative markup template path
 * @param {string} selector CSS selector for the bound element
 * @param {string} attribute the Alpine binding, e.g. `:disabled`
 * @param {Array<[RegExp, string]>} [extraRules]
 * @returns {string} the bound property name
 */
function readAlpineBinding(relPath, selector, attribute, extraRules) {
  const markup = renderTemplateMarkup(relPath, extraRules);
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const element = doc.querySelector(selector);
  if (element === null) {
    throw new Error(
      "harness: no element matching `" + selector + "` in " + relPath,
    );
  }

  const expression = element.getAttribute(attribute);
  if (expression === null) {
    throw new Error(
      "harness: `" +
        selector +
        "` in " +
        relPath +
        " has no `" +
        attribute +
        "` binding. Component state bound to nothing has no effect on the " +
        "page, so this throws rather than letting a test assert on it.",
    );
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expression)) {
    throw new Error(
      "harness: `" +
        attribute +
        '="' +
        expression +
        '"` is not a bare property name. This harness ' +
        "resolves a binding as `component[name]`, so it accepts only that — " +
        "narrower on purpose than CSP-friendly Alpine, which also looks up " +
        "dotted paths and non-identifier getter keys such as `!showManual`.",
    );
  }

  return expression;
}

/**
 * Evaluate template JS in global scope, exactly as a `<script>` tag would.
 *
 * `indirectEval` keeps evaluation global, so a top-level `function foo() {}`
 * lands on `globalThis` and the file's free references to `hyva`, `Alpine` and
 * `window` resolve to the stubs installed by `installHyvaEnvironment()`.
 *
 * @param {string} relPath repo-relative template path
 * @param {Array<[RegExp, string]>} [extraRules]
 * @returns {void}
 */
function loadTemplate(relPath, extraRules) {
  const indirectEval = eval;
  indirectEval(renderTemplateJs(relPath, extraRules));
}

const GATEWAY_METHOD_TEMPLATE =
  "view/frontend/templates/component/payment/method/gateway_method-csp-js.phtml";
/** The markup half of the same component — Alpine attribute bindings live here. */
const GATEWAY_METHOD_MARKUP_TEMPLATE =
  "view/frontend/templates/component/payment/method/gateway_method.phtml";
const COMPANY_NAME_MARKUP_TEMPLATE =
  "view/frontend/templates/form/field/companyName.phtml";
const COMPANY_NAME_TEMPLATE =
  "view/frontend/templates/form/field/companyName-csp-js.phtml";
const SHIPPING_COMPANY_TEMPLATE =
  "view/frontend/templates/component/payment/method/shipping_company.phtml";
const PAYMENT_FIELDS_TEMPLATE =
  "view/frontend/templates/js/payment/company-name-payment.phtml";

/**
 * The company-selection storage key AS THE TEMPLATES BUILD IT.
 *
 * The blob is keyed per store view — `shipping_company_selection:<store_id>` —
 * and the suffix here has to track the `$currentStoreId` rule in
 * PHP_VALUE_RULES above, which is why both live in this file rather than being
 * spelled out in each test.
 */
const COMPANY_SELECTION_KEY = "shipping_company_selection:1";

/**
 * The BILLING company's storage key AS THE TEMPLATES BUILD IT (TWO-25326).
 *
 * A second, separately scoped record, written only by the payment tile. The
 * split exists because the checkout can hold two different companies at once —
 * shipping, and a different billing one once "billing same as shipping" is
 * unticked — and one record cannot describe both.
 */
const BILLING_COMPANY_KEY = "billing_company_selection:1";

/**
 * The globals gateway_method-csp-js.phtml publishes for the other pickers.
 */
const SHARED_HELPER_GLOBALS = [
  "twoGatewayGetCountryCode",
  "twoGatewayIsDegradedResponse",
  "twoGatewayCompanySearch",
  "twoGatewayCompanyDetail",
  "twoGatewayCompanySearchCache",
  "TWO_GATEWAY_COMPANY_SEARCH_TIMEOUT_MS",
  // The popover's translated copy, and the per-mount field counter beside it.
  // Same `window.X = window.X || …` shape as the cache below, so without these
  // the FIRST test in a file wins the panel's strings for every later one and
  // any assertion on them is silently order-dependent.
  "twoGatewayPanelStrings",
  "twoGatewayCompanyFieldSeq",
  "twoGatewayCompanyPanels",
  "twoGatewayCompanyMounts",
  // The per-store company-selection accessor. Listed for the same reason as the
  // cache above: these are assigned as `window.X = window.X || …`, which is
  // correct in production (the publisher can render once per payment method and
  // only the first assignment should win) but would otherwise carry the FIRST
  // test file's copy — and the store id baked into its key — into every later
  // one.
  "TWO_GATEWAY_COMPANY_SELECTION_STORE",
  "TWO_GATEWAY_COMPANY_SELECTION_KEY",
  "twoGatewayReadCompanySelection",
  "twoGatewayWriteCompanySelection",
  // TWO-25326 rebuild: the ONE shared company-search engine every surface's
  // Alpine component composes with. Listed for the same leak-between-tests
  // reason as its neighbours: `window.X = window.X || …`.
  "twoGatewayCompanySearchEngine",
  // The control layered over that engine (TWO-25326, 2026-08-05) and the ONE
  // placeholder-identifier display filter — same `window.X = window.X || …`
  // idiom, same leak-between-files reason.
  "twoGatewayCompanySearchControl",
  "twoGatewayDisplayCompanyNumber",
  // The billing-scoped accessors, listed for exactly the same reason: they use
  // the same `window.X = window.X || …` idiom, so without resetting them the
  // first test file's key — and its store id — would leak into every later one.
  "TWO_GATEWAY_BILLING_COMPANY_KEY",
  "twoGatewayReadBillingCompany",
  "twoGatewayWriteBillingCompany",
  "twoGatewayClearBillingCompany",
  "twoGatewayIsBillingAsShipping",
  // The country-resolution trio (2026-08-06). Same `window.X = window.X || …`
  // idiom as everything above, so the same leak-between-files reason to reset
  // them — and listing them also makes assertSharedHelperGlobals() check the
  // template actually published them.
  "twoGatewayCountryFieldUsable",
  "twoGatewayCountryFields",
  "twoGatewayHasCountrySelector",
  // The form-scoping half of that resolution (TWO-25461): which form is asking,
  // what that form's own country fields are, and — for a caller in no address
  // form at all — which address holds the invoice role. Same idiom, same reset
  // reason.
  "twoGatewayCountryFieldsWithin",
  "twoGatewayCountryFieldScope",
  "twoGatewayInvoiceRoleCountryField",
  // The content-match sync pin (TWO-25461 §2). Same `window.X = window.X || …`
  // idiom as everything above, so the same leak-between-files reason to reset
  // them, and listing them also asserts the template really publishes them —
  // company-name-payment.phtml consults the pin through `window`.
  "twoGatewayAddressMirrorFields",
  "twoGatewayIsBillingAddressPinned",
  // The sole-trader helpers (TWO-25503). Same `window.X = window.X || …` idiom
  // as everything above, so the same leak-between-files reason to reset them —
  // and the per-country memo especially: a country answered in one file's
  // fixture would otherwise decide the next file's mode tab with no request
  // ever going out.
  "TWO_GATEWAY_SUPPORTED_COMPANY_TYPES",
  "twoGatewaySupportedCompanyTypes",
  "twoGatewaySoleTraderTokens",
  "twoGatewayAutofillBuyer",
  "twoGatewaySoleTraderSignupUrl",
  "twoGatewayInvoiceRoleAddressForm",
];

/**
 * Load the shared company-search helpers.
 *
 * They live in gateway_method-csp-js.phtml but are hung off `window` precisely
 * so the other two pickers can use them, which is why the whole template is
 * evaluated rather than a hand-copied excerpt.
 *
 * @returns {void}
 */
function loadSharedHelpers(extraRules) {
  loadTemplate(GATEWAY_METHOD_TEMPLATE, extraRules);
  SHARED_HELPER_GLOBALS.forEach(function (name) {
    if (window[name] === undefined) {
      throw new Error("harness: " + name + " was not exported onto window");
    }
  });
}

/**
 * The two nodes the real panel puts around a field it has taken: a wrapper it
 * builds, and the panel inside it. Class names are the base plugin's, because a
 * morph is recognised by what it DELETES.
 *
 * @param {HTMLElement} field
 * @returns {HTMLElement} the panel node
 */
function wrapField(field) {
  let wrap = field.parentElement;
  if (!wrap || !wrap.classList.contains("two-company-field-wrap")) {
    wrap = document.createElement("span");
    wrap.className = "two-company-field-wrap";
    field.parentNode.insertBefore(wrap, field);
    wrap.appendChild(field);
  }
  let panel = wrap.querySelector(".two-company-dropdown");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "two-company-dropdown";
    wrap.appendChild(panel);
  }
  return panel;
}

/**
 * Install the globals Hyvä, Alpine and Magewire supply at runtime.
 *
 * Deliberately small: these are third-party globals with no npm distribution
 * available to this repo (Hyvä checkout is a commercial package — the same
 * reason CI stubs it for `setup:di:compile`), so a stub is the only option here.
 * The code under test is ours; only its surroundings are faked.
 *
 * @returns {Object} handles for asserting on what the code under test did
 */
/**
 * Stand in for the base plugin's `company-search-panel.js`.
 *
 * That file is the popover, and it is NOT in this repo — it ships in
 * two-inc/magento2 and the checkout loads it from `Two_Gateway::`. There is no
 * copy here to load and no vendor tree in CI, so what this repo can test is its
 * own half of the contract: the options the adapter hands the panel, and the
 * six-member search API it builds over the engine. The panel's own behaviour —
 * the DOM it builds, its open/close, its keyboard handling — is covered by
 * magento-plugin's suite, against the real file.
 *
 * Recording, not inert: a test asserts what the adapter passed, so a stub that
 * silently swallowed its options would make every such assertion vacuous.
 *
 * @returns {Object} `{ instances }`, newest last
 */
function installCompanyPanelStub() {
  const instances = [];

  function CompanySearchPanelStub(options) {
    this.options = options || {};
    this.fieldSelector = this.options.fieldSelector;
    this.calls = [];
    this.opened = false;
    instances.push(this);
  }

  ["releaseField", "reclaimField", "setDisplayText", "destroy"].forEach(
    function (name) {
      CompanySearchPanelStub.prototype[name] = function () {
        this.calls.push(name);
      };
    },
  );
  // The real teardown takes its panel out of the wrapper, which is what makes
  // the next instance build fresh instead of adopting a dead one's DOM.
  CompanySearchPanelStub.prototype.destroy = function () {
    this.calls.push("destroy");
    if (this._panel) this._panel.remove();
    this._panel = null;
  };

  /*
   * The real panel's predicate, not a constant: a stub that always says "bound"
   * agrees with the adapter in exactly the direction that hides a morph having
   * deleted the wrapper (TWO-25503).
   */
  CompanySearchPanelStub.prototype.isBound = function () {
    return Boolean(
      this._field &&
        this._field.isConnected &&
        this._panel &&
        this._panel.isConnected &&
        this._field.parentElement === this._panel.parentElement,
    );
  };
  /*
   * Resolves ONCE, at bind, and remembers — exactly as the real panel does
   * (`_attach` stores the node, `getField()` returns `this._field`). Resolving
   * fresh on every call would answer for whatever currently matches the
   * selector, which is not the node this panel is attached to, and would report
   * an orphan as reaped where production would not.
   *
   * One divergence remains, deliberately: the real `bind()` only overwrites
   * `_field` when the selector matches something, where this assigns
   * unconditionally — so a bind matching nothing nulls the stub's field while
   * production keeps the previous node. That yields a false RED in the reaper,
   * never a false GREEN. Do not "fix" it by resolving lazily; that is the
   * direction that hides a leak.
   */
  CompanySearchPanelStub.prototype.bind = function () {
    this.calls.push("bind");
    this._field = document.querySelector(this.fieldSelector);
    this._panel = this._field ? wrapField(this._field) : null;
  };
  CompanySearchPanelStub.prototype.getField = function () {
    return this._field ? [this._field] : [];
  };
  /*
   * Records the STATE the chips were repainted for, not just that they were.
   *
   * A bare call name cannot tell a sync that ran before a mode change from one
   * that ran after it, and that ordering is the defect. The mode alone is not
   * enough either: a country withdrawing sole trader changes which chips are
   * OFFERED without changing which is selected, so visibility is recorded too.
   */
  CompanySearchPanelStub.prototype.syncChips = function () {
    this.calls.push(
      "syncChips:" +
        this.options.getSelectedMode() +
        ":" +
        (this.options.isChipVisible("soletrader") ? "st" : "-"),
    );
  };
  // Open/close move a flag rather than only recording, because callers ASK:
  // the order-intent box refuses to paint a verdict under an open panel, and a
  // stub that always answered shut would let that rule pass untested.
  CompanySearchPanelStub.prototype.open = function () {
    this.calls.push("open");
    this.opened = true;
  };
  CompanySearchPanelStub.prototype.close = function () {
    this.calls.push("close");
    this.opened = false;
  };
  CompanySearchPanelStub.prototype.isOpen = function () {
    return this.opened;
  };
  CompanySearchPanelStub.prototype.abortActiveRequest = function () {
    this.calls.push("abortActiveRequest");
    return false;
  };

  window.TwoCompanySearchPanel = CompanySearchPanelStub;
  return { instances: instances };
}

function installHyvaEnvironment() {
  const storage = {};
  const browserStorage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(storage, key)
        ? storage[key]
        : null;
    },
    setItem: function (key, value) {
      storage[key] = String(value);
    },
    removeItem: function (key) {
      delete storage[key];
    },
  };

  const hyva = {
    getBrowserStorage: function () {
      return browserStorage;
    },
    formValidation: function () {
      return {
        validate: function () {
          return Promise.resolve(true);
        },
      };
    },
  };

  const alpineComponents = {};
  const alpineStores = {};
  const Alpine = {
    data: function (name, factory) {
      alpineComponents[name] = factory;
    },
    store: function (name, value) {
      if (arguments.length > 1) {
        alpineStores[name] = value;
        return value;
      }
      return alpineStores[name];
    },
  };

  const messages = [];
  const dispatchMessages = function (payload) {
    messages.push(payload);
  };

  // The magewire loader is a boolean overlay, not a counter: the ORDER of
  // these events is the whole subject of shipping-company-loader.test.js, so
  // record them as a sequence rather than as two counts.
  const loaderEvents = [];
  const onLoaderStart = function () {
    loaderEvents.push("start");
  };
  const onLoaderDone = function () {
    loaderEvents.push("done");
  };
  window.addEventListener("magewire:loader:start", onLoaderStart);
  window.addEventListener("magewire:loader:done", onLoaderDone);

  global.hyva = hyva;
  window.hyva = hyva;
  global.Alpine = Alpine;
  window.Alpine = Alpine;
  window.dispatchMessages = dispatchMessages;

  // The checkout loads this from the base plugin; every component that mounts
  // the company control reaches for it in init(), so it has to be here or that
  // path degrades to its console.error branch in every test.
  const companyPanel = installCompanyPanelStub();

  /*
   * Magewire's re-render hooks. Only `hook()` is stubbed, because that is the
   * whole of the API this module uses: it registers callbacks and Magewire runs
   * them, several times, once per element a re-render touched.
   */
  const magewireHooks = {};
  window.Magewire = {
    hook: function (name, handler) {
      (magewireHooks[name] = magewireHooks[name] || []).push(handler);
    },
  };

  return {
    hyva: hyva,
    storage: storage,
    browserStorage: browserStorage,
    Alpine: Alpine,
    alpineComponents: alpineComponents,
    alpineStores: alpineStores,
    messages: messages,
    loaderEvents: loaderEvents,
    /** Panels the code under test built, newest last. */
    companyPanels: companyPanel.instances,
    /** Fire the event Alpine fires once it is ready. */
    fireAlpineInit: function () {
      document.dispatchEvent(new Event("alpine:init"));
    },
    /**
     * Run one re-render's worth of a Magewire hook.
     *
     * @param {string} name the hook, e.g. `element.updated`
     * @param {number} [times] elements the re-render touched, default 1
     */
    fireMagewireHook: function (name, times) {
      const handlers = magewireHooks[name] || [];
      for (let run = 0; run < (times || 1); run++) {
        handlers.slice().forEach(function (handler) {
          handler();
        });
      }
    },
    /**
     * Undo everything installed here, plus the shared helpers themselves.
     *
     * The helpers are assigned as `window.X = window.X || …`, which is
     * correct in production (three templates each define them and only the
     * first assignment should win) but would carry the FIRST test's copy —
     * and its populated cache — into every later test in the file.
     */
    restore: function () {
      window.removeEventListener("magewire:loader:start", onLoaderStart);
      window.removeEventListener("magewire:loader:done", onLoaderDone);
      delete window.dispatchMessages;
      delete global.hyva;
      delete global.Alpine;
      delete window.hyva;
      delete window.Alpine;
      delete window.TwoCompanySearchPanel;
      delete window.Magewire;
      // Not in SHARED_HELPER_GLOBALS: it exists only once a hook has actually
      // been registered, so the export check there would fail on it — and left
      // behind it would tell every later file's first mount that the hook was
      // already in place, with the previous file's Magewire holding it.
      delete window.twoGatewayCompanyMorphHooked;
      delete window.twoGatewayCompanyMorphDeferred;
      SHARED_HELPER_GLOBALS.forEach(function (name) {
        delete window[name];
        delete global[name];
      });
    },
  };
}

/**
 * Instantiate an Alpine component factory and attach four magic properties:
 * `$el`, `$root` and `$nextTick`, which Alpine injects, and `$wire`, which is
 * Magewire's, injected by Hyvä's Magewire integration rather than by Alpine.
 *
 * The components are plain object literals with method shorthand, so calling
 * `component.getItems()` binds `this` the same way Alpine's proxy does.
 *
 * The factory is invoked with these magics bound as `this`, because
 * `twoGatewayHyvaPaymentFormWithValidation` reads `this.$el` and `this.$wire`
 * while it COMPOSES, not later, so a factory called with no receiver would
 * compose against the wrong thing (TWO-25332).
 *
 * All four are read by the code under test — `$root` by the search-field
 * component in `form/field/companyName-csp-js.phtml`, the other three in
 * `gateway_method-csp-js.phtml`. This is not Alpine's whole magic set:
 * `$watch` in particular is deliberately NOT supplied, even though
 * `initialize()` registers three watchers on it, because a no-op default would
 * let a test that means to exercise a watcher pass without one. Every test that
 * calls `initialize()` therefore sets `$watch` itself, as a no-op or as a
 * recorder.
 *
 * @param {Function} factory the registered Alpine.data factory
 * @param {Object} [options]
 * @param {HTMLElement} [options.el] the bound element (`$el`)
 * @param {HTMLElement} [options.root] the component root (`$root`)
 * @param {Object} [options.wire] the Magewire component proxy (`$wire`)
 * @returns {Object} the component
 */
function mountComponent(factory, options) {
  const opts = options || {};
  const magic = {
    $el: opts.el || null,
    $root: opts.root || opts.el || null,
    $wire: opts.wire || null,
    $nextTick: function (fn) {
      if (typeof fn === "function") {
        fn();
      }
      return Promise.resolve();
    },
  };
  const component = factory.call(magic);
  // Assigned rather than spread onto the component: the component may be the
  // live-composed object whose accessors must stay accessors.
  Object.keys(magic).forEach(function (key) {
    component[key] = magic[key];
  });
  return component;
}

/**
 * The AbortError a real `fetch` rejects with when its signal aborts.
 *
 * @returns {Error}
 */
function abortError() {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Replace `fetch` with a recorder whose calls a test settles by hand.
 *
 * Request timing is the subject matter here — timeouts, supersession, aborts —
 * so driving each response explicitly is the point rather than a shortcut. The
 * abort wiring is load-bearing: the helper distinguishes a timeout from a
 * caller abort by asking the CALLER's signal, and both arrive as an AbortError,
 * so a stub that resolved instead of rejecting would make either look fine.
 *
 * @returns {{calls: Array, last: Function, restore: Function}}
 */
function stubFetch() {
  const original = global.fetch;
  const calls = [];

  global.fetch = function (url, init) {
    const record = {
      url: String(url),
      init: init || {},
      settled: false,
    };
    record.promise = new Promise(function (resolve, reject) {
      record.resolveWith = resolve;
      record.rejectWith = reject;
    });

    /** Resolve as an HTTP response. */
    record.respond = function (body, status) {
      if (record.settled) return;
      record.settled = true;
      const code = status === undefined ? 200 : status;
      record.resolveWith({
        ok: code >= 200 && code < 300,
        status: code,
        json: function () {
          return Promise.resolve(body);
        },
      });
    };
    /** Resolve as a non-2xx with a body that would parse as a payload. */
    record.respondWithStatus = function (status) {
      record.respond({ error: "nope" }, status);
    };
    /** Reject the way a dropped connection does. */
    record.networkError = function () {
      if (record.settled) return;
      record.settled = true;
      record.rejectWith(new TypeError("Failed to fetch"));
    };

    const signal = record.init.signal;
    if (signal) {
      if (signal.aborted) {
        record.settled = true;
        calls.push(record);
        return Promise.reject(abortError());
      }
      signal.addEventListener("abort", function () {
        if (record.settled) return;
        record.settled = true;
        record.rejectWith(abortError());
      });
    }

    calls.push(record);
    return record.promise;
  };

  return {
    calls: calls,
    last: function () {
      return calls[calls.length - 1];
    },
    restore: function () {
      global.fetch = original;
    },
  };
}

/**
 * Drain the microtask queue.
 *
 * Several of the paths under test are two or three `await`s deep behind a
 * `finally`, so a bare `await Promise.resolve()` passes vacuously. Chained
 * microtasks rather than a timer: a real timer would not fire under
 * `jest.useFakeTimers()`, which the timeout tests need.
 *
 * @returns {Promise<void>}
 */
async function flushPromises() {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  COMPANY_SELECTION_KEY: COMPANY_SELECTION_KEY,
  BILLING_COMPANY_KEY: BILLING_COMPANY_KEY,
  QUOTE_JSON: QUOTE_JSON,
  ESCAPED_STRING: ESCAPED_STRING,
  PAYMENT_FIELDS_TEMPLATE: PAYMENT_FIELDS_TEMPLATE,
  GATEWAY_METHOD_TEMPLATE: GATEWAY_METHOD_TEMPLATE,
  GATEWAY_METHOD_MARKUP_TEMPLATE: GATEWAY_METHOD_MARKUP_TEMPLATE,
  COMPANY_NAME_TEMPLATE: COMPANY_NAME_TEMPLATE,
  COMPANY_NAME_MARKUP_TEMPLATE: COMPANY_NAME_MARKUP_TEMPLATE,
  SHIPPING_COMPANY_TEMPLATE: SHIPPING_COMPANY_TEMPLATE,
  renderTemplateJs: renderTemplateJs,
  renderTemplateMarkup: renderTemplateMarkup,
  readAlpineBinding: readAlpineBinding,
  loadTemplate: loadTemplate,
  loadSharedHelpers: loadSharedHelpers,
  installHyvaEnvironment: installHyvaEnvironment,
  installCompanyPanelStub: installCompanyPanelStub,
  mountComponent: mountComponent,
  stubFetch: stubFetch,
  flushPromises: flushPromises,
  abortError: abortError,
};
